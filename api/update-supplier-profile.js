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

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) return res.status(401).json({ error: 'Not authenticated' })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  const { company_name_en, company_name_zh, email, phone } = req.body || {}

  // Build supplier row update
  const supplierUpdate = {}
  if (company_name_en !== undefined) supplierUpdate.company_name_en = company_name_en
  if (company_name_zh !== undefined) supplierUpdate.company_name_zh = company_name_zh
  if (phone !== undefined) supplierUpdate.phone = phone
  if (email) supplierUpdate.email = email

  if (Object.keys(supplierUpdate).length > 0) {
    const { error: supErr } = await supabaseAdmin
      .from('suppliers').update(supplierUpdate).eq('id', user.id)
    if (supErr) return res.status(500).json({ error: 'Could not update profile: ' + supErr.message })
  }

  // If a real email was provided, link it to the auth user (enables OTP/password login)
  if (email && !email.endsWith('@upload.internal') && email !== user.email) {
    const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email,
      email_confirm: true,
    })
    if (emailErr) return res.status(500).json({ error: 'Could not update email: ' + emailErr.message })
  }

  return res.status(200).json({ success: true })
}
