import { createClient } from '@supabase/supabase-js'

const SITE_URL = process.env.SITE_URL || 'https://supply.indiajobworks.com'
const WA_API   = 'https://graph.facebook.com/v19.0'

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Send a plain text WhatsApp message (works within 24h customer service window)
async function sendWaText(phoneNumberId, accessToken, toPhone, text) {
  try {
    await fetch(`${WA_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone,
        type: 'text',
        text: { body: text },
      }),
    })
  } catch (e) {
    console.warn('sendWaText failed:', e.message)
  }
}

// Parse what Bhavesh typed after stripping "alink".
// Formats supported (comma-separated):
//   alink                           → open/broadcast link
//   alink UNIS Technology           → company only
//   alink UNIS, Jim                 → company + contact person
//   alink UNIS, Jim, +86138...      → company + contact + phone
//   alink UNIS +86138...            → company + phone (no contact)
// Returns { companyName, contactPerson, phone, isOpen }
function parseAdminMsg(text) {
  const t = (text || '').trim()
  const lower = t.toLowerCase()

  if (!t || ['link','open','new link','open link','broadcast','alink'].includes(lower)) {
    return { companyName: '', contactPerson: '', phone: '', isOpen: true }
  }

  // Comma-separated structured input
  if (t.includes(',')) {
    const parts = t.split(',').map(p => p.trim())
    const companyName = parts[0]

    // Second part: person name or phone?
    const second = parts[1] || ''
    const phoneInSecond = second.match(/^\+?\d[\d\s\-]{7,14}\d$/)

    if (phoneInSecond) {
      // "Company, Phone"
      return { companyName, contactPerson: '', phone: second.replace(/[\s\-]/g, ''), isOpen: false }
    }

    // "Company, Person" or "Company, Person, Phone"
    const contactPerson = second
    const third = parts[2] || ''
    const phoneMatch = third.match(/\+?\d[\d\s\-]{7,14}\d/)
    const phone = phoneMatch ? phoneMatch[0].replace(/[\s\-]/g, '') : ''
    return { companyName, contactPerson, phone, isOpen: false }
  }

  // No commas: extract inline phone if present
  const phoneMatch = t.match(/\+?\d[\d\s\-]{7,14}\d/)
  const phone = phoneMatch ? phoneMatch[0].replace(/[\s\-]/g, '') : ''
  const companyName = phone ? t.replace(phoneMatch[0], '').replace(/[-,|]+$/, '').trim() : t

  return { companyName, contactPerson: '', phone, isOpen: false }
}

// Create a guest upload link (replicates invite-supplier create logic)
async function createUploadLink(supabaseAdmin, { companyName, contactPerson, phone, isOpen, adminId }) {
  let authEmail  = null
  let supplierId = null

  if (!isOpen) {
    const shortId = Math.random().toString(36).slice(2, 10)
    authEmail = `g-${shortId}@upload.internal`

    const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      email_confirm: true,
      user_metadata: { role: 'supplier', company_name_en: companyName, phone },
    })
    if (error) throw new Error('Could not create supplier: ' + error.message)
    supplierId = newUser.user.id

    const updates = {}
    if (companyName)   updates.company_name_en   = companyName
    if (phone)         updates.phone              = phone
    if (contactPerson) updates.contact_person_en  = contactPerson
    if (Object.keys(updates).length) {
      await supabaseAdmin.from('suppliers').update(updates).eq('id', supplierId)
    }
    await supabaseAdmin.from('suppliers').update({ status: 'active' }).eq('id', supplierId)
  }

  const { data: invite, error: invErr } = await supabaseAdmin
    .from('supplier_invitations')
    .insert({
      company_name_en:   companyName    || null,
      contact_person_en: contactPerson  || null,
      phone:             phone          || null,
      link_type:         isOpen ? 'open' : 'specific',
      auth_email:        authEmail,
      supplier_id:       supplierId,
      auto_signup:       true,
      expires_at:        null,
      status:            'pending',
      created_by:        adminId || null,
    })
    .select('invite_token')
    .single()

  if (invErr) throw new Error('DB error: ' + invErr.message)
  return `${SITE_URL}/u/${invite.invite_token}`
}

function extractContent(msg) {
  switch (msg.type) {
    case 'text':     return msg.text?.body || ''
    case 'image':    return '[Image]'
    case 'video':    return '[Video]'
    case 'audio':    return '[Voice message]'
    case 'sticker':  return '[Sticker]'
    case 'document': return `[Document: ${msg.document?.filename || 'file'}]`
    case 'location': return `[Location: ${msg.location?.name || 'shared location'}]`
    case 'reaction': return `[Reaction: ${msg.reaction?.emoji || ''}]`
    default:         return `[${msg.type}]`
  }
}

export default async function handler(req, res) {
  // ── GET: Meta webhook verification (only needed if using this URL directly) ──
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode']
    const token     = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']

    const supabaseAdmin = makeAdmin()
    let verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || ''

    if (supabaseAdmin && !verifyToken) {
      const { data } = await supabaseAdmin
        .from('settings').select('value').eq('key', 'whatsapp_verify_token').maybeSingle()
      verifyToken = data?.value || ''
    }

    if (mode === 'subscribe' && token === verifyToken && verifyToken) {
      console.log('WhatsApp webhook verified')
      return res.status(200).send(challenge)
    }
    return res.status(403).send('Forbidden')
  }

  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  // ── POST: incoming events (forwarded from existing PHP webhook) ──────────
  // Respond 200 immediately — Meta/PHP forwarder will retry if we're slow
  res.status(200).json({ ok: true })

  try {
    const supabaseAdmin = makeAdmin()
    if (!supabaseAdmin) return

    // Validate shared forward secret (if configured in Settings)
    const { data: rows } = await supabaseAdmin
      .from('settings').select('key, value')
      .in('key', ['whatsapp_forward_secret'])
    const cfg = {}
    for (const r of (rows || [])) cfg[r.key] = r.value

    const forwardSecret = cfg.whatsapp_forward_secret || ''
    if (forwardSecret) {
      const incoming = req.headers['x-forward-secret'] || req.query.secret || ''
      if (incoming !== forwardSecret) {
        console.warn('WhatsApp webhook: invalid forward secret — request rejected')
        return
      }
    }

    const body = req.body
    if (body.object !== 'whatsapp_business_account') return

    // Load WA credentials + admin phone number once per webhook call
    const { data: settingsRows } = await supabaseAdmin
      .from('settings').select('key, value')
      .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token', 'admin_whatsapp_number'])
    const cfg = {}
    for (const r of (settingsRows || [])) cfg[r.key] = r.value
    const waPhoneId    = cfg.whatsapp_phone_number_id || ''
    const waToken      = cfg.whatsapp_access_token    || ''
    // Admin phone: strip non-digits, also support "919841081945" without "+"
    const adminPhone   = (cfg.admin_whatsapp_number || '919841081945').replace(/[^\d]/g, '')

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue
        const value = change.value

        // ── Incoming messages ──────────────────────────────────
        for (const msg of value.messages || []) {
          const phone       = msg.from
          const contactName = value.contacts?.find(c => c.wa_id === msg.from)?.profile?.name || null
          const content     = extractContent(msg)
          const mediaId     = msg.image?.id || msg.video?.id || msg.document?.id || msg.audio?.id || null
          const filename    = msg.document?.filename || null
          const waTs        = new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()

          try {
            await supabaseAdmin.from('whatsapp_messages').insert({
              phone_number:  phone,
              contact_name:  contactName,
              direction:     'inbound',
              wa_message_id: msg.id,
              message_type:  msg.type,
              content,
              media_url:     mediaId,
              filename,
              status:        'received',
              wa_timestamp:  waTs,
            })
          } catch (err) {
            console.error('Failed to insert inbound message:', err.message)
          }

          // Backfill contact_name on earlier messages from this number
          if (contactName) {
            try {
              await supabaseAdmin
                .from('whatsapp_messages')
                .update({ contact_name: contactName })
                .eq('phone_number', phone)
                .is('contact_name', null)
            } catch {}
          }

          // ── Admin command: "alink" from 919841081945 → generate upload link ──
          // Security: ONLY process if sender is the admin's number (919841081945)
          const isAdminPhone = phone.replace(/[^\d]/g, '') === adminPhone
          const hasAlinkKeyword = msg.type === 'text' && content.toLowerCase().includes('alink')

          if (hasAlinkKeyword && isAdminPhone && waPhoneId && waToken) {
            try {
              const stripped = content.replace(/alink\s*/i, '').trim()
              const { companyName, contactPerson, phone: supplierPhone, isOpen } = parseAdminMsg(stripped || 'link')

              const { data: adminRows } = await supabaseAdmin.from('admins').select('id').limit(1)
              const adminId = adminRows?.[0]?.id || null

              const linkUrl = await createUploadLink(supabaseAdmin, {
                companyName, contactPerson, phone: supplierPhone, isOpen, adminId,
              })

              const label    = companyName  || (isOpen ? 'Generic / Broadcast' : 'Supplier')
              const greeting = contactPerson || companyName || ''

              const confirmMsg = [
                `✅ Upload link created`,
                ``,
                companyName   ? `Company: ${companyName}`     : `Type: Generic / Broadcast link`,
                contactPerson ? `Contact: ${contactPerson}`   : '',
                supplierPhone ? `Phone:   ${supplierPhone}`   : '',
                ``,
                `Link: ${linkUrl}`,
                ``,
                `─────────────────────────`,
                `Forward to supplier (中文):`,
                `─────────────────────────`,
                `您好${greeting ? ' ' + greeting : ''}！`,
                ``,
                `Aryana Amusements 邀请您通过以下专属链接上传产品图片、视频和价格表（无需注册，直接上传）：`,
                ``,
                linkUrl,
                ``,
                `如有疑问请联系：`,
                `Bhavesh — Aryana Amusements`,
                `+91 9841081945`,
              ].filter(Boolean).join('\n')

              await sendWaText(waPhoneId, waToken, phone, confirmMsg)

            } catch (cmdErr) {
              console.error('Admin link command failed:', cmdErr.message)
              await sendWaText(waPhoneId, waToken, phone, `❌ Could not create link: ${cmdErr.message}`)
            }

          } else if (hasAlinkKeyword && !isAdminPhone) {
            // Someone else sent "alink" — ignore silently (do not generate a link)
            console.log(`"alink" received from non-admin number ${phone} — ignored`)
          }
        }

        // ── Delivery / read status updates ─────────────────────
        for (const status of value.statuses || []) {
          const deliveryStatus = status.status  // sent, delivered, read, failed
          const errorMsg = status.errors?.length
            ? `(${status.errors[0].code}) ${status.errors[0].title}`
            : null
          if (errorMsg) console.error('WA delivery failed:', status.id, errorMsg)
          try {
            await supabaseAdmin
              .from('whatsapp_messages')
              .update({
                status:        deliveryStatus,
                error_message: errorMsg || null,
              })
              .eq('wa_message_id', status.id)
          } catch (err) {
            console.error('Failed to update status:', err.message)
          }
        }
      }
    }
  } catch (err) {
    console.error('WhatsApp webhook unhandled error:', err)
  }
}
