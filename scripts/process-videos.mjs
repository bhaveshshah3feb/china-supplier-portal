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

// ── Watermark config ─────────────────────────────────────────
const WM = {
  name:     'Bhavesh - Aryan Amusements',
  phone:    '+91 9841081945',
  logoSize: 100,  // logo rendered at 100×100 px
  logoPad:  5,    // padding around logo inside its box
  textW:    330,  // width of text area beside the logo
  totalH:   110,  // height of the combined top-left watermark band
  srcH:     38,   // SRC code box height (bottom-right corner)
  srcW:     220,  // SRC code box width (bottom-right corner)
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

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('Checking for pending jobs...')
  await autoQueueOrphans()

  const { data: jobs, error } = await supabase
    .from('processing_queue')
    .select('*, uploads(*, suppliers(supplier_code, company_name_en), main_categories!main_category_id(slug,name_en), sub_categories!sub_category_id(slug,name_en))')
    .eq('status', 'pending')
    .lt('attempts', 3)
    .order('created_at')
    .limit(5)

  if (error) { console.error('DB error:', error); process.exit(1) }
  if (!jobs || jobs.length === 0) { console.log('No pending jobs. Done.'); return }

  console.log(`Found ${jobs.length} job(s)`)

  for (const job of jobs) {
    await processJob(job)
  }
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
      // Skip categorize job for images — images are already single frames
      if (upload.file_type === 'image') {
        console.log('  Image file — skipping frame extraction (categorize not applicable)')
        // Queue the watermark job directly
        await supabase.from('processing_queue').insert([{
          upload_id: upload.id,
          job_type:  'watermark',
          status:    'pending',
        }])
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

      await supabase.from('uploads').update({
        ai_main_category_id: matched?.id || null,
        main_category_id:    upload.main_category_id || matched?.id || null,
        ai_confidence:       matched ? 0.9 : 0.3,
        ai_game_name:        aiGameName,
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

      // Escape text values for FFmpeg drawtext filter
      const escapedName  = WM.name.replace(/'/g, "\\'" ).replace(/:/g, '\\:')
      const escapedPhone = WM.phone.replace(/'/g, "\\'" ).replace(/:/g, '\\:')
      const escapedCode  = supplierCode.replace(/'/g, "\\'" ).replace(/:/g, '\\:')

      // Derived dimensions
      const logoBoxW = WM.logoSize + (2 * WM.logoPad)  // 110 — logo bg box width
      const textW    = WM.textW                          // 330 — text area width
      const totalH   = WM.totalH                         // 110 — unified band height
      const srcH     = WM.srcH                           // 38
      const srcW     = WM.srcW                           // 220
      const textX    = logoBoxW + 10                     // 120 — text starts here (absolute)

      // Video-stream filters: logo box + text box are flush (no gap), same height
      const videoFilters = [
        // Logo background box (top-left)
        `drawbox=x=0:y=0:w=${logoBoxW}:h=${totalH}:color=black@0.75:t=fill`,
        // Text area — flush against logo box, same height
        `drawbox=x=${logoBoxW}:y=0:w=${textW}:h=${totalH}:color=black@0.75:t=fill`,
        // SRC code box (bottom-right corner)
        `drawbox=x=iw-${srcW}:y=ih-${srcH}:w=${srcW}:h=${srcH}:color=black@0.75:t=fill`,
        // Phone number — bold yellow, absolute x so it can never overflow
        `drawtext=text='${escapedPhone}':x=${textX}:y=12:fontsize=28:fontcolor=yellow@0.95${fontArg}:shadowx=1:shadowy=1`,
        // Contact name — bold white
        `drawtext=text='${escapedName}':x=${textX}:y=62:fontsize=20:fontcolor=white${fontArg}:shadowx=1:shadowy=1`,
        // SRC code (bottom-right)
        `drawtext=text='SRC\\: ${escapedCode}':x=W-${srcW - 10}:y=H-${srcH - 12}:fontsize=13:fontcolor=white@0.65`,
        // Fallback if no logo: show name in the logo box area
        ...(hasLogo ? [] : [
          `drawtext=text='Aryan':x=6:y=30:fontsize=18:fontcolor=white${fontArg}:shadowx=1:shadowy=1`,
        ]),
      ].join(',')

      const salesExt  = isImage ? '.jpg' : '.mp4'
      const tmpOutput = join(TMP, `output_${jobId}${salesExt}`)
      const logoInput = hasLogo ? `-i "${LOGO_PATH}"` : ''

      // Image filter: DO NOT use format=rgb24 — it causes a pixel-format
      // mismatch with the JPEG encoder. Instead let FFmpeg stay in the native
      // JPEG colour space (yuvj420p) and convert ONLY at the very end so the
      // mjpeg encoder always receives a compatible format.
      //
      // Video filter: no explicit format — libx264 handles conversion itself.
      const filterComplex = isImage
        ? (hasLogo
            ? `[0:v]${videoFilters}[vid];[1:v]scale=${WM.logoSize}:${WM.logoSize}[logo];[vid][logo]overlay=${WM.logoPad}:${WM.logoPad},format=yuvj420p[out]`
            : `[0:v]${videoFilters},format=yuvj420p[out]`)
        : (hasLogo
            ? `[0:v]${videoFilters}[vid];[1:v]scale=${WM.logoSize}:${WM.logoSize}[logo];[vid][logo]overlay=${WM.logoPad}:${WM.logoPad}[out]`
            : `[0:v]${videoFilters}[out]`)

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
