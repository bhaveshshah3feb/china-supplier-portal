// Minimal WhatsApp test — zero abstraction, mirrors task app PHP exactly
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user || user.user_metadata?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' })
  }

  // Read credentials
  const { data: rows } = await supabase.from('settings').select('key,value')
    .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token'])
  const cfg = {}
  for (const r of (rows || [])) cfg[r.key] = r.value

  const phoneId = cfg.whatsapp_phone_number_id?.trim()
  const token_  = cfg.whatsapp_access_token?.trim()
  const to      = (req.body?.to || '').replace(/[^\d]/g, '')

  // Step 1: Verify phone number ID — what number does it belong to?
  const infoRes  = await fetch(`https://graph.facebook.com/v19.0/${phoneId}?fields=display_phone_number,verified_name,quality_rating,platform_type,throughput`, {
    headers: { Authorization: `Bearer ${token_}` }
  })
  const info = await infoRes.json()

  if (!to) {
    return res.status(200).json({
      phoneNumberId: phoneId,
      tokenTail: token_?.slice(-10),
      phoneInfo: info,
      note: 'Pass { "to": "919841081945" } in body to also send a test message'
    })
  }

  // Step 2: Send the EXACT same payload as the task app PHP
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: 'Test from Aryan Amusements portal — diagnostic message' }
  }

  const msgRes  = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token_}`
    },
    body: JSON.stringify(payload)
  })
  const msgData = await msgRes.json()

  return res.status(200).json({
    phoneNumberId:    phoneId,
    tokenTail:        token_?.slice(-10),
    sendingFrom:      info?.display_phone_number,
    sendingTo:        to,
    requestPayload:   payload,
    waHttpStatus:     msgRes.status,
    waResponse:       msgData,
    messageAccepted:  !!msgData?.messages?.[0]?.id,
    messageId:        msgData?.messages?.[0]?.id || null,
    errorCode:        msgData?.error?.code || null,
    errorMessage:     msgData?.error?.message || null,
  })
}
