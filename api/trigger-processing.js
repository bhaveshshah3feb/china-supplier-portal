import { createClient } from '@supabase/supabase-js'

const GITHUB_OWNER  = 'bhaveshshah3feb'
const GITHUB_REPO   = 'china-supplier-portal'
const WORKFLOW_FILE = 'process-videos.yml'

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
    const supabase = makeAdmin()
    if (!supabase) return res.status(500).json({ error: 'Server not configured (missing env vars)' })

    const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
    if (!token) return res.status(401).json({ error: 'Not authenticated' })

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    if (user.user_metadata?.role !== 'admin') {
      const { data: admin } = await supabase
        .from('admins').select('id').eq('id', user.id).maybeSingle()
      if (!admin) return res.status(403).json({ error: 'Admin access required' })
    }

    const { data: rows } = await supabase.from('settings').select('key, value')
    const cfg = {}
    for (const r of (rows || [])) cfg[r.key] = r.value

    const pat = cfg.github_pat
    if (!pat) {
      return res.status(400).json({
        error: 'GitHub PAT not configured. Go to Settings → Automation and add your token.',
      })
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${pat}`,
          Accept:         'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent':   'AryanAmusements-Portal',
        },
        body: JSON.stringify({ ref: 'master' }),
      }
    )

    if (!ghRes.ok) {
      const txt = await ghRes.text()
      return res.status(502).json({ error: `GitHub API error (${ghRes.status}): ${txt}` })
    }

    return res.status(200).json({ ok: true })

  } catch (err) {
    console.error('trigger-processing error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
