/**
 * analyze-failures.mjs
 * Runs after every process-videos workflow (and daily).
 *
 * 1. Reads ALL failed processing jobs from Supabase (last 24 h)
 * 2. ALL failed jobs are re-queued (transient + ffmpeg + unknown)
 * 3. FFmpeg / code failures → sent to Claude for diagnosis
 * 4. If Claude returns a fix → patches process-videos.mjs, commits, pushes
 * 5. Sends an email to Bhavesh summarising everything done
 *
 * Automatic code changes are restricted to scripts/process-videos.mjs only.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic         from '@anthropic-ai/sdk'
import nodemailer        from 'nodemailer'
import { execSync }      from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const REPO_ROOT  = join(__dirname, '..')   // repo root (one level up from scripts/)
const SCRIPT_PATH = join(__dirname, 'process-videos.mjs')

const supabase  = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

// ── Error classification ──────────────────────────────────────
const TRANSIENT_PATTERNS = [
  /download failed/i, /connection reset/i, /network/i,
  /econnreset/i, /etimedout/i, /econnrefused/i,
  /sales upload failed/i, /socket hang up/i, /timed out/i,
]
const FFMPEG_PATTERNS = [
  /ffmpeg failed/i, /ffmpeg error/i, /undefined constant/i,
  /invalid option/i, /no such filter/i, /invalid data/i,
  /could not extract frames/i, /filter_complex/i,
]

function classify(errorLog) {
  const log = errorLog || ''
  if (!log) return 'no-log'
  if (TRANSIENT_PATTERNS.some(p => p.test(log))) return 'transient'
  if (FFMPEG_PATTERNS.some(p => p.test(log)))    return 'ffmpeg'
  return 'unknown'
}

// ── Load settings ─────────────────────────────────────────────
async function loadSettings() {
  const { data } = await supabase.from('settings').select('key, value')
  const cfg = {}
  for (const r of (data || [])) cfg[r.key] = r.value
  return cfg
}

// ── Query recent failures ─────────────────────────────────────
async function queryFailures() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('processing_queue')
    .select('id, job_type, error_log, upload_id, attempts, created_at, uploads(original_filename, file_type)')
    .eq('status', 'failed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (error) console.error('Failed to query failures:', error.message)
  return data || []
}

// ── Re-queue jobs ─────────────────────────────────────────────
// Resets status to pending and clears attempts so process-videos picks them up.
async function requeueJobs(jobs, label = '') {
  if (!jobs.length) return
  const ids = jobs.map(j => j.id)
  const { error } = await supabase
    .from('processing_queue')
    .update({ status: 'pending', error_log: null, attempts: 0 })
    .in('id', ids)
  if (error) console.error('Re-queue error:', error.message)
  else console.log(`Re-queued ${ids.length} job(s)${label ? ' (' + label + ')' : ''}`)
}

// ── Ask Claude to diagnose FFmpeg failures ────────────────────
async function diagnoseWithClaude(ffmpegJobs) {
  const errorSummary = ffmpegJobs.slice(0, 5).map(j =>
    `File: ${j.uploads?.original_filename || 'unknown'} (${j.uploads?.file_type})\nError log: ${(j.error_log || 'no log').slice(0, 500)}`
  ).join('\n\n---\n\n')

  const scriptContent = readFileSync(SCRIPT_PATH, 'utf8')

  const prompt = `You are debugging a Node.js video processing script that runs FFmpeg on Ubuntu (GitHub Actions).
The script watermarks amusement arcade videos and images — adding drawbox overlays, drawtext, and a logo overlay.

Recent failures with their error logs:
${errorSummary}

Current content of scripts/process-videos.mjs:
\`\`\`javascript
${scriptContent}
\`\`\`

Identify if there is a fixable bug in process-videos.mjs causing these failures.
Respond ONLY with a JSON object (no markdown, no extra text):
{
  "has_fix": true or false,
  "description": "one-line summary of what was wrong and what was fixed",
  "fixed_content": "complete corrected file content"
}
Rules: only fix bugs in process-videos.mjs; if errors are transient or unclear set has_fix false.`

  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 8000,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = response.content[0]?.text?.trim() || '{}'
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) { try { return JSON.parse(match[0]) } catch {} }
    return { has_fix: false, description: 'Could not parse Claude response' }
  }
}

// ── Apply code fix and push ───────────────────────────────────
function git(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, stdio: 'pipe' }).toString().trim()
}

function applyFix(fixedContent, description) {
  writeFileSync(SCRIPT_PATH, fixedContent, 'utf8')
  git('git config user.email "portal@aryan-amusements.com"')
  git('git config user.name "Portal Auto-Heal"')
  git('git fetch origin master')
  git('git reset --soft origin/master')  // ensure we're up to date
  git('git add scripts/process-videos.mjs')
  git(`git commit -m "Auto-fix: ${description.replace(/"/g, "'")}"`)
  git('git push origin HEAD:master')
  console.log('Fix committed and pushed:', description)
}

// ── Send email report ─────────────────────────────────────────
async function sendEmail(cfg, subject, html) {
  const gmailUser = cfg.gmail_user         || process.env.GMAIL_USER
  const gmailPass = cfg.gmail_app_password || process.env.GMAIL_APP_PASSWORD
  const toEmail   = cfg.notification_email || 'bhavesh.shah@gamesnmore.co.in'
  if (!gmailUser || !gmailPass) { console.log('Gmail not configured — skipping email'); return }
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
  await transporter.sendMail({ from: `"Aryan Amusements Portal" <${gmailUser}>`, to: toEmail, subject, html })
  console.log('Email sent to', toEmail)
}

// ── Build email HTML ──────────────────────────────────────────
function buildEmail({ failures, transient, ffmpegJobs, unknown, noLog, claudeResult, codeFixed, gitError }) {
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const totalRequeued = failures.length  // we re-queue all of them

  const rows = failures.map(j => {
    const cat = classify(j.error_log)
    const catColor = cat === 'transient' ? '#059669' : cat === 'ffmpeg' ? '#dc2626' : '#6b7280'
    return `<tr>
      <td style="padding:6px 12px;font-size:13px;">${j.uploads?.original_filename || '—'}</td>
      <td style="padding:6px 12px;font-size:12px;">${j.uploads?.file_type || '—'}</td>
      <td style="padding:6px 12px;font-size:12px;color:${catColor};">${cat}</td>
      <td style="padding:6px 12px;font-size:11px;color:#dc2626;font-family:monospace;">${(j.error_log || 'no log').slice(0, 150)}</td>
    </tr>`
  }).join('')

  const fixBanner = codeFixed
    ? `<div style="background:#d1fae5;border:1px solid #10b981;border-radius:10px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;color:#065f46;font-weight:600;">✅ Auto-fix applied to scripts/process-videos.mjs</p>
        <p style="margin:6px 0 0;color:#047857;font-size:14px;">${claudeResult?.description || ''}</p>
        <p style="margin:6px 0 0;color:#047857;font-size:12px;">The fix has been committed and pushed. All failed jobs have been re-queued and will be processed in the next run.</p>
       </div>` : ''

  const gitErrBanner = gitError
    ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px;margin-bottom:16px;">
        <p style="margin:0;color:#991b1b;font-size:13px;">⚠️ Could not push auto-fix to GitHub: ${gitError}</p>
       </div>` : ''

  const analysisBanner = !codeFixed && claudeResult
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;color:#92400e;font-weight:600;">Claude analysis</p>
        <p style="margin:6px 0 0;color:#b45309;font-size:14px;">${claudeResult.description || 'No specific code fix identified — failures may be transient.'}</p>
       </div>` : ''

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f9fafb;margin:0;padding:24px;">
<div style="max-width:750px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px 32px;">
    <h1 style="margin:0;color:#fff;font-size:20px;">⚠️ Processing Failure Report</h1>
    <p style="margin:6px 0 0;color:#fca5a5;font-size:14px;">Aryan Amusements Supplier Portal · ${date}</p>
  </div>
  <div style="padding:24px 32px;">
    ${fixBanner}${gitErrBanner}${analysisBanner}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px;">
      <div style="background:#fef2f2;border-radius:10px;padding:12px;text-align:center;">
        <p style="margin:0;font-size:22px;font-weight:700;color:#dc2626;">${failures.length}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">Total Failed</p>
      </div>
      <div style="background:#d1fae5;border-radius:10px;padding:12px;text-align:center;">
        <p style="margin:0;font-size:22px;font-weight:700;color:#059669;">${totalRequeued}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">Re-queued</p>
      </div>
      <div style="background:#eff6ff;border-radius:10px;padding:12px;text-align:center;">
        <p style="margin:0;font-size:22px;font-weight:700;color:#2563eb;">${ffmpegJobs.length}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">FFmpeg Errors</p>
      </div>
      <div style="background:#f5f3ff;border-radius:10px;padding:12px;text-align:center;">
        <p style="margin:0;font-size:22px;font-weight:700;color:#7c3aed;">${transient.length}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">Transient</p>
      </div>
    </div>
    ${failures.length > 0 ? `
    <h3 style="font-size:14px;color:#111827;margin:0 0 10px;">Failed Jobs (all re-queued)</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;">
      <thead><tr style="background:#f9fafb;">
        <th style="text-align:left;padding:7px 12px;color:#6b7280;">File</th>
        <th style="text-align:left;padding:7px 12px;color:#6b7280;">Type</th>
        <th style="text-align:left;padding:7px 12px;color:#6b7280;">Category</th>
        <th style="text-align:left;padding:7px 12px;color:#6b7280;">Error</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>` : ''}
    <p style="font-size:11px;color:#9ca3af;">Generated automatically by Portal self-healing workflow.</p>
  </div>
</div></body></html>`
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('Analyzing processing failures…')

  const [cfg, failures] = await Promise.all([loadSettings(), queryFailures()])

  if (failures.length === 0) {
    console.log('No failures in the last 24 h — nothing to do.')
    return
  }

  console.log(`Found ${failures.length} failure(s)`)
  failures.forEach(j => console.log(`  [${classify(j.error_log)}] ${j.uploads?.original_filename || j.id}: ${(j.error_log || 'no log').slice(0, 100)}`))

  const transient  = failures.filter(j => classify(j.error_log) === 'transient')
  const ffmpegJobs = failures.filter(j => classify(j.error_log) === 'ffmpeg')
  const unknown    = failures.filter(j => ['unknown', 'no-log'].includes(classify(j.error_log)))

  // Re-queue ALL failed jobs — transient ones will just work on retry;
  // code-error ones will benefit from any fix Claude applies below.
  await requeueJobs(failures, 'all categories')

  // Ask Claude to diagnose FFmpeg/code-level failures
  let claudeResult = null
  let codeFixed    = false
  let gitError     = null

  if (ffmpegJobs.length > 0 && process.env.CLAUDE_API_KEY) {
    try {
      console.log('Asking Claude to diagnose FFmpeg failures…')
      claudeResult = await diagnoseWithClaude(ffmpegJobs)
      console.log('Claude result — has_fix:', claudeResult.has_fix, '|', claudeResult.description)

      if (claudeResult.has_fix && claudeResult.fixed_content) {
        try {
          applyFix(claudeResult.fixed_content, claudeResult.description)
          codeFixed = true
        } catch (err) {
          gitError = err.message
          console.error('Git push failed:', err.message)
        }
      }
    } catch (err) {
      claudeResult = { has_fix: false, description: `Claude unavailable: ${err.message}` }
      console.error('Claude diagnosis failed:', err.message)
    }
  } else if (unknown.length > 0 || failures.length > 0) {
    claudeResult = { has_fix: false, description: 'All failed jobs have been re-queued for retry.' }
  }

  const subject = codeFixed
    ? `✅ Auto-fixed & re-queued ${failures.length} processing failure(s)`
    : `⚠️ ${failures.length} processing failure(s) re-queued for retry`

  const html = buildEmail({ failures, transient, ffmpegJobs, unknown, claudeResult, codeFixed, gitError })

  try {
    await sendEmail(cfg, subject, html)
  } catch (err) {
    console.error('Email failed:', err.message)
  }

  console.log('Analysis complete.')
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
