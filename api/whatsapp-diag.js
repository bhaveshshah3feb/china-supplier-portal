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

    const { data: rows } = await supabaseAdmin
      .from('settings').select('key, value')
      .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token', 'whatsapp_business_account_id'])
    const cfg = {}
    for (const r of (rows || [])) cfg[r.key] = r.value

    const phoneNumberId = cfg.whatsapp_phone_number_id || ''
    const accessToken   = cfg.whatsapp_access_token   || ''
    const wabaId        = cfg.whatsapp_business_account_id || ''

    const results = { checks: [] }

    // ── Check 1: Credentials present ─────────────────────────
    results.checks.push({
      name:   '1. Credentials in Settings',
      ok:     !!(phoneNumberId && accessToken),
      detail: phoneNumberId
        ? `Phone Number ID: ${phoneNumberId} · Token ends: ...${accessToken.slice(-8)}`
        : 'Phone Number ID is MISSING — go to Settings → WhatsApp.',
    })
    if (!phoneNumberId || !accessToken) return res.status(200).json(results)

    // ── Check 2: Verify phone number ID + token via Meta ──────
    const phoneRes  = await fetch(
      `${WA_API}/${phoneNumberId}?fields=display_phone_number,quality_rating,verified_name,code_verification_status`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const phoneData = await phoneRes.json()

    if (phoneData.error) {
      results.checks.push({
        name:   '2. Token & Phone Number ID (Live Meta Check)',
        ok:     false,
        detail: `Error ${phoneData.error.code}: ${phoneData.error.message}`,
        raw:    phoneData.error,
        fix:    phoneData.error.code === 190
          ? 'Token EXPIRED. Go to Meta Business Suite → System Users → regenerate and update in Settings.'
          : 'Phone Number ID is wrong. Find correct ID in Meta Developer Portal → WhatsApp → API Setup.',
      })
      return res.status(200).json(results)
    }

    results.checks.push({
      name:   '2. Token & Phone Number ID (Live Meta Check)',
      ok:     true,
      detail: `Display number: ${phoneData.display_phone_number} · Verified name: ${phoneData.verified_name} · Quality: ${phoneData.quality_rating}`,
    })

    // ── Check 3: Template status for game_pic + game_vidpic ───
    if (wabaId) {
      const tmplRes  = await fetch(
        `${WA_API}/${wabaId}/message_templates?fields=name,status,language,components&limit=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const tmplData = await tmplRes.json()

      if (tmplData.error) {
        results.checks.push({
          name:   '3. Template Status Check',
          ok:     false,
          detail: `Could not fetch templates: ${tmplData.error.message}`,
          fix:    'Verify the Business Account ID in Settings → WhatsApp.',
        })
      } else {
        const templates  = tmplData.data || []
        const gamePic    = templates.find(t => t.name === 'game_pic')
        const gameVidpic = templates.find(t => t.name === 'game_vidpic')

        const describeTemplate = (t, name) => {
          if (!t) return `"${name}" — NOT FOUND in this WABA. Check the template name is exactly correct (case-sensitive).`
          const header = t.components?.find(c => c.type === 'HEADER')
          const body   = t.components?.find(c => c.type === 'BODY')
          return `"${name}" — Status: ${t.status} · Language: ${t.language} · Header: ${header?.format || 'none'} · Body: "${body?.text?.slice(0, 60)}..."`
        }

        const picOk    = gamePic    && gamePic.status    === 'APPROVED'
        const vidpicOk = gameVidpic && gameVidpic.status === 'APPROVED'

        results.checks.push({
          name:   '3. Template Status (game_pic)',
          ok:     !!picOk,
          detail: describeTemplate(gamePic, 'game_pic'),
          raw:    gamePic,
          fix:    !gamePic
            ? 'Template not found — name mismatch. Check Meta Business Manager → Message Templates for exact name.'
            : gamePic.status !== 'APPROVED'
            ? `Template status is "${gamePic.status}" — must be APPROVED before it can be used.`
            : null,
          langWarning: gamePic && gamePic.language !== 'en'
            ? `Template language is "${gamePic.language}" but our code sends "en" — THIS IS LIKELY THE BUG. Will fix automatically.`
            : null,
        })

        results.checks.push({
          name:   '3. Template Status (game_vidpic)',
          ok:     !!vidpicOk,
          detail: describeTemplate(gameVidpic, 'game_vidpic'),
          raw:    gameVidpic,
          fix:    !gameVidpic
            ? 'Template not found — name mismatch. Check Meta Business Manager → Message Templates for exact name.'
            : gameVidpic.status !== 'APPROVED'
            ? `Template status is "${gameVidpic.status}" — must be APPROVED before it can be used.`
            : null,
          langWarning: gameVidpic && gameVidpic.language !== 'en'
            ? `Template language is "${gameVidpic.language}" but our code sends "en" — THIS IS LIKELY THE BUG. Will fix automatically.`
            : null,
        })

        // Store detected language codes for caller to use
        results.detectedLang = {
          game_pic:    gamePic?.language,
          game_vidpic: gameVidpic?.language,
        }
        results.templateComponents = {
          game_pic:    gamePic?.components,
          game_vidpic: gameVidpic?.components,
        }
      }
    } else {
      results.checks.push({
        name:   '3. Template Status Check',
        ok:     null,
        detail: 'Business Account ID not set — cannot check template status. Add it in Settings → WhatsApp → Business Account ID.',
      })
    }

    // ── Check 4: Send a TEMPLATE message (correct test) ───────
    const { to_phone, file_url, file_type } = req.body || {}
    if (to_phone && file_url) {
      const cleanPhone = to_phone.replace(/[^\d]/g, '')
      const lang = results.detectedLang?.[file_type === 'video' ? 'game_vidpic' : 'game_pic'] || 'en_US'
      const templateName = file_type === 'video' ? 'game_vidpic' : 'game_pic'

      const payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: cleanPhone,
        type: 'template',
        template: {
          name: templateName, language: { code: lang },
          components: [
            { type: 'header', parameters: file_type === 'video'
              ? [{ type: 'video', video: { link: file_url } }]
              : [{ type: 'image', image: { link: file_url } }] },
            { type: 'body', parameters: [{ type: 'text', text: 'Test Game' }, { type: 'text', text: 'Amusement Equipment' }] },
          ],
        },
      }

      const msgRes  = await fetch(`${WA_API}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const msgData = await msgRes.json()
      const msgId   = msgData.messages?.[0]?.id

      results.checks.push({
        name:      `4. Template Send Test (${templateName}, lang: ${lang})`,
        ok:        !!msgId,
        detail:    msgId
          ? `✓ Message ID: ${msgId} — accepted by WhatsApp. You should receive it within seconds.`
          : `✗ Error ${msgData.error?.code}: ${msgData.error?.message}`,
        raw:       msgData,
        payload:   payload,
        fix:       msgData.error?.code === 132000 ? 'Template not found or language mismatch.'
          : msgData.error?.code === 132001 ? 'Template parameter count mismatch — header or body params wrong.'
          : msgData.error?.code === 131047 ? 'Message blocked — 24h window (use a template, not free-form).'
          : null,
      })
    } else if (to_phone) {
      results.checks.push({
        name:   '4. Template Send Test',
        ok:     null,
        detail: 'Provide a file_url and file_type to test template sending. Enter a Sales Library image URL above.',
      })
    }

    return res.status(200).json(results)

  } catch (err) {
    console.error('whatsapp-diag error:', err)
    return res.status(500).json({ error: err.message })
  }
}
