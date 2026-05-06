import { createClient } from '@supabase/supabase-js'

// WhatsApp Cloud API size limits (bytes)
const WA_LIMITS = { video: 16 * 1024 * 1024, image: 5 * 1024 * 1024, document: 100 * 1024 * 1024 }
const WA_API    = 'https://graph.facebook.com/v21.0'

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function getWaCredentials(supabaseAdmin) {
  const { data: rows } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token'])
  const cfg = {}
  for (const r of (rows || [])) cfg[r.key] = r.value
  return { phoneNumberId: cfg.whatsapp_phone_number_id, accessToken: cfg.whatsapp_access_token }
}

async function callWaApi(phoneNumberId, accessToken, payload) {
  const res  = await fetch(`${WA_API}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  return { res, data }
}

async function logMessage(supabaseAdmin, { phone, direction, waMessageId, messageType, content, templateName, mediaUrl, filename, status }) {
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
  }).catch(err => console.warn('WA message log failed:', err.message))
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

    // ── Credentials check (test mode) ────────────────────────
    if (req.body?.test) {
      if (!phoneNumberId || !accessToken)
        return res.status(200).json({ configured: false, error: 'Credentials not set in Settings tab' })
      return res.status(200).json({ configured: true })
    }

    if (!phoneNumberId || !accessToken)
      return res.status(400).json({ error: 'WhatsApp credentials not configured in Settings tab.' })

    // ── Text message (free-form reply) ────────────────────────
    if (req.body?.message_type === 'text') {
      const { to_phone, message_text } = req.body
      if (!to_phone || !message_text)
        return res.status(400).json({ error: 'to_phone and message_text are required' })

      const cleanPhone = to_phone.replace(/[^\d]/g, '')
      if (cleanPhone.length < 10)
        return res.status(400).json({ error: `Phone number too short (${cleanPhone.length} digits). Include country code.` })

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: { preview_url: false, body: message_text },
      }

      console.log('Sending WA text to', cleanPhone)
      const { res: waRes, data: waData } = await callWaApi(phoneNumberId, accessToken, payload)

      if (!waRes.ok || waData.error) {
        const errMsg  = waData?.error?.message || waData?.error?.error_data?.details || 'WhatsApp API error'
        const errCode = waData?.error?.code || waRes.status
        console.error('WA text error:', JSON.stringify(waData))
        await logMessage(supabaseAdmin, {
          phone: cleanPhone, direction: 'outbound', messageType: 'text',
          content: message_text, status: 'failed',
        })
        return res.status(502).json({ error: `WhatsApp error (${errCode}): ${errMsg}`, raw: waData })
      }

      const messageId = waData.messages?.[0]?.id
      await logMessage(supabaseAdmin, {
        phone: cleanPhone, direction: 'outbound', waMessageId: messageId,
        messageType: 'text', content: message_text, status: 'sent',
      })
      return res.status(200).json({ success: true, message_id: messageId })
    }

    // ── File / template message ───────────────────────────────
    const { to_phone, file_url, file_size, filename, file_type, machine_name, category } = req.body
    if (!to_phone || !file_url)
      return res.status(400).json({ error: 'to_phone and file_url are required' })

    const cleanPhone = to_phone.replace(/[^\d]/g, '')
    if (cleanPhone.length < 10)
      return res.status(400).json({ error: `Phone number too short (${cleanPhone.length} digits). Include country code, e.g. 919876543210 for India.` })

    const sizeBytes = Number(file_size) || 0
    const limit = WA_LIMITS[file_type] || WA_LIMITS.document
    if (sizeBytes > limit) {
      const limitMB = (limit / 1024 / 1024).toFixed(0)
      const fileMB  = (sizeBytes / 1024 / 1024).toFixed(1)
      return res.status(400).json({
        error: `File too large for WhatsApp (${fileMB} MB). Limit for ${file_type}: ${limitMB} MB. Use email or the Download link instead.`,
      })
    }

    const name1 = machine_name || filename || 'Product'
    const name2 = category     || 'Amusement Equipment'

    let payload
    let templateName = null
    let msgContent   = null

    if (file_type === 'video') {
      templateName = 'game_vidpic'
      msgContent   = `Here's the video for ${name1} — ${name2}`
      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'template',
        template: {
          name: templateName, language: { code: 'en' },
          components: [
            { type: 'header', parameters: [{ type: 'video', video: { link: file_url } }] },
            { type: 'body',   parameters: [{ type: 'text', text: name1 }, { type: 'text', text: name2 }] },
          ],
        },
      }
    } else if (file_type === 'image') {
      templateName = 'game_pic'
      msgContent   = `Here's the image for ${name1} — ${name2}`
      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'template',
        template: {
          name: templateName, language: { code: 'en' },
          components: [
            { type: 'header', parameters: [{ type: 'image', image: { link: file_url } }] },
            { type: 'body',   parameters: [{ type: 'text', text: name1 }, { type: 'text', text: name2 }] },
          ],
        },
      }
    } else {
      msgContent = `${name1} — ${name2}`
      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'document',
        document: { link: file_url, filename: filename || 'file', caption: msgContent },
      }
    }

    console.log('Sending WA payload to', cleanPhone, '| type:', file_type, '| template:', templateName || 'free-form')

    const { res: waRes, data: waData } = await callWaApi(phoneNumberId, accessToken, payload)

    if (!waRes.ok || waData.error) {
      const errMsg  = waData?.error?.message || waData?.error?.error_data?.details || 'WhatsApp API error'
      const errCode = waData?.error?.code || waRes.status
      console.error('WA API error:', JSON.stringify(waData))
      await logMessage(supabaseAdmin, {
        phone: cleanPhone, direction: 'outbound', messageType: file_type,
        content: msgContent, templateName, mediaUrl: file_url, filename, status: 'failed',
      })
      return res.status(502).json({ error: `WhatsApp error (${errCode}): ${errMsg}`, raw: waData })
    }

    const messageId = waData.messages?.[0]?.id
    await logMessage(supabaseAdmin, {
      phone: cleanPhone, direction: 'outbound', waMessageId: messageId,
      messageType: file_type, content: msgContent, templateName, mediaUrl: file_url, filename, status: 'sent',
    })
    return res.status(200).json({ success: true, message_id: messageId })

  } catch (err) {
    console.error('send-whatsapp unhandled error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
