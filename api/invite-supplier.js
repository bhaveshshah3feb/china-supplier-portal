import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const SITE_URL = process.env.SITE_URL || 'https://supply.indiajobworks.com'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth check: must be admin ──────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' })
  if (user.user_metadata?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' })

  // ── Validate input ─────────────────────────────────────────
  const {
    email, company_name_en, company_name_zh = '',
    phone = '', contact_person_en = '', contact_person_zh = '',
    notes = '', send_email = false, channel = 'manual',
  } = req.body

  if (!email || !company_name_en) {
    return res.status(400).json({ error: 'Email and company name (English) are required' })
  }

  // ── Re-use existing pending invite if one already exists ───
  const { data: existing } = await supabaseAdmin
    .from('supplier_invitations')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  let invite = existing

  if (!invite) {
    const { data: newInvite, error: invErr } = await supabaseAdmin
      .from('supplier_invitations')
      .insert({
        email: email.toLowerCase().trim(),
        company_name_en,
        company_name_zh,
        phone,
        contact_person_en,
        contact_person_zh,
        notes,
        channel,
        created_by: user.id,
      })
      .select()
      .single()

    if (invErr) return res.status(500).json({ error: invErr.message })
    invite = newInvite
  } else {
    // Update channel if re-sending via a different channel
    await supabaseAdmin
      .from('supplier_invitations')
      .update({ channel })
      .eq('id', invite.id)
  }

  const invite_url = `${SITE_URL}/register?invite=${invite.invite_token}`

  // ── Optionally send email via Supabase admin ───────────────
  let email_sent = false
  let email_error = null

  if (send_email) {
    const { error: emailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.toLowerCase().trim(),
      {
        data: {
          company_name_en,
          company_name_zh,
          phone,
          contact_person_en,
          contact_person_zh,
          role: 'supplier',
          invite_token: invite.invite_token,
        },
        redirectTo: `${SITE_URL}/dashboard`,
      }
    )
    email_sent = !emailErr
    email_error = emailErr?.message || null
  }

  return res.status(200).json({
    invite_token: invite.invite_token,
    invite_url,
    email_sent,
    email_error,
  })
}
