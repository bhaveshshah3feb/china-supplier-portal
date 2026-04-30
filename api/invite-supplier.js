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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Check service key is configured ──────────────────────
  const supabaseAdmin = makeAdmin()
  if (!supabaseAdmin) {
    return res.status(500).json({
      error: 'Server not configured. Add SUPABASE_SERVICE_KEY to Vercel environment variables.',
    })
  }

  // ── Verify caller is admin ─────────────────────────────
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) return res.status(401).json({ error: 'Not authenticated' })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })
  if (user.user_metadata?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }

  const { action = 'create' } = req.body

  // ═══════════════════════════════════════════════════════
  // ACTION: send email for an already-created invite
  // ═══════════════════════════════════════════════════════
  if (action === 'email') {
    const { invite_token } = req.body
    if (!invite_token) return res.status(400).json({ error: 'invite_token required' })

    const { data: invite, error: fetchErr } = await supabaseAdmin
      .from('supplier_invitations')
      .select('*')
      .eq('invite_token', invite_token)
      .maybeSingle()

    if (fetchErr || !invite) return res.status(404).json({ error: 'Invitation not found' })

    const { error: emailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      invite.email,
      {
        data: {
          company_name_en:   invite.company_name_en,
          company_name_zh:   invite.company_name_zh,
          phone:             invite.phone,
          contact_person_en: invite.contact_person_en,
          contact_person_zh: invite.contact_person_zh,
          role: 'supplier',
        },
        redirectTo: `${SITE_URL}/dashboard`,
      }
    )

    if (emailErr) {
      return res.status(500).json({
        error: emailErr.message.includes('already been invited')
          ? 'This email was already invited via Supabase. The supplier should check their inbox.'
          : emailErr.message,
      })
    }

    await supabaseAdmin
      .from('supplier_invitations')
      .update({ channel: 'email' })
      .eq('invite_token', invite_token)

    return res.status(200).json({ success: true })
  }

  // ═══════════════════════════════════════════════════════
  // ACTION: create a new invite record (default)
  // ═══════════════════════════════════════════════════════
  const {
    email, company_name_en, company_name_zh = '',
    phone = '', contact_person_en = '', contact_person_zh = '',
    notes = '',
  } = req.body

  if (!email)           return res.status(400).json({ error: 'Email is required' })
  if (!company_name_en) return res.status(400).json({ error: 'Company name (English) is required' })

  const cleanEmail = email.toLowerCase().trim()

  // Re-use existing pending invite if one exists for this email
  const { data: existing } = await supabaseAdmin
    .from('supplier_invitations')
    .select('invite_token')
    .eq('email', cleanEmail)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (existing) {
    return res.status(200).json({
      invite_token: existing.invite_token,
      invite_url:   `${SITE_URL}/register?invite=${existing.invite_token}`,
      reused:       true,
    })
  }

  // Create new invitation record
  const { data: invite, error: insertErr } = await supabaseAdmin
    .from('supplier_invitations')
    .insert({
      email: cleanEmail,
      company_name_en,
      company_name_zh,
      phone,
      contact_person_en,
      contact_person_zh,
      notes,
      created_by: user.id,
    })
    .select('invite_token')
    .single()

  if (insertErr) {
    return res.status(500).json({ error: `Database error: ${insertErr.message}` })
  }

  return res.status(200).json({
    invite_token: invite.invite_token,
    invite_url:   `${SITE_URL}/register?invite=${invite.invite_token}`,
  })
}
