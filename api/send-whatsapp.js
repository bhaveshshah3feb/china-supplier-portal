import { createClient } from '@supabase/supabase-js'

const WA_LIMITS = { video: 16 * 1024 * 1024, image: 5 * 1024 * 1024, document: 100 * 1024 * 1024 }
const WA_API    = 'https://graph.facebook.com/v19.0'

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function getWaCredentials(supabaseAdmin) {
  const { data: rows } = await supabaseAdmin
    .from('settings').select('key, value')
    .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token'])
  const cfg = {}
  for (const r of (rows || [])) cfg[r.key] = r.value
  return { phoneNumberId: cfg.whatsapp_phone_number_id, accessToken: cfg.whatsapp_access_token }
}

// Download file from URL and upload to WhatsApp media servers.
// Returns a WhatsApp media ID which is guaranteed to work in template headers
// (avoids the "received UNKNOWN" error caused by WhatsApp being unable to fetch URLs directly).
async function uploadMediaToWhatsApp(fileUrl, phoneNumberId, accessToken) {
  const dl = await fetch(fileUrl, { signal: AbortSignal.timeout(20000) })
  if (!dl.ok) throw new Error(`Could not download file from storage (HTTP ${dl.status})`)

  const contentType = dl.headers.get('content-type') || 'image/jpeg'
  const buffer      = await dl.arrayBuffer()

  // WhatsApp MIME detection relies on the filename extension — 'media' (no ext) causes "UNKNOWN"
  const ext = contentType.includes('png')  ? 'png'
            : contentType.includes('webp') ? 'webp'
            : contentType.includes('gif')  ? 'gif'
            : contentType.includes('mp4')  ? 'mp4'
            : contentType.includes('pdf')  ? 'pdf'
            : 'jpg'
  const uploadFilename = `upload.${ext}`

  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', contentType)
  form.append('file', new Blob([buffer], { type: contentType }), uploadFilename)

  const up   = await fetch(`${WA_API}/${phoneNumberId}/media`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body:    form,
    signal:  AbortSignal.timeout(25000),
  })
  const data = await up.json()
  if (!data.id) throw new Error(`WhatsApp media upload failed: ${data.error?.message || JSON.stringify(data)}`)
  console.log('WA media upload ok, id:', data.id, '| type:', contentType, '| filename:', uploadFilename)
  return data.id
}

async function callWaApi(phoneNumberId, accessToken, payload) {
  const res  = await fetch(`${WA_API}/${phoneNumberId}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  const data = await res.json()
  return { res, data }
}

async function logMessage(supabaseAdmin, { phone, direction, waMessageId, messageType, content, templateName, mediaUrl, filename, status }) {
  try {
    await supabaseAdmin.from('whatsapp_messages').insert({
      phone_number:  phone,
      direction,
      wa_message_id: waMessageId || null,
      message_type:  messageType,
      content:       content || null,
      template_name: templateName || null,
      media_url:     mediaUrl || null,
      filename:      filename || null,
      status,
      wa_timestamp:  new Date().toISOString(),
    })
  } catch (err) {
    console.warn('WA message log failed:', err.message)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabaseAdmin = makeAdmin()
    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured (missing env vars)' })

    const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
    if (!token) return res.status(401).json({ error: 'Not authenticated' })

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !user || user.user_metadata?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { phoneNumberId, accessToken } = await getWaCredentials(supabaseAdmin)

    if (req.body?.test) {
      if (!phoneNumberId || !accessToken)
        return res.status(200).json({ configured: false, error: 'Credentials not set in Settings tab' })
      return res.status(200).json({ configured: true })
    }

    if (!phoneNumberId || !accessToken)
      return res.status(400).json({ error: 'WhatsApp credentials not configured in Settings tab.' })

    // ── Free-form text reply ──────────────────────────────────
    if (req.body?.message_type === 'text') {
      const { to_phone, message_text } = req.body
      if (!to_phone || !message_text)
        return res.status(400).json({ error: 'to_phone and message_text are required' })

      const cleanPhone = to_phone.replace(/[^\d]/g, '')
      if (cleanPhone.length < 10)
        return res.status(400).json({ error: `Phone number too short. Include country code.` })

      const payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'text', text: { preview_url: false, body: message_text },
      }
      // Log full details to Vercel so we can see exactly what is being sent
      console.log('WA free-form | phoneNumberId:', phoneNumberId, '| to:', cleanPhone, '| tokenTail:', accessToken.slice(-8))
      const { res: waRes, data: waData } = await callWaApi(phoneNumberId, accessToken, payload)

      if (!waRes.ok || waData.error) {
        const errMsg  = waData?.error?.message || 'WhatsApp API error'
        const errCode = waData?.error?.code || waRes.status
        console.error('WA text error:', JSON.stringify(waData))
        await logMessage(supabaseAdmin, { phone: cleanPhone, direction: 'outbound', messageType: 'text', content: message_text, status: 'failed' })
        return res.status(502).json({ error: `WhatsApp error (${errCode}): ${errMsg}`, raw: waData })
      }

      const messageId = waData.messages?.[0]?.id
      await logMessage(supabaseAdmin, { phone: cleanPhone, direction: 'outbound', waMessageId: messageId, messageType: 'text', content: message_text, status: 'sent' })
      return res.status(200).json({ success: true, message_id: messageId })
    }

    // ── File / template message ───────────────────────────────
    const { to_phone, file_url, file_size, filename, file_type, machine_name, category } = req.body
    if (!to_phone || !file_url)
      return res.status(400).json({ error: 'to_phone and file_url are required' })

    const cleanPhone = to_phone.replace(/[^\d]/g, '')
    if (cleanPhone.length < 10)
      return res.status(400).json({ error: `Phone number too short. Include country code, e.g. 919876543210.` })

    const sizeBytes = Number(file_size) || 0
    const limit = WA_LIMITS[file_type] || WA_LIMITS.document
    if (sizeBytes > limit) {
      const limitMB = (limit / 1024 / 1024).toFixed(0)
      const fileMB  = (sizeBytes / 1024 / 1024).toFixed(1)
      return res.status(400).json({ error: `File too large for WhatsApp (${fileMB} MB). Limit: ${limitMB} MB.` })
    }

    const name1 = machine_name || filename || 'Product'
    const name2 = category     || 'Amusement Equipment'
    let payload, templateName = null, msgContent = null

    if (file_type === 'video') {
      templateName = 'game_vidpic'
      msgContent   = `Here's the video for ${name1} — ${name2}`

      // Upload to WhatsApp first to avoid "received UNKNOWN" error on URL fetch
      let videoParam
      try {
        const mediaId = await uploadMediaToWhatsApp(file_url, phoneNumberId, accessToken)
        videoParam = { type: 'video', video: { id: mediaId } }
      } catch (uploadErr) {
        console.warn('Video upload to WA failed, falling back to link:', uploadErr.message)
        videoParam = { type: 'video', video: { link: file_url } }
      }

      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'template',
        template: {
          name: templateName, language: { code: 'en' },
          components: [
            { type: 'header', parameters: [videoParam] },
            { type: 'body',   parameters: [{ type: 'text', text: name1 }, { type: 'text', text: name2 }] },
          ],
        },
      }

    } else if (file_type === 'image') {
      templateName = 'game_pic'
      msgContent   = `Here's the image for ${name1} — ${name2}`

      // Upload to WhatsApp first to avoid "received UNKNOWN" error on URL fetch
      let imageParam
      try {
        const mediaId = await uploadMediaToWhatsApp(file_url, phoneNumberId, accessToken)
        imageParam = { type: 'image', image: { id: mediaId } }
      } catch (uploadErr) {
        console.warn('Image upload to WA failed, falling back to link:', uploadErr.message)
        imageParam = { type: 'image', image: { link: file_url } }
      }

      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'template',
        template: {
          name: templateName, language: { code: 'en' },
          components: [
            { type: 'header', parameters: [imageParam] },
            { type: 'body',   parameters: [{ type: 'text', text: name1 }, { type: 'text', text: name2 }] },
          ],
        },
      }

    } else {
      // Document — send directly (no template needed)
      msgContent = `${name1} — ${name2}`
      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'document',
        document: { link: file_url, filename: filename || 'file', caption: msgContent },
      }
    }

    console.log('Sending WA payload to', cleanPhone, '| type:', file_type, '| template:', templateName || 'direct')

    const { res: waRes, data: waData } = await callWaApi(phoneNumberId, accessToken, payload)

    if (!waRes.ok || waData.error) {
      const errMsg  = waData?.error?.message || waData?.error?.error_data?.details || 'WhatsApp API error'
      const errCode = waData?.error?.code || waRes.status
      console.error('WA API error:', JSON.stringify(waData))
      await logMessage(supabaseAdmin, { phone: cleanPhone, direction: 'outbound', messageType: file_type, content: msgContent, templateName, mediaUrl: file_url, filename, status: 'failed' })
      return res.status(502).json({ error: `WhatsApp error (${errCode}): ${errMsg}`, raw: waData })
    }

    const messageId = waData.messages?.[0]?.id
    await logMessage(supabaseAdmin, { phone: cleanPhone, direction: 'outbound', waMessageId: messageId, messageType: file_type, content: msgContent, templateName, mediaUrl: file_url, filename, status: 'sent' })
    return res.status(200).json({ success: true, message_id: messageId })

  } catch (err) {
    console.error('send-whatsapp unhandled error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
