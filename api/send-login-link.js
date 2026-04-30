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

  const { supplier_email } = req.body
  if (!supplier_email) return res.status(400).json({ error: 'supplier_email is required' })

  // ── Generate a magic link (valid 24 hours) ─────────────────
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: supplier_email,
    options: {
      redirectTo: `${SITE_URL}/dashboard`,
    },
  })

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({
    link: data.properties.action_link,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
}
