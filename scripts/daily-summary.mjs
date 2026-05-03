/**
 * daily-summary.mjs
 * Runs daily via GitHub Actions.
 * Queries 24-hour activity from Supabase, then sends:
 *   1. WhatsApp message to the configured notification number
 *   2. HTML email via Resend (if RESEND_API_KEY is set)
 * Also sends a WhatsApp reminder if the admin hasn't logged in for 2+ days.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Load settings from DB ─────────────────────────────────────
async function loadSettings() {
  const { data } = await supabase.from('settings').select('key, value')
  const cfg = {}
  for (const r of (data || [])) cfg[r.key] = r.value
  return cfg
}

// ── Gather activity data ──────────────────────────────────────
async function gatherStats() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: newUploads },
    { data: processed },
    { data: failed },
    { count: totalReady },
    { count: totalSuppliers },
    { data: adminUser },
  ] = await Promise.all([
    supabase.from('uploads')
      .select('id, original_filename, file_type, suppliers(company_name_en, supplier_code)')
      .gte('created_at', since)
      .order('created_at', { ascending: false }),

    supabase.from('processing_queue')
      .select('id, job_type, uploads(original_filename)')
      .eq('status', 'completed')
      .gte('completed_at', since),

    supabase.from('processing_queue')
      .select('id, error_log, uploads(original_filename)')
      .eq('status', 'failed')
      .gte('created_at', since),

    supabase.from('uploads')
      .select('id', { count: 'exact', head: true })
      .eq('processing_status', 'completed')
      .not('sales_path', 'is', null),

    supabase.from('suppliers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),

    // Check admin's last login via auth.users
    supabase.from('admins')
      .select('id, email')
      .limit(1)
      .maybeSingle(),
  ])

  // Get admin's last_sign_in_at from auth.users
  let lastLogin = null
  let daysSinceLogin = 0
  if (adminUser?.id) {
    const { data: authUser } = await supabase.auth.admin.getUserById(adminUser.id)
    lastLogin = authUser?.user?.last_sign_in_at
    if (lastLogin) {
      daysSinceLogin = Math.floor((Date.now() - new Date(lastLogin).getTime()) / (1000 * 60 * 60 * 24))
    }
  }

  // Upload breakdown by type
  const uploads = newUploads || []
  const videoCount = uploads.filter(u => u.file_type === 'video').length
  const imageCount = uploads.filter(u => u.file_type === 'image').length
  const docCount   = uploads.filter(u => !['video','image'].includes(u.file_type)).length

  return {
    date: new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    uploads, videoCount, imageCount, docCount,
    processedCount: (processed || []).length,
    failedCount:    (failed || []).length,
    totalReady:     totalReady || 0,
    totalSuppliers: totalSuppliers || 0,
    lastLogin, daysSinceLogin,
    failed: failed || [],
  }
}

// ── WhatsApp message ──────────────────────────────────────────
function buildWhatsAppMessage(stats) {
  const lines = [
    `*📊 Daily Portal Summary — Aryan Amusements*`,
    `📅 ${stats.date}`,
    ``,
    `*📤 New Uploads Today: ${stats.uploads.length}*`,
  ]

  if (stats.uploads.length > 0) {
    lines.push(`  🎬 Videos: ${stats.videoCount}`)
    lines.push(`  🖼️ Images: ${stats.imageCount}`)
    lines.push(`  📄 Documents: ${stats.docCount}`)
  }

  lines.push(``)
  lines.push(`*✅ Processed Today: ${stats.processedCount}*`)

  if (stats.failedCount > 0) {
    lines.push(`*❌ Failed Jobs: ${stats.failedCount}*`)
    for (const f of stats.failed.slice(0, 3)) {
      lines.push(`  • ${f.uploads?.original_filename || 'unknown'}`)
    }
  }

  lines.push(``)
  lines.push(`*📚 Total Sales Library: ${stats.totalReady} files*`)
  lines.push(`*🏭 Active Suppliers: ${stats.totalSuppliers}*`)

  if (stats.daysSinceLogin >= 2) {
    lines.push(``)
    lines.push(`⚠️ *Reminder:* You haven't logged in for ${stats.daysSinceLogin} days. New uploads may be waiting for review!`)
  }

  lines.push(``)
  lines.push(`_Aryan Amusements Supplier Portal_`)

  return lines.join('\n')
}

// ── HTML email ────────────────────────────────────────────────
function buildEmailHtml(stats) {
  const failedRows = stats.failed.slice(0, 5).map(f =>
    `<tr><td style="padding:6px 12px;color:#dc2626;font-size:13px;">✗ ${f.uploads?.original_filename || '—'}</td></tr>`
  ).join('')

  const uploadRows = stats.uploads.slice(0, 10).map(u =>
    `<tr>
      <td style="padding:4px 12px;font-size:12px;color:#374151;">${u.file_type === 'video' ? '🎬' : u.file_type === 'image' ? '🖼️' : '📄'} ${u.original_filename}</td>
      <td style="padding:4px 12px;font-size:12px;color:#6b7280;">${u.suppliers?.company_name_en || '—'} (${u.suppliers?.supplier_code || '—'})</td>
    </tr>`
  ).join('')

  const reminderBanner = stats.daysSinceLogin >= 2
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;color:#92400e;font-weight:600;">⚠️ Login Reminder</p>
        <p style="margin:6px 0 0;color:#b45309;font-size:14px;">You haven't logged in for ${stats.daysSinceLogin} days. New files may be waiting for review!</p>
       </div>` : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">📊 Daily Summary</h1>
      <p style="margin:6px 0 0;color:#fca5a5;font-size:14px;">Aryan Amusements Supplier Portal · ${stats.date}</p>
    </div>

    <div style="padding:28px 32px;">
      ${reminderBanner}

      <!-- Stats grid -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px;">
        <div style="background:#f0fdf4;border-radius:12px;padding:16px;text-align:center;">
          <p style="margin:0;font-size:28px;font-weight:700;color:#16a34a;">${stats.uploads.length}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">New Uploads</p>
        </div>
        <div style="background:#eff6ff;border-radius:12px;padding:16px;text-align:center;">
          <p style="margin:0;font-size:28px;font-weight:700;color:#2563eb;">${stats.processedCount}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Processed</p>
        </div>
        <div style="background:${stats.failedCount > 0 ? '#fef2f2' : '#f5f3ff'};border-radius:12px;padding:16px;text-align:center;">
          <p style="margin:0;font-size:28px;font-weight:700;color:${stats.failedCount > 0 ? '#dc2626' : '#7c3aed'};">${stats.failedCount > 0 ? stats.failedCount : stats.totalReady}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${stats.failedCount > 0 ? 'Failed Jobs' : 'Total in Library'}</p>
        </div>
      </div>

      <!-- Upload breakdown -->
      ${stats.uploads.length > 0 ? `
      <h3 style="margin:0 0 12px;font-size:15px;color:#111827;">Today's Uploads</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="text-align:left;padding:8px 12px;color:#6b7280;font-size:11px;text-transform:uppercase;">File</th>
            <th style="text-align:left;padding:8px 12px;color:#6b7280;font-size:11px;text-transform:uppercase;">Supplier</th>
          </tr>
        </thead>
        <tbody>${uploadRows}${stats.uploads.length > 10 ? `<tr><td colspan="2" style="padding:6px 12px;color:#9ca3af;font-size:12px;">…and ${stats.uploads.length - 10} more</td></tr>` : ''}</tbody>
      </table>` : '<p style="color:#6b7280;font-size:14px;">No new uploads today.</p>'}

      <!-- Failed jobs -->
      ${stats.failedCount > 0 ? `
      <h3 style="margin:0 0 12px;font-size:15px;color:#dc2626;">⚠ Failed Processing Jobs</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tbody>${failedRows}</tbody>
      </table>` : ''}

      <!-- Footer stats -->
      <div style="background:#f9fafb;border-radius:12px;padding:16px;font-size:13px;color:#374151;">
        <p style="margin:0;">📚 <strong>${stats.totalReady}</strong> files in Sales Library &nbsp;·&nbsp; 🏭 <strong>${stats.totalSuppliers}</strong> active suppliers</p>
      </div>
    </div>

    <div style="background:#f3f4f6;padding:16px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">Aryan Amusements · +91 9841081945 · Automated daily report</p>
    </div>
  </div>
</body>
</html>`
}

// ── Send WhatsApp ─────────────────────────────────────────────
async function sendWhatsApp(phoneNumberId, accessToken, toPhone, message) {
  const clean = toPhone.replace(/[^\d]/g, '')
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                clean,
    type:              'text',
    text:              { body: message },
  }

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'WhatsApp API error')
  return data.messages?.[0]?.id
}

// ── Send Email via Resend ─────────────────────────────────────
async function sendEmail(resendKey, toEmail, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'Aryan Amusements Portal <notifications@yourdomain.com>',
      to:      [toEmail],
      subject,
      html,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || 'Resend API error')
  return data.id
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('Generating daily summary…')

  const cfg   = await loadSettings()
  const stats = await gatherStats()

  console.log(`Stats: ${stats.uploads.length} uploads, ${stats.processedCount} processed, ${stats.failedCount} failed`)

  const waPhone  = cfg.notification_whatsapp || '919841081945'
  const email    = cfg.notification_email    || 'bhavesh.shah@gamesnmore.co.in'
  const waId     = cfg.whatsapp_phone_number_id
  const waToken  = cfg.whatsapp_access_token
  const resendKey= cfg.resend_api_key || process.env.RESEND_API_KEY

  // ── WhatsApp ─────────────────────────────────────────────
  if (waId && waToken) {
    try {
      const msg = buildWhatsAppMessage(stats)
      const msgId = await sendWhatsApp(waId, waToken, waPhone, msg)
      console.log(`WhatsApp sent: ${msgId}`)
    } catch (err) {
      console.error('WhatsApp failed:', err.message)
    }
  } else {
    console.log('WhatsApp credentials not configured — skipping')
  }

  // ── Email ─────────────────────────────────────────────────
  if (resendKey) {
    try {
      const html    = buildEmailHtml(stats)
      const subject = `Daily Summary: ${stats.uploads.length} uploads · ${stats.processedCount} processed — ${stats.date}`
      const emailId = await sendEmail(resendKey, email, subject, html)
      console.log(`Email sent: ${emailId}`)
    } catch (err) {
      console.error('Email failed:', err.message)
    }
  } else {
    console.log('RESEND_API_KEY not set — skipping email')
  }

  console.log('Daily summary complete.')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
