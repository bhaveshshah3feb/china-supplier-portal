import { createClient } from '@supabase/supabase-js'

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const supabaseAdmin = makeAdmin()
    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })

    const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
    if (!token) return res.status(401).json({ error: 'Not authenticated' })

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !user || user.user_metadata?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    // ── PATCH: update permissions or status ──────────────────
    if (req.method === 'PATCH') {
      const { id, permissions, status } = req.body
      if (!id) return res.status(400).json({ error: 'id required' })
      const updates = {}
      if (permissions !== undefined) updates.permissions = permissions
      if (status       !== undefined) updates.status      = status
      const { error: updateErr } = await supabaseAdmin
        .from('staff_users').update(updates).eq('id', id)
      if (updateErr) return res.status(500).json({ error: updateErr.message })
      return res.status(200).json({ ok: true })
    }

    // ── DELETE: deactivate user ──────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.body
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error: delErr } = await supabaseAdmin
        .from('staff_users').update({ status: 'inactive' }).eq('id', id)
      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.status(200).json({ ok: true })
    }

    // ── POST: invite new user ────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const { name, email, role, permissions } = req.body
    if (!name || !email || !role) return res.status(400).json({ error: 'name, email and role are required' })
    if (!['staff', 'supplier'].includes(role)) return res.status(400).json({ error: 'role must be staff or supplier' })

    const appUrl = req.headers.origin || 'https://supply.indiajobwork.com'

    // Check if already invited
    const { data: existing } = await supabaseAdmin
      .from('staff_users').select('id, status').eq('email', email).maybeSingle()
    if (existing) {
      if (existing.status === 'active') return res.status(409).json({ error: 'User already active' })
      // Re-invite: resend the invite email
    }

    // Create auth invite
    const redirectTo = role === 'supplier' ? `${appUrl}/login` : `${appUrl}/admin/dashboard`
    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { name, role },
    })
    if (inviteErr) return res.status(500).json({ error: inviteErr.message })

    const authUserId = inviteData?.user?.id

    // Upsert staff_users record
    const staffRecord = {
      email,
      name,
      role,
      permissions: role === 'staff' ? (permissions || {}) : {},
      status:      'invited',
      invited_by:  user.id,
      invite_sent_at: new Date().toISOString(),
    }
    if (authUserId) staffRecord.auth_user_id = authUserId
    if (existing) {
      await supabaseAdmin.from('staff_users').update(staffRecord).eq('id', existing.id)
    } else {
      await supabaseAdmin.from('staff_users').insert(staffRecord)
    }

    // For suppliers: activate their supplier record automatically
    if (role === 'supplier' && authUserId) {
      setTimeout(async () => {
        await supabaseAdmin.from('suppliers')
          .update({ status: 'active' })
          .eq('id', authUserId)
      }, 3000) // wait for trigger to create supplier row
    }

    return res.status(200).json({ ok: true, message: `Invite sent to ${email}` })

  } catch (err) {
    console.error('invite-user error:', err)
    return res.status(500).json({ error: err.message })
  }
}
