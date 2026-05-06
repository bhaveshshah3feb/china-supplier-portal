import { createClient } from '@supabase/supabase-js'

// WhatsApp Cloud API size limits (bytes)
const WA_LIMITS = { video: 16 * 1024 * 1024, image: 5 * 1024 * 1024, document: 100 * 1024 * 1024 }
const WA_API    = 'https://graph.facebook.com/v21.0'   // bumped from v19.0

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
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

    const { data: rows } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token'])

    const cfg = {}
    for (const r of (rows || [])) cfg[r.key] = r.value

    const phoneNumberId = cfg.whatsapp_phone_number_id
    const accessToken   = cfg.whatsapp_access_token

    if (req.body?.test) {
      if (!phoneNumberId || !accessToken)
        return res.status(200).json({ configured: false, error: 'Credentials not set in Settings tab' })
      return res.status(200).json({ configured: true })
    }

    if (!phoneNumberId || !accessToken)
      return res.status(400).json({ error: 'WhatsApp credentials not configured in Settings tab.' })

    const { to_phone, file_url, file_size, filename, file_type, machine_name, category } = req.body
    if (!to_phone || !file_url)
      return res.status(400).json({ error: 'to_phone and file_url are required' })

    const cleanPhone = to_phone.replace(/[^\d]/g, '')
    if (cleanPhone.length < 10)
      return res.status(400).json({ error: `Phone number too short (${cleanPhone.length} digits). Include country code, e.g. 919876543210 for India.` })

    // WhatsApp size limits — reject before calling the API so the error is clear
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

    if (file_type === 'video') {
      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'template',
        template: {
          name: 'game_vidpic', language: { code: 'en' },
          components: [
            { type: 'header', parameters: [{ type: 'video', video: { link: file_url } }] },
            { type: 'body',   parameters: [{ type: 'text', text: name1 }, { type: 'text', text: name2 }] },
          ],
        },
      }
    } else if (file_type === 'image') {
      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'template',
        template: {
          name: 'game_pic', language: { code: 'en' },
          components: [
            { type: 'header', parameters: [{ type: 'image', image: { link: file_url } }] },
            { type: 'body',   parameters: [{ type: 'text', text: name1 }, { type: 'text', text: name2 }] },
          ],
        },
      }
    } else {
      // Document / pricelist — free-form (works within 24 h conversation window)
      payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'document',
        document: { link: file_url, filename: filename || 'file', caption: `${name1} — ${name2}` },
      }
    }

    console.log('Sending WA payload to', cleanPhone, '| type:', file_type, '| template:', payload.template?.name || 'free-form')

    const waRes  = await fetch(`${WA_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const waData = await waRes.json()

    if (!waRes.ok || waData.error) {
      const errMsg  = waData?.error?.message || waData?.error?.error_data?.details || 'WhatsApp API error'
      const errCode = waData?.error?.code || waRes.status
      console.error('WA API error:', JSON.stringify(waData))
      return res.status(502).json({ error: `WhatsApp error (${errCode}): ${errMsg}`, raw: waData })
    }

    return res.status(200).json({ success: true, message_id: waData.messages?.[0]?.id })

  } catch (err) {
    console.error('send-whatsapp unhandled error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
