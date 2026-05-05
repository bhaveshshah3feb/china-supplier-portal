/**
 * process-videos.mjs
 * Runs on GitHub Actions (Ubuntu + FFmpeg available).
 * Polls Supabase for pending video/image jobs, processes them, uploads results.
 *
 * Jobs handled:
 *   categorize — extract 3 frames → Claude Vision → update category
 *   watermark  — cover supplier logos → add Bhavesh branding + SRC code
 */

import { createClient }   from '@supabase/supabase-js'
import Anthropic          from '@anthropic-ai/sdk'
import { execSync, exec } from 'child_process'
import { promisify }      from 'util'
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs'
import { tmpdir }         from 'os'
import { join, extname, dirname }  from 'path'
import { fileURLToPath }  from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const execAsync = promisify(exec)

// ── Clients ──────────────────────────────────────────────────
const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

const TMP      = join(tmpdir(), 'portal-proc')
if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true })

const LOGO_PATH = join(__dirname, 'assets', 'aryan-logo.jpg')
const BOLD_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

// Font is optional — if not installed, FFmpeg uses its built-in default.
// Drawtext still works; text won't be bold but the job won't fail.
const hasBoldFont = existsSync(BOLD_FONT)
if (!hasBoldFont) console.warn(`⚠️  Bold font not found at ${BOLD_FONT} — using FFmpeg default`)
const fontArg = hasBoldFont ? `:fontfile=${BOLD_FONT}` : ''

// ── Watermark config (text only — sizes are computed dynamically per file) ──
const WM = {
  name:  'Bhavesh - Aryan Amusements',
  phone: '+91 9841081945',
}

// Watermark dimensions are based on FRAME HEIGHT, not width.
// The band is horizontal, so its visual weight is determined by
// what fraction of the total height it occupies — not the width.
// Using width gave inconsistent results across different aspect ratios.
//
// Formula: bandH = 13% of vidH, min 80 px
//
// Sanity table:
//   720p  (1280×720):   bandH= 94px, logo= 75px, phone=26pt, name=16pt
//   1080p (1920×1080):  bandH=140px, logo=112px, phone=39pt, name=24pt
//   4K    (3840×2160):  bandH=281px, logo=225px, phone=79pt, name=48pt
//   iPhone(4032×3024):  bandH=393px, logo=314px, phone=110pt,name=67pt ← finally visible!
//   Portrait(1080×1920):bandH=250px, logo=200px, phone=70pt, name=43pt
function calcWM(vidW, vidH) {
  const bandH   = Math.max(80, Math.round(vidH * 0.13))
  const logoSz  = Math.round(bandH * 0.80)
  const logoPad = Math.round(bandH * 0.10)
  const logoBoxW = logoSz + 2 * logoPad
  const textW   = Math.round(vidW * 0.28)   // 28% of width — wide enough for the full name
  const textX   = logoBoxW + logoPad
  const phoneFs = Math.round(bandH * 0.28)
  const nameFs  = Math.round(bandH * 0.17)
  const srcH    = Math.round(bandH * 0.38)
  const srcW    = Math.round(vidW * 0.18)
  const srcFs   = Math.round(srcH  * 0.36)
  const phY     = Math.round(bandH * 0.10)
  const nmY     = Math.round(bandH * 0.56)
  return { bandH, logoSz, logoPad, logoBoxW, textW, textX,
           phoneFs, nameFs, srcH, srcW, srcFs, phY, nmY }
}

// ── Auto-heal: queue uploads that never got a processing job ─
async function autoQueueOrphans() {
  // Any upload stuck at 'uploading' for > 20 minutes is considered complete
  // (TUS finished but the DB callback never fired — common on mobile/slow networks)
  const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString()

  const { data: candidates } = await supabase
    .from('uploads')
    .select('id, upload_status')
    .eq('processing_status', 'pending')
    .or(`upload_status.eq.completed,and(upload_status.eq.uploading,created_at.lt.${cutoff})`)
    .limit(100)

  if (!candidates?.length) return

  const ids = candidates.map(u => u.id)

  // Check which ones already have a categorize job
  const { data: existing } = await supabase
    .from('processing_queue')
    .select('upload_id')
    .in('upload_id', ids)
    .eq('job_type', 'categorize')

  const alreadyQueued = new Set((existing || []).map(j => j.upload_id))
  const toQueue   = candidates.filter(u => !alreadyQueued.has(u.id))
  const toComplete = toQueue.filter(u => u.upload_status === 'uploading')

  if (!toQueue.length) return

  console.log(`Auto-queuing ${toQueue.length} orphaned upload(s) (${toComplete.length} were stuck at 'uploading')`)

  // Mark stuck 'uploading' uploads as completed
  if (toComplete.length) {
    await supabase.from('uploads')
      .update({ upload_status: 'completed' })
      .in('id', toComplete.map(u => u.id))
  }

  // Create categorize jobs
  await supabase.from('processing_queue').insert(
    toQueue.map(u => ({ upload_id: u.id, job_type: 'categorize', status: 'pending' }))
  )
}

// ── Reset jobs stuck in "processing" (runner was killed mid-job) ──────
async function resetStuckJobs() {
  const stuckSince = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data: stuck } = await supabase
    .from('processing_queue')
    .select('id, upload_id')
    .eq('status', 'processing')
    .lt('started_at', stuckSince)
  if (!stuck?.length) return
  console.log(`Resetting ${stuck.length} job(s) stuck in "processing" → "pending"`)
  const ids       = stuck.map(j => j.id)
  const uploadIds = [...new Set(stuck.map(j => j.upload_id).filter(Boolean))]
  await supabase.from('processing_queue')
    .update({ status: 'pending', started_at: null })
    .in('id', ids)
  if (uploadIds.length) {
    await supabase.from('uploads')
      .update({ processing_status: 'pending' })
      .in('id', uploadIds)
  }
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('Checking for pending jobs...')
  await resetStuckJobs()
  await autoQueueOrphans()

  // Process ALL pending jobs — fetch in batches of 20 and keep looping
  // until the queue is empty or no progress is made.
  let totalProcessed = 0
  while (true) {
    const { data: jobs, error } = await supabase
      .from('processing_queue')
      .select('*, uploads(*, suppliers(supplier_code, company_name_en), main_categories!main_category_id(slug,name_en), sub_categories!sub_category_id(slug,name_en))')
      .eq('status', 'pending')
      .lt('attempts', 3)
      .order('created_at')
      .limit(20)

    if (error) { console.error('DB error:', error); process.exit(1) }
    if (!jobs || jobs.length === 0) break

    console.log(`\nProcessing batch of ${jobs.length} job(s) (total so far: ${totalProcessed})`)
    for (const job of jobs) {
      await processJob(job)
      totalProcessed++
    }
  }

  if (totalProcessed === 0) console.log('No pending jobs. Done.')
  else console.log(`\nAll done — processed ${totalProcessed} job(s) this run.`)
}

// ── Process one job ───────────────────────────────────────────
async function processJob(job) {
  const { id: jobId, job_type, uploads: upload } = job

  if (!upload) {
    await failJob(jobId, 'Upload record not found')
    return
  }

  console.log(`\nJob ${jobId} | type=${job_type} | file=${upload.original_filename}`)

  // Mark as processing
  await supabase.from('processing_queue').update({
    status:     'processing',
    started_at: new Date().toISOString(),
    attempts:   job.attempts + 1,
  }).eq('id', jobId)

  await supabase.from('uploads').update({ processing_status: 'processing' }).eq('id', upload.id)

  const origExt  = extname(upload.original_filename).toLowerCase()
  const tmpInput = join(TMP, `input_${jobId}${origExt || '.mp4'}`)
  const frames   = []

  try {
    // ── Download file ──────────────────────────────────────
    console.log('  Downloading from Supabase Storage...')
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('uploads').download(upload.storage_path)
    if (dlErr) throw new Error(`Download failed: ${dlErr.message}`)

    const buffer = Buffer.from(await fileData.arrayBuffer())
    writeFileSync(tmpInput, buffer)
    console.log(`  Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`)

    // ── CATEGORIZE job (videos only) ───────────────────────
    if (job_type === 'categorize') {
      // Images don't need frame extraction — run logo detection directly on the image
      if (upload.file_type === 'image') {
        console.log('  Image file — running supplier logo detection then queueing watermark')
        let supplierLogoRegion = null
        try {
          const imgMime = (upload.mime_type || 'image/jpeg').startsWith('image/') ? upload.mime_type : 'image/jpeg'
          const imgData = buffer.toString('base64')
          const logoResp = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 120,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: imgMime, data: imgData } },
                { type: 'text', text: `Identify any MANUFACTURER or SUPPLIER branding logo on this amusement machine image (sticker, badge, panel — not the game title). Ignore "Aryan Amusements". If found reply ONLY: {"found":true,"x_pct":X,"y_pct":Y,"w_pct":W,"h_pct":H,"confidence":0.0} else {"found":false}` },
              ],
            }],
          })
          const txt = logoResp.content[0]?.text?.trim().replace(/```json|```/g, '')
          const parsed = JSON.parse(txt)
          if (parsed.found && (parsed.confidence ?? 1) >= 0.55) {
            supplierLogoRegion = { x_pct: parsed.x_pct, y_pct: parsed.y_pct, w_pct: parsed.w_pct, h_pct: parsed.h_pct, confidence: parsed.confidence ?? 0.8 }
            console.log(`  Supplier logo detected in image: ${JSON.stringify(supplierLogoRegion)}`)
          }
        } catch { console.warn('  Image logo detection failed (non-fatal)') }

        if (supplierLogoRegion) {
          await supabase.from('uploads').update({ supplier_logo_region: supplierLogoRegion }).eq('id', upload.id).catch(() => {})
        }
        await supabase.from('processing_queue').insert([{ upload_id: upload.id, job_type: 'watermark', status: 'pending' }])
        await completeJob(jobId)
        return
      }

      const { stdout: probeOut } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmpInput}"`
      )
      const duration = parseFloat(probeOut.trim()) || 30

      console.log('  Extracting frames for AI categorization...')
      const timestamps = [0.1, 0.5, 0.9].map(p => Math.max(1, duration * p))

      for (let i = 0; i < timestamps.length; i++) {
        const framePath = join(TMP, `frame_${jobId}_${i}.jpg`)
        await execAsync(
          `ffmpeg -ss ${timestamps[i]} -i "${tmpInput}" -vframes 1 -q:v 2 -vf "scale=640:-1" "${framePath}" -y`
        )
        if (existsSync(framePath)) frames.push(framePath)
      }

      if (frames.length === 0) throw new Error('Could not extract frames')
      console.log(`  Extracted ${frames.length} frames`)

      const { data: mainCats } = await supabase.from('main_categories').select('id,slug,name_en').eq('status','active')
      const catList = (mainCats||[]).map(c => `${c.slug} (${c.name_en})`).join(', ')

      // ── Claude Vision categorization (non-fatal if API fails) ──
      let matched = null
      try {
        console.log('  API key present:', !!process.env.CLAUDE_API_KEY, '| key prefix:', process.env.CLAUDE_API_KEY?.slice(0, 14) || 'MISSING')

        const imageBlocks = frames.map(fp => ({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(fp).toString('base64') },
        }))

        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 50,
          messages: [{
            role: 'user',
            content: [
              ...imageBlocks,
              {
                type: 'text',
                text: `These are 3 frames from an amusement equipment video (at 10%, 50%, 90% of duration).
Available categories: ${catList}
Reply with ONLY the slug of the best matching category (e.g. "arcade" or "kiddy").`,
              },
            ],
          }],
        })

        const aiSlug = response.content[0]?.text?.trim().toLowerCase().replace(/[^a-z-]/g,'')
        matched = (mainCats||[]).find(c => c.slug === aiSlug) || null
        console.log(`  AI category: ${aiSlug} (matched: ${!!matched})`)

      } catch (aiErr) {
        // Log full details so we can diagnose the API key / model issue
        console.error('  ⚠️  Claude API failed (will skip categorization):')
        console.error('     name   :', aiErr.name)
        console.error('     status :', aiErr.status)
        console.error('     message:', aiErr.message)
        if (aiErr.error)   console.error('     body   :', JSON.stringify(aiErr.error))
        if (aiErr.headers) console.error('     cf-ray :', aiErr.headers?.['cf-ray'])
      }

      // ── AI game name extraction ────────────────────────────
      let aiGameName = null
      if (frames.length > 0) {
        try {
          const nameResponse = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 60,
            messages: [{
              role: 'user',
              content: [
                {
                  type:   'image',
                  source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(frames[0]).toString('base64') },
                },
                {
                  type: 'text',
                  text: 'This is a frame from an amusement/arcade game video. The game name is usually displayed prominently on the top panel or marquee of the machine. Reply with ONLY the game name (e.g. "Street Fighter II" or "Big Bass Wheel"). If no specific name is visible, reply "Unknown".',
                },
              ],
            }],
          })
          const raw = nameResponse.content[0]?.text?.trim()
          if (raw && raw !== 'Unknown' && raw.length > 1 && raw.length < 80) {
            aiGameName = raw
            console.log(`  AI game name: ${aiGameName}`)
          }
        } catch (nameErr) {
          console.warn('  Could not extract game name:', nameErr.message)
        }
      }

      // ── Supplier logo detection ────────────────────────────
      let supplierLogoRegion = null
      if (frames.length > 0) {
        try {
          const logoResp = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 120,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(frames[0]).toString('base64') } },
                { type: 'text', text: `This is a frame from an amusement equipment video.
Identify any MANUFACTURER or SUPPLIER branding logo on the machine (sticker, badge, panel text — not the game title).
Ignore "Aryan Amusements" — that is our brand.
If you see supplier branding, reply ONLY with JSON (no markdown):
{"found":true,"x_pct":X,"y_pct":Y,"w_pct":W,"h_pct":H,"confidence":0.0}
(x_pct/y_pct = top-left corner as % of frame, w_pct/h_pct = size as %)
If no supplier branding visible: {"found":false}` },
              ],
            }],
          })
          const txt = logoResp.content[0]?.text?.trim().replace(/```json|```/g, '')
          const parsed = JSON.parse(txt)
          if (parsed.found && (parsed.confidence ?? 1) >= 0.55) {
            supplierLogoRegion = { x_pct: parsed.x_pct, y_pct: parsed.y_pct, w_pct: parsed.w_pct, h_pct: parsed.h_pct, confidence: parsed.confidence ?? 0.8 }
            console.log(`  Supplier logo detected: ${JSON.stringify(supplierLogoRegion)}`)
          } else {
            console.log('  No supplier logo detected')
          }
        } catch (logoErr) {
          console.warn('  Supplier logo detection failed (non-fatal):', logoErr.message)
        }
      }

      await supabase.from('uploads').update({
        ai_main_category_id:  matched?.id || null,
        main_category_id:     upload.main_category_id || matched?.id || null,
        ai_confidence:        matched ? 0.9 : 0.3,
        ai_game_name:         aiGameName,
        supplier_logo_region: supplierLogoRegion,
      }).eq('id', upload.id)

      // Queue the watermark job regardless of whether AI categorization succeeded
      await supabase.from('processing_queue').insert([{
        upload_id: upload.id,
        job_type:  'watermark',
        status:    'pending',
      }])

      await completeJob(jobId)
    }

    // ── WATERMARK job ───────────────────────────────────────
    else if (job_type === 'watermark') {
      const supplierCode = upload.suppliers?.supplier_code || 'UNKNOWN'
      const catSlug      = upload.main_categories?.slug    || 'other'
      const isImage      = upload.file_type === 'image'

      // Documents / pricelists — copy to sales as-is (no FFmpeg watermark)
      if (upload.file_type === 'document' || upload.file_type === 'pricelist') {
        console.log('  Document/pricelist — copying to sales without watermark')
        const salesFilename = `${catSlug}/${upload.id}_${supplierCode}${origExt}`
        const docBuffer = buffer || readFileSync(tmpInput)
        const { error: upErr } = await supabase.storage
          .from('sales')
          .upload(salesFilename, docBuffer, {
            contentType: upload.mime_type || 'application/octet-stream',
            upsert: true,
          })
        if (upErr) throw new Error(`Sales upload failed: ${upErr.message}`)
        await supabase.from('uploads').update({
          processing_status: 'completed',
          sales_path:        salesFilename,
        }).eq('id', upload.id)
        await completeJob(jobId)
        return
      }

      console.log(`  Applying watermarks (SRC: ${supplierCode}, type: ${isImage ? 'image' : 'video'})...`)

      const hasLogo = existsSync(LOGO_PATH)
      console.log(`  Logo file: ${hasLogo ? 'found' : 'NOT FOUND — text-only fallback'}`)

      // Detect actual pixel dimensions — we need BOTH width AND height.
      // bandH is derived from vidH so the watermark occupies a consistent
      // fraction of the total frame height regardless of resolution.
      let vidW = 1920, vidH = 1080
      try {
        const { stdout: dimOut } = await execAsync(
          `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${tmpInput}"`
        )
        const parts = dimOut.trim().split(',').map(Number)
        if (parts.length >= 2 && parts[0] > 0 && parts[1] > 0) {
          vidW = parts[0]; vidH = parts[1]
        }
        console.log(`  Dimensions: ${vidW}x${vidH}`)
      } catch { console.warn(`  ffprobe failed — using defaults ${vidW}x${vidH}`) }

      // All watermark sizes computed from vidH (frame height = visual reference)
      const { bandH, logoSz, logoPad, logoBoxW, textW, textX,
              phoneFs, nameFs, srcH, srcW, srcFs, phY, nmY } = calcWM(vidW, vidH)

      console.log(`  Watermark band: ${bandH}px tall, logo: ${logoSz}px, phone: ${phoneFs}pt, name: ${nameFs}pt`)

      // Escape text values for FFmpeg drawtext filter
      const escapedName  = WM.name.replace(/'/g, "\\'" ).replace(/:/g, '\\:')
      const escapedPhone = WM.phone.replace(/'/g, "\\'" ).replace(/:/g, '\\:')
      const escapedCode  = supplierCode.replace(/'/g, "\\'" ).replace(/:/g, '\\:')

      // ── Supplier logo camouflage ───────────────────────────
      // Read detected region from categorize step (if any)
      const supplierRegion = upload.supplier_logo_region
      let supplierCoverFilters = []
      let supplierCoverOverlay = null  // pixel coords for logo overlay on cover

      if (supplierRegion?.confidence >= 0.55) {
        const sx  = Math.round(vidW * supplierRegion.x_pct / 100)
        const sy  = Math.round(vidH * supplierRegion.y_pct / 100)
        const sw  = Math.round(vidW * supplierRegion.w_pct / 100)
        const sh  = Math.round(vidH * supplierRegion.h_pct / 100)
        const pad = Math.round(Math.max(sw, sh) * 0.10)
        const cx  = Math.max(0, sx - pad)
        const cy  = Math.max(0, sy - pad)
        const cw  = Math.min(vidW - cx, sw + 2 * pad)
        const ch  = Math.min(vidH - cy, sh + 2 * pad)
        supplierCoverFilters = [`drawbox=x=${cx}:y=${cy}:w=${cw}:h=${ch}:color=black@0.95:t=fill`]
        supplierCoverOverlay = { x: cx, y: cy, w: cw, h: ch }
        console.log(`  Covering supplier logo: ${cx},${cy} → ${cw}×${ch}px (confidence ${supplierRegion.confidence})`)
      }

      const videoFilters = [
        ...supplierCoverFilters,   // black box over supplier logo (comes first)
        `drawbox=x=0:y=0:w=${logoBoxW}:h=${bandH}:color=black@0.75:t=fill`,
        `drawbox=x=${logoBoxW}:y=0:w=${textW}:h=${bandH}:color=black@0.75:t=fill`,
        `drawbox=x=iw-${srcW}:y=ih-${srcH}:w=${srcW}:h=${srcH}:color=black@0.75:t=fill`,
        `drawtext=text='${escapedPhone}':x=${textX}:y=${phY}:fontsize=${phoneFs}:fontcolor=yellow@0.95${fontArg}:shadowx=2:shadowy=2`,
        `drawtext=text='${escapedName}':x=${textX}:y=${nmY}:fontsize=${nameFs}:fontcolor=white${fontArg}:shadowx=1:shadowy=1`,
        `drawtext=text='SRC\\: ${escapedCode}':x=W-${srcW - Math.round(srcW*0.05)}:y=H-${Math.round(srcH*0.65)}:fontsize=${srcFs}:fontcolor=white@0.65`,
        ...(hasLogo ? [] : [
          `drawtext=text='Aryan':x=${logoPad}:y=${Math.round(bandH*0.35)}:fontsize=${nameFs}:fontcolor=white${fontArg}`,
        ]),
      ].join(',')

      const salesExt  = isImage ? '.jpg' : '.mp4'
      const tmpOutput = join(TMP, `output_${jobId}${salesExt}`)
      const logoInput = hasLogo ? `-i "${LOGO_PATH}"` : ''
      const fmtEnd    = isImage ? ',format=yuvj420p' : ''

      // Build filter_complex:
      // - If supplier logo found: split logo input → brand (top-left) + cover (supplier area)
      // - Otherwise: standard single logo overlay
      let filterComplex
      if (hasLogo && supplierCoverOverlay) {
        filterComplex = `[1:v]split=2[la][lb];[la]scale=${logoSz}:${logoSz}[brand];[lb]scale=${supplierCoverOverlay.w}:${supplierCoverOverlay.h}[cover];[0:v]${videoFilters}[vid];[vid][brand]overlay=${logoPad}:${logoPad}[mid];[mid][cover]overlay=${supplierCoverOverlay.x}:${supplierCoverOverlay.y}${fmtEnd}[out]`
      } else if (hasLogo) {
        filterComplex = `[0:v]${videoFilters}[vid];[1:v]scale=${logoSz}:${logoSz}[logo];[vid][logo]overlay=${logoPad}:${logoPad}${fmtEnd}[out]`
      } else {
        filterComplex = `[0:v]${videoFilters}${fmtEnd}[out]`
      }

      const ffCmd = isImage
        ? `ffmpeg -i "${tmpInput}" ${logoInput} -filter_complex "${filterComplex}" -map "[out]" -q:v 2 -frames:v 1 "${tmpOutput}" -y`
        : `ffmpeg -i "${tmpInput}" ${logoInput} -filter_complex "${filterComplex}" -map "[out]" -map 0:a? -c:v libx264 -crf 23 -preset fast "${tmpOutput}" -y`

      console.log(`  FFmpeg (${isImage ? 'image' : 'video'}) command:`, ffCmd)

      try {
        await execAsync(ffCmd, { maxBuffer: 1024 * 1024 * 100 })
        console.log('  Watermark applied successfully')
      } catch (ffErr) {
        // Capture BOTH stderr and stdout — FFmpeg sometimes writes errors to stdout
        const details = [ffErr.stderr, ffErr.stdout, ffErr.message]
          .filter(Boolean).join('\n').slice(-3000)
        console.error('  ══ FFmpeg FAILED ══')
        console.error('  Error output:', details)
        throw new Error(`FFmpeg failed: ${details}`)
      }

      if (!existsSync(tmpOutput)) {
        throw new Error(`FFmpeg output file not created: ${tmpOutput}`)
      }

      const salesFilename = `${catSlug}/${upload.id}_${supplierCode}${salesExt}`
      const outputBuffer  = readFileSync(tmpOutput)

      const { error: upErr } = await supabase.storage
        .from('sales')
        .upload(salesFilename, outputBuffer, {
          contentType: isImage ? 'image/jpeg' : 'video/mp4',
          upsert: true,
        })
      if (upErr) throw new Error(`Sales upload failed: ${upErr.message}`)

      console.log(`  Uploaded to sales/${salesFilename}`)

      await supabase.from('uploads').update({
        processing_status: 'completed',
        sales_path:        salesFilename,
      }).eq('id', upload.id)

      // Cleanup output temp file
      try { if (existsSync(tmpOutput)) unlinkSync(tmpOutput) } catch {}

      await completeJob(jobId)
    }

  } catch (err) {
    console.error(`  Job ${jobId} failed:`, err.message)
    await failJob(jobId, err.message)
    await supabase.from('uploads').update({
      processing_status: 'failed',
      error_message:     err.message,
    }).eq('id', upload.id)
  } finally {
    // Cleanup input and extracted frames
    for (const f of [tmpInput, ...frames]) {
      try { if (existsSync(f)) unlinkSync(f) } catch {}
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────
async function completeJob(jobId) {
  await supabase.from('processing_queue').update({
    status:       'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', jobId)
  console.log(`  Job ${jobId} completed`)
}

async function failJob(jobId, errorLog) {
  await supabase.from('processing_queue').update({
    status:    'failed',
    error_log: errorLog,
  }).eq('id', jobId)
}

// ── Run ───────────────────────────────────────────────────────
main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
