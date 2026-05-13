import { createClient } from '@supabase/supabase-js'

const SITE_URL = process.env.SITE_URL || 'https://supply.indiajobworks.com'

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseAdmin = makeAdmin()
  if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })

  const { token, companyName, phone } = req.body || {}
  if (!token) return res.status(400).json({ error: 'token is required' })

  // Look up the invitation
  const { data: invite, error: invErr } = await supabaseAdmin
    .from('supplier_invitations')
    .select('id, link_type, auth_email, supplier_id, status, expires_at, use_count, created_by')
    .eq('invite_token', token)
    .eq('status', 'pending')
    .maybeSingle()

  if (invErr || !invite) return res.status(404).json({ error: 'Link not found or no longer active' })

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This link has expired. Please contact Aryana Amusements for a new one.' })
  }

  let authEmail = invite.auth_email
  let personalToken = null

  if (invite.link_type === 'open') {
    // Each visitor on an open/broadcast link gets their own supplier account
    const shortId = Math.random().toString(36).slice(2, 10)
    authEmail = `g-${shortId}@upload.internal`

    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      email_confirm: true,
      user_metadata: {
        role: 'supplier',
        company_name_en: companyName || '',
        phone: phone || '',
      },
    })
    if (createErr) return res.status(500).json({ error: 'Could not create account: ' + createErr.message })

    const newUserId = newUser.user.id

    // Update supplier record with any provided details
    if (companyName || phone) {
      await supabaseAdmin.from('suppliers').update({
        company_name_en: companyName || '',
        phone: phone || '',
      }).eq('id', newUserId)
    }

    // Create a personal re-use link for this supplier (so they can return)
    const { data: personal } = await supabaseAdmin
      .from('supplier_invitations')
      .insert({
        link_type: 'specific',
        auth_email: authEmail,
        supplier_id: newUserId,
        auto_signup: true,
        expires_at: null,
        status: 'pending',
        created_by: invite.created_by,
      })
      .select('invite_token')
      .single()

    personalToken = personal?.invite_token

    // Increment use_count on the open link
    await supabaseAdmin.from('supplier_invitations')
      .update({ use_count: (invite.use_count || 0) + 1 })
      .eq('id', invite.id)

  } else {
    // Specific link: auth user already created — just generate a fresh magic link
    if (!authEmail) {
      return res.status(500).json({ error: 'This link is not yet activated. Please contact Aryana Amusements.' })
    }
    await supabaseAdmin.from('supplier_invitations')
      .update({ use_count: (invite.use_count || 0) + 1 })
      .eq('id', invite.id)
  }

  // Generate a Supabase magic link for the auth user
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: authEmail,
    options: { redirectTo: `${SITE_URL}/dashboard` },
  })

  if (linkErr) return res.status(500).json({ error: 'Could not generate login link: ' + linkErr.message })

  return res.status(200).json({
    redirectUrl: linkData.properties.action_link,
    isOpen: invite.link_type === 'open',
    personalToken,
  })
}
