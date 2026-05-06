import { createClient } from '@supabase/supabase-js'

const GITHUB_OWNER  = 'bhaveshshah3feb'
const GITHUB_REPO   = 'china-supplier-portal'
const WORKFLOW_FILE = 'process-videos.yml'
const MIN_INTERVAL_MINS = 3   // don't hammer GitHub Actions more than once per 3 min

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

    // Any authenticated user (supplier or admin) can call this
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
    if (!token) return res.status(401).json({ error: 'Not authenticated' })

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' })

    const { data: rows } = await supabaseAdmin.from('settings').select('key, value')
    const cfg = {}
    for (const r of (rows || [])) cfg[r.key] = r.value

    const pat = cfg.github_pat
    if (!pat) return res.status(200).json({ ok: false, reason: 'github_pat not configured', skipped: true })

    // Rate limit: don't trigger more than once per MIN_INTERVAL_MINS
    if (cfg.last_auto_trigger) {
      const minsSince = (Date.now() - new Date(cfg.last_auto_trigger).getTime()) / 60000
      if (minsSince < MIN_INTERVAL_MINS) {
        return res.status(200).json({ ok: false, reason: `Rate limited (${minsSince.toFixed(1)} min ago)`, skipped: true })
      }
    }

    // Only trigger if there are actually pending jobs
    const { count } = await supabaseAdmin
      .from('processing_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    if (!count || count === 0) {
      return res.status(200).json({ ok: false, reason: 'No pending jobs', skipped: true })
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
      console.error('GitHub dispatch error:', ghRes.status, txt)
      return res.status(200).json({ ok: false, reason: `GitHub error ${ghRes.status}` })
    }

    // Record trigger time to enforce rate limit
    await supabaseAdmin.from('settings')
      .upsert({ key: 'last_auto_trigger', value: new Date().toISOString() }, { onConflict: 'key' })

    console.log(`Auto-trigger: ${count} pending jobs, triggered by ${user.email || user.id}`)
    return res.status(200).json({ ok: true, pending_jobs: count })

  } catch (err) {
    console.error('notify-upload-complete error:', err)
    return res.status(500).json({ error: err.message })
  }
}
