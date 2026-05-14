/**
 * process-wa-uploads.mjs
 * Downloads WhatsApp media files queued in pending_wa_uploads and uploads
 * them to Supabase storage under the correct supplier account.
 * Run by GitHub Actions after webhook queues a file.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const WA_API       = 'https://graph.facebook.com/v19.0'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function mimeToExt(mime = '') {
  const map = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp',
    'video/x-msvideo': 'avi', 'video/webm': 'webm',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'application/pdf': 'pdf',
  }
  return map[mime] || mime.split('/')[1]?.replace('x-', '') || 'bin'
}

async function getWaCredentials() {
  const { data: rows } = await supabase
    .from('settings').select('key, value')
    .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token'])
  const cfg = {}
  for (const r of (rows || [])) cfg[r.key] = r.value
  return { phoneId: cfg.whatsapp_phone_number_id, token: cfg.whatsapp_access_token }
}

async function sendWa(phoneId, token, to, text) {
  if (!phoneId || !token) return
  await fetch(`${WA_API}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual',
      to, type: 'text', text: { body: text },
    }),
  })
}

async function processItem(item, waPhoneId, waToken) {
  console.log(`Processing ${item.id}: ${item.media_type} for ${item.supplier_name}`)

  await supabase.from('pending_wa_uploads')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', item.id)

  // Step 1: get download URL from Meta
  const infoRes = await fetch(`${WA_API}/${item.media_id}`, {
    headers: { Authorization: `Bearer ${waToken}` },
  })
  const info = await infoRes.json()
  if (!info.url) throw new Error(`Meta returned no URL: ${JSON.stringify(info)}`)

  // Step 2: download the file
  const fileRes = await fetch(info.url, {
    headers: { Authorization: `Bearer ${waToken}` },
  })
  if (!fileRes.ok) throw new Error(`Download failed: HTTP ${fileRes.status}`)
  const buffer = Buffer.from(await fileRes.arrayBuffer())
  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)} MB`)

  // Step 3: upload to Supabase storage
  const mime    = item.mime_type || info.mime_type || 'application/octet-stream'
  const ext     = mimeToExt(mime)
  const folder  = item.media_type === 'video' ? 'videos' : item.media_type === 'image' ? 'images' : 'documents'
  const fname   = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const storagePath = `${item.supplier_id}/${folder}/${fname}`

  const { error: uploadErr } = await supabase.storage
    .from('uploads')
    .upload(storagePath, buffer, { contentType: mime, upsert: false })
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

  // Step 4: create uploads record
  const { data: uploadRow, error: dbErr } = await supabase.from('uploads').insert({
    supplier_id:       item.supplier_id,
    original_filename: fname,
    display_name:      fname,
    file_type:         item.media_type,
    mime_type:         mime,
    file_size:         buffer.length,
    storage_path:      storagePath,
    upload_status:     'completed',
    processing_status: 'pending',
  }).select('id').single()
  if (dbErr) throw new Error(`DB insert failed: ${dbErr.message}`)

  // Step 5: queue for AI categorization + watermark
  await supabase.from('processing_queue').insert({
    upload_id: uploadRow.id,
    job_type:  'categorize',
    status:    'pending',
  })

  // Step 6: mark done
  await supabase.from('pending_wa_uploads')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', item.id)

  // Step 7: notify Bhavesh
  if (item.admin_phone && waPhoneId && waToken) {
    await sendWa(waPhoneId, waToken, item.admin_phone,
      `✅ ${item.media_type === 'video' ? '🎬' : '🖼️'} Uploaded to *${item.supplier_name}*\nFile: ${fname}\nNow being processed & watermarked.`)
  }

  console.log(`Done: ${uploadRow.id}`)
}

async function main() {
  const { phoneId, token } = await getWaCredentials()
  if (!token) { console.error('No WA token in settings'); process.exit(1) }

  const { data: items, error } = await supabase
    .from('pending_wa_uploads')
    .select('*')
    .eq('status', 'pending')
    .order('created_at')
    .limit(20)

  if (error) { console.error('DB error:', error.message); process.exit(1) }
  if (!items?.length) { console.log('No pending WA uploads.'); return }

  console.log(`Found ${items.length} pending upload(s)`)

  for (const item of items) {
    try {
      await processItem(item, phoneId, token)
    } catch (err) {
      console.error(`Failed ${item.id}:`, err.message)
      await supabase.from('pending_wa_uploads')
        .update({ status: 'failed', error_log: err.message, updated_at: new Date().toISOString() })
        .eq('id', item.id)
      if (item.admin_phone && phoneId && token) {
        await sendWa(phoneId, token, item.admin_phone, `❌ Upload failed: ${err.message}`)
      }
    }
  }

  console.log('All done.')
}

main().catch(e => { console.error(e); process.exit(1) })
