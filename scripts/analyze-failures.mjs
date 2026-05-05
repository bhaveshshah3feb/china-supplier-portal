/**
 * analyze-failures.mjs
 * Runs after every process-videos workflow (and daily).
 *
 * 1. Reads failed processing jobs from Supabase (last 24 h)
 * 2. Transient failures (network, download) → re-queued automatically
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

const supabase  = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

const SCRIPT_PATH = join(__dirname, 'process-videos.mjs')

// ── Error classification ──────────────────────────────────────
const TRANSIENT_PATTERNS = [
  /download failed/i, /connection reset/i, /network/i,
  /econnreset/i, /etimedout/i, /econnrefused/i,
  /sales upload failed/i, /socket hang up/i,
]
const FFMPEG_PATTERNS = [/ffmpeg failed/i, /ffmpeg error/i, /undefined constant/i, /invalid option/i, /no such filter/i]

function classify(errorLog) {
  const log = errorLog || ''
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
  const { data } = await supabase
    .from('processing_queue')
    .select('id, job_type, error_log, upload_id, created_at, uploads(original_filename, file_type)')
    .eq('status', 'failed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  return data || []
}

// ── Re-queue transient failures ───────────────────────────────
async function requeueTransient(jobs) {
  if (!jobs.length) return
  const ids = jobs.map(j => j.id)
  await supabase
    .from('processing_queue')
    .update({ status: 'pending', error_log: null, attempts: 0 })
    .in('id', ids)
  console.log(`Re-queued ${ids.length} transient failure(s)`)
}

// ── Ask Claude to diagnose FFmpeg failures ────────────────────
async function diagnoseWithClaude(ffmpegJobs) {
  const errorSummary = ffmpegJobs.map(j =>
    `File: ${j.uploads?.original_filename || 'unknown'} (${j.uploads?.file_type})\nError: ${j.error_log || 'no log'}`
  ).join('\n\n---\n\n')

  const scriptContent = readFileSync(SCRIPT_PATH, 'utf8')

  const prompt = `You are debugging a Node.js video processing script that runs FFmpeg on Ubuntu (GitHub Actions).

The script watermarks amusement arcade videos and images — adding drawbox overlays, drawtext (phone/name), and a logo overlay.

Recent failures with their error logs:
${errorSummary}

Current content of scripts/process-videos.mjs:
\`\`\`javascript
${scriptContent}
\`\`\`

Identify if there is a fixable bug in process-videos.mjs causing these failures.

Respond ONLY with a JSON object — no markdown fences, no extra text:
{
  "has_fix": true or false,
  "description": "one-line summary of what was wrong and what was changed",
  "fixed_content": "complete corrected file content" (only when has_fix is true)
}

Rules:
- Only fix bugs in process-videos.mjs, no other files
- Do not change any feature — only fix the specific error
- If failures are transient (network, disk) or need human review, set has_fix to false`

  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 8000,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = response.content[0]?.text?.trim() || '{}'
  try {
    return JSON.parse(text)
  } catch {
    // Try to extract JSON from the response if it has extra text
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    return { has_fix: false, description: 'Could not parse Claude response' }
  }
}

// ── Apply code fix ────────────────────────────────────────────
function applyFix(fixedContent, description) {
  writeFileSync(SCRIPT_PATH, fixedContent, 'utf8')
  execSync('git config user.email "portal@aryan-amusements.com"')
  execSync('git config user.name "Portal Auto-Heal"')
  execSync(`git add ${SCRIPT_PATH}`)
  execSync(`git commit -m "Auto-fix: ${description}"`)
  execSync('git push')
  console.log('Fix committed and pushed:', description)
}

// ── Send email report ─────────────────────────────────────────
async function sendEmail(cfg, subject, html) {
  const gmailUser = cfg.gmail_user     || process.env.GMAIL_USER
  const gmailPass = cfg.gmail_app_password || process.env.GMAIL_APP_PASSWORD
  const toEmail   = cfg.notification_email || 'bhavesh.shah@gamesnmore.co.in'

  if (!gmailUser || !gmailPass) {
    console.log('Gmail not configured — skipping email')
    return
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  })

  await transporter.sendMail({
    from:    `"Aryan Amusements Portal" <${gmailUser}>`,
    to:      toEmail,
    subject,
    html,
  })
  console.log('Email sent to', toEmail)
}

// ── Build email HTML ──────────────────────────────────────────
function buildEmail({ failures, transient, ffmpegJobs, unknown, claudeResult, codeFixed }) {
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  const failureRows = failures.map(j => `
    <tr>
      <td style="padding:6px 12px;font-size:13px;">${j.uploads?.original_filename || '—'}</td>
      <td style="padding:6px 12px;font-size:13px;">${j.uploads?.file_type || '—'}</td>
      <td style="padding:6px 12px;font-size:12px;color:#dc2626;font-family:monospace;">${(j.error_log || 'no log').slice(0, 200)}</td>
    </tr>`).join('')

  const autoFixBanner = codeFixed ? `
    <div style="background:#d1fae5;border:1px solid #10b981;border-radius:10px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;color:#065f46;font-weight:600;">✅ Auto-fix applied</p>
      <p style="margin:6px 0 0;color:#047857;font-size:14px;">${claudeResult?.description || ''}</p>
      <p style="margin:6px 0 0;color:#047857;font-size:12px;">scripts/process-videos.mjs has been updated and pushed to GitHub.</p>
    </div>` : ''

  const analysisSection = !codeFixed && claudeResult ? `
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;color:#92400e;font-weight:600;">⚠️ Claude analysis</p>
      <p style="margin:6px 0 0;color:#b45309;font-size:14px;">${claudeResult?.description || 'Could not determine root cause — manual review needed.'}</p>
    </div>` : ''

  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px;">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px 32px;">
    <h1 style="margin:0;color:#fff;font-size:20px;">⚠️ Processing Failure Report</h1>
    <p style="margin:6px 0 0;color:#fca5a5;font-size:14px;">Aryan Amusements Supplier Portal · ${date}</p>
  </div>
  <div style="padding:24px 32px;">
    ${autoFixBanner}
    ${analysisSection}

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;">
      <div style="background:#fef2f2;border-radius:10px;padding:14px;text-align:center;">
        <p style="margin:0;font-size:24px;font-weight:700;color:#dc2626;">${failures.length}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Total Failures</p>
      </div>
      <div style="background:#d1fae5;border-radius:10px;padding:14px;text-align:center;">
        <p style="margin:0;font-size:24px;font-weight:700;color:#059669;">${transient.length}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Auto Re-queued</p>
      </div>
      <div style="background:#eff6ff;border-radius:10px;padding:14px;text-align:center;">
        <p style="margin:0;font-size:24px;font-weight:700;color:#2563eb;">${ffmpegJobs.length}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">FFmpeg Errors</p>
      </div>
    </div>

    ${failures.length > 0 ? `
    <h3 style="font-size:15px;color:#111827;margin:0 0 12px;">Failed Jobs</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <thead><tr style="background:#f9fafb;">
        <th style="text-align:left;padding:8px 12px;font-size:11px;color:#6b7280;">File</th>
        <th style="text-align:left;padding:8px 12px;font-size:11px;color:#6b7280;">Type</th>
        <th style="text-align:left;padding:8px 12px;font-size:11px;color:#6b7280;">Error</th>
      </tr></thead>
      <tbody>${failureRows}</tbody>
    </table>` : ''}

    <p style="font-size:12px;color:#9ca3af;">This report was generated automatically by the Portal self-healing workflow.</p>
  </div>
</div>
</body>
</html>`
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('Analyzing processing failures…')

  const [cfg, failures] = await Promise.all([loadSettings(), queryFailures()])

  if (failures.length === 0) {
    console.log('No failures in the last 24 h — all good.')
    return
  }

  console.log(`Found ${failures.length} failure(s)`)

  // Classify
  const transient  = failures.filter(j => classify(j.error_log) === 'transient')
  const ffmpegJobs = failures.filter(j => classify(j.error_log) === 'ffmpeg')
  const unknown    = failures.filter(j => classify(j.error_log) === 'unknown')

  console.log(`  Transient: ${transient.length} | FFmpeg: ${ffmpegJobs.length} | Unknown: ${unknown.length}`)

  // Re-queue transient failures
  if (transient.length > 0) await requeueTransient(transient)

  // Ask Claude about FFmpeg failures
  let claudeResult = null
  let codeFixed    = false

  if (ffmpegJobs.length > 0 && process.env.CLAUDE_API_KEY) {
    try {
      console.log('Asking Claude to diagnose FFmpeg failures…')
      claudeResult = await diagnoseWithClaude(ffmpegJobs)
      console.log('Claude has_fix:', claudeResult.has_fix, '|', claudeResult.description)

      if (claudeResult.has_fix && claudeResult.fixed_content) {
        applyFix(claudeResult.fixed_content, claudeResult.description)
        codeFixed = true
      }
    } catch (err) {
      console.error('Claude diagnosis failed:', err.message)
      claudeResult = { has_fix: false, description: `Claude unavailable: ${err.message}` }
    }
  }

  // Send email report
  const subject = codeFixed
    ? `✅ Auto-fixed processing errors — ${failures.length} failure(s) resolved`
    : `⚠️ Processing failures need attention — ${failures.length} failed job(s)`

  const html = buildEmail({ failures, transient, ffmpegJobs, unknown, claudeResult, codeFixed })

  try {
    await sendEmail(cfg, subject, html)
  } catch (err) {
    console.error('Email failed:', err.message)
  }

  console.log('Analysis complete.')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
