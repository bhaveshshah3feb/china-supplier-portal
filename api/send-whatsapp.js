import { createClient } from '@supabase/supabase-js'

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseAdmin = makeAdmin()
  if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })

  // Verify caller is admin
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user || user.user_metadata?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }

  // Load WhatsApp settings
  const { data: rows } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token'])

  const cfg = {}
  for (const r of (rows || [])) cfg[r.key] = r.value

  const phoneNumberId = cfg.whatsapp_phone_number_id
  const accessToken   = cfg.whatsapp_access_token

  // Test mode — just check if credentials are configured
  if (req.body?.test) {
    if (!phoneNumberId || !accessToken) {
      return res.status(200).json({ configured: false, error: 'Credentials not configured' })
    }
    return res.status(200).json({ configured: true })
  }

  if (!phoneNumberId || !accessToken) {
    return res.status(400).json({
      error: 'WhatsApp API not configured. Go to the Settings tab to add your Phone Number ID and Access Token.',
    })
  }

  const { to_phone, file_url, filename, file_type, machine_name, category } = req.body
  if (!to_phone || !file_url) {
    return res.status(400).json({ error: 'to_phone and file_url are required' })
  }

  // Normalise phone — keep digits only, no leading +
  const cleanPhone = to_phone.replace(/[^\d]/g, '')
  if (cleanPhone.length < 7) return res.status(400).json({ error: 'Invalid phone number' })

  // Header media parameter — type matches the file
  const headerParam = file_type === 'video'
    ? { type: 'video',    video:    { link: file_url } }
    : file_type === 'image'
      ? { type: 'image',  image:    { link: file_url } }
      : { type: 'document', document: { link: file_url, filename: filename || 'file' } }

  // Use approved template game_vidpic
  // Body: "Here's the video for {{1}} — {{2}}"
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                cleanPhone,
    type:              'template',
    template: {
      name:     'game_vidpic',
      language: { code: 'en' },
      components: [
        {
          type:       'header',
          parameters: [headerParam],
        },
        {
          type:       'body',
          parameters: [
            { type: 'text', text: machine_name || filename || 'Product' },
            { type: 'text', text: category     || 'Amusement Equipment' },
          ],
        },
      ],
    },
  }

  const waRes = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  )

  const waData = await waRes.json()

  if (!waRes.ok) {
    console.error('WhatsApp API error:', waData)
    return res.status(502).json({
      error:   waData?.error?.message || 'WhatsApp API returned an error',
      details: waData?.error,
    })
  }

  return res.status(200).json({
    success:    true,
    message_id: waData.messages?.[0]?.id,
  })
}
