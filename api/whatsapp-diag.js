import { createClient } from '@supabase/supabase-js'

const WA_API = 'https://graph.facebook.com/v19.0'

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

  try {
    const supabaseAdmin = makeAdmin()
    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })

    const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
    if (!token) return res.status(401).json({ error: 'Not authenticated' })

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !user || user.user_metadata?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    // Load credentials
    const { data: rows } = await supabaseAdmin
      .from('settings').select('key, value')
      .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token', 'whatsapp_business_account_id'])
    const cfg = {}
    for (const r of (rows || [])) cfg[r.key] = r.value

    const phoneNumberId = cfg.whatsapp_phone_number_id || ''
    const accessToken   = cfg.whatsapp_access_token   || ''
    const wabaId        = cfg.whatsapp_business_account_id || ''

    const results = { phoneNumberId, wabaId: wabaId || '(not set)', checks: [] }

    // ── 1. Check credentials are present ──────────────────────
    results.checks.push({
      name:   'Credentials in Settings',
      ok:     !!(phoneNumberId && accessToken),
      detail: phoneNumberId
        ? `Phone Number ID: ${phoneNumberId} · Token: ${accessToken ? '***' + accessToken.slice(-6) : 'MISSING'}`
        : 'Phone Number ID is missing — check Settings → WhatsApp',
    })

    if (!phoneNumberId || !accessToken) {
      return res.status(200).json(results)
    }

    // ── 2. Verify token + Phone Number ID via Meta GET ─────────
    const phoneRes  = await fetch(
      `${WA_API}/${phoneNumberId}?fields=display_phone_number,quality_rating,verified_name,code_verification_status,platform_type`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const phoneData = await phoneRes.json()

    if (phoneData.error) {
      results.checks.push({
        name:   'Token & Phone Number ID',
        ok:     false,
        detail: `Error ${phoneData.error.code}: ${phoneData.error.message}`,
        raw:    phoneData.error,
        fix:    phoneData.error.code === 190
          ? 'Token expired. Go to Meta Business Suite → System Users → regenerate the token and update it in Settings.'
          : phoneData.error.code === 100
          ? 'Phone Number ID is wrong. Find the correct ID in Meta Developer Portal → WhatsApp → API Setup.'
          : 'Check your credentials in Settings → WhatsApp.',
      })
    } else {
      results.checks.push({
        name:   'Token & Phone Number ID',
        ok:     true,
        detail: `Display number: ${phoneData.display_phone_number} · Name: ${phoneData.verified_name} · Quality: ${phoneData.quality_rating} · Status: ${phoneData.code_verification_status}`,
        phoneDetails: phoneData,
      })
    }

    // ── 3. Check WABA if provided ──────────────────────────────
    if (wabaId) {
      const wabaRes  = await fetch(
        `${WA_API}/${wabaId}?fields=name,currency,account_review_status,on_behalf_of_business_info`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const wabaData = await wabaRes.json()

      if (wabaData.error) {
        results.checks.push({
          name:   'WhatsApp Business Account',
          ok:     false,
          detail: `Error ${wabaData.error.code}: ${wabaData.error.message}`,
        })
      } else {
        results.checks.push({
          name:   'WhatsApp Business Account',
          ok:     true,
          detail: `Name: ${wabaData.name} · Review status: ${wabaData.account_review_status || 'not shown'}`,
          wabaDetails: wabaData,
        })
      }
    }

    // ── 4. Send a real test message and capture full response ──
    const { to_phone } = req.body || {}
    if (to_phone) {
      const cleanPhone = to_phone.replace(/[^\d]/g, '')
      const testPayload = {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                cleanPhone,
        type:              'text',
        text:              { preview_url: false, body: 'Diagnostic test from Aryan Amusements portal. If you receive this, WhatsApp is working.' },
      }

      const msgRes  = await fetch(`${WA_API}/${phoneNumberId}/messages`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(testPayload),
      })
      const msgData = await msgRes.json()

      results.checks.push({
        name:      'Live Message Send Test',
        ok:        !!(msgData.messages?.[0]?.id),
        detail:    msgData.messages?.[0]?.id
          ? `Message ID: ${msgData.messages[0].id} — accepted by WhatsApp.`
          : `Failed: ${msgData.error?.message || 'Unknown error'}`,
        raw:       msgData,
        httpStatus: msgRes.status,
        fix:       msgData.error?.code === 131047
          ? 'Message blocked — 24h window closed. The recipient must message your business number first.'
          : msgData.error?.code === 131026
          ? 'Phone not on WhatsApp or not reachable.'
          : msgData.error?.code === 132000
          ? 'App is in development mode. Add this phone number as a test number in Meta Developer Portal → WhatsApp → API Setup → Recipient phone numbers.'
          : null,
      })

      // Important note about dev mode
      if (msgData.messages?.[0]?.id) {
        results.checks.push({
          name:   'Dev Mode Warning',
          ok:     null,
          detail: 'Message was ACCEPTED (got a message ID) but may not have been DELIVERED. ' +
                  'If you did not receive it, your Meta App is likely in development mode. ' +
                  'Go to Meta Developer Portal → your App → WhatsApp → API Setup → "To" section → ' +
                  'add your phone number as a recipient and verify it via OTP. ' +
                  'Or submit the app for App Review to go live.',
        })
      }
    }

    return res.status(200).json(results)

  } catch (err) {
    console.error('whatsapp-diag error:', err)
    return res.status(500).json({ error: err.message })
  }
}
