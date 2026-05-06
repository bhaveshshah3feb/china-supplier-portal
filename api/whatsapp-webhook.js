import { createClient } from '@supabase/supabase-js'

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
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
        }

        // ── Delivery / read status updates ─────────────────────
        for (const status of value.statuses || []) {
          try {
            await supabaseAdmin
              .from('whatsapp_messages')
              .update({ status: status.status })
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
