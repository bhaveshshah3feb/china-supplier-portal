import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const SITE_URL = process.env.SITE_URL || 'https://supply.indiajobwork.com'

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function notifyAdmin(linkUrl, label, companyName, phone) {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) return
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })
    const displayName = companyName || label || 'Unknown Supplier'
    await transporter.sendMail({
      from: gmailUser,
      to: gmailUser,
      subject: `Upload link created: ${displayName}`,
      text: [
        `A new supplier upload link was created.`,
        ``,
        `Supplier: ${displayName}`,
        phone ? `Phone/WA: ${phone}` : '',
        ``,
        `Upload link:`,
        linkUrl,
        ``,
        `This link is permanent — the supplier can use it anytime to upload files.`,
      ].filter(Boolean).join('\n'),
    })
  } catch (e) {
    console.warn('Admin notification email failed:', e.message)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseAdmin = makeAdmin()
  if (!supabaseAdmin) {
    return res.status(500).json({
      error: 'Server not configured. Add SUPABASE_SERVICE_KEY to Vercel environment variables.',
    })
  }

  // Verify caller is admin
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) return res.status(401).json({ error: 'Not authenticated' })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })
  if (user.user_metadata?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }

  const { action = 'create' } = req.body

  // ═══════════════════════════════════════════════════════
  // ACTION: create a new invite record (default)
  // ═══════════════════════════════════════════════════════
  if (action === 'create') {
    const {
      email = '', company_name_en = '', company_name_zh = '',
      phone = '', contact_person_en = '', contact_person_zh = '',
      notes = '', label = '', link_type = 'specific',
    } = req.body

    const cleanEmail = email.toLowerCase().trim()

    // For specific links: auto-create a Supabase auth user + supplier record immediately
    let authEmail = null
    let supplierId = null

    if (link_type === 'specific') {
      // Generate a synthetic internal email for this guest supplier
      const shortId = Math.random().toString(36).slice(2, 10)
      authEmail = cleanEmail || `g-${shortId}@upload.internal`

      // Check if this email already has a pending invite → reuse it
      if (cleanEmail) {
        const { data: existing } = await supabaseAdmin
          .from('supplier_invitations')
          .select('invite_token, auth_email, supplier_id')
          .eq('email', cleanEmail)
          .eq('status', 'pending')
          .eq('link_type', 'specific')
          .maybeSingle()

        if (existing) {
          const inviteUrl = `${SITE_URL}/u/${existing.invite_token}`
          // Don't block on notification email
          notifyAdmin(inviteUrl, label, company_name_en || cleanEmail, phone)
          return res.status(200).json({
            invite_token: existing.invite_token,
            invite_url: inviteUrl,
            reused: true,
          })
        }
      }

      // Create the auth user (trigger handle_new_user will auto-create suppliers row)
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        email_confirm: true,
        user_metadata: {
          role: 'supplier',
          company_name_en,
          company_name_zh,
          phone,
          contact_person_en,
          contact_person_zh,
        },
      })

      if (createErr) {
        // If email already exists as a Supabase user, find their existing supplier record
        if (createErr.message?.includes('already been registered') || createErr.status === 422) {
          const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers()
          const found = existingUser?.users?.find(u => u.email === authEmail)
          if (found) supplierId = found.id
        } else {
          return res.status(500).json({ error: 'Could not create supplier account: ' + createErr.message })
        }
      } else {
        supplierId = newUser.user.id
        // Update supplier record with full details if provided
        const updates = {}
        if (company_name_en) updates.company_name_en = company_name_en
        if (company_name_zh) updates.company_name_zh = company_name_zh
        if (phone) updates.phone = phone
        if (contact_person_en) updates.contact_person_en = contact_person_en
        if (contact_person_zh) updates.contact_person_zh = contact_person_zh
        if (cleanEmail) updates.email = cleanEmail
        if (Object.keys(updates).length > 0) {
          await supabaseAdmin.from('suppliers').update(updates).eq('id', supplierId)
        }
        // Activate guest suppliers immediately (skip approval step)
        await supabaseAdmin.from('suppliers').update({ status: 'active' }).eq('id', supplierId)
      }
    }

    // Create the invitation record
    const { data: invite, error: insertErr } = await supabaseAdmin
      .from('supplier_invitations')
      .insert({
        email: cleanEmail || null,
        company_name_en: company_name_en || null,
        company_name_zh: company_name_zh || null,
        phone,
        contact_person_en,
        contact_person_zh,
        notes: notes || label,
        link_type,
        auth_email: authEmail,
        supplier_id: supplierId,
        auto_signup: true,
        expires_at: null,   // permanent link — no expiry
        status: 'pending',
        created_by: user.id,
      })
      .select('invite_token')
      .single()

    if (insertErr) {
      return res.status(500).json({ error: `Database error: ${insertErr.message}` })
    }

    const inviteUrl = `${SITE_URL}/u/${invite.invite_token}`
    notifyAdmin(inviteUrl, label, company_name_en || cleanEmail, phone)

    return res.status(200).json({
      invite_token: invite.invite_token,
      invite_url:   inviteUrl,
    })
  }

  // ═══════════════════════════════════════════════════════
  // ACTION: send email for an already-created invite (legacy support)
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
    if (!invite.email) return res.status(400).json({ error: 'No email on this invitation' })

    const inviteUrl = `${SITE_URL}/u/${invite_token}`

    // Send via Gmail
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) {
      return res.status(500).json({ error: 'Gmail not configured on server' })
    }
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail', auth: { user: gmailUser, pass: gmailPass },
      })
      const name = invite.contact_person_en || invite.company_name_en || 'Supplier'
      await transporter.sendMail({
        from: `Aryana Amusements <${gmailUser}>`,
        to: invite.email,
        subject: 'Your supplier upload link — Aryana Amusements',
        text: `Hello ${name},\n\nAryana Amusements has set up a secure upload portal for your product files.\n\nClick the link below to start uploading:\n${inviteUrl}\n\nNo registration needed — just click and upload.\n\nQuestions? Contact Bhavesh at +91 9841081945\n\nAryana Amusements`,
      })
      await supabaseAdmin.from('supplier_invitations').update({ channel: 'email' }).eq('invite_token', invite_token)
      return res.status(200).json({ success: true })
    } catch (e) {
      return res.status(500).json({ error: 'Email send failed: ' + e.message })
    }
  }

  return res.status(400).json({ error: 'Unknown action' })
}
