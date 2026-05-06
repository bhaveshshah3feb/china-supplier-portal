import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'

function formatMsgTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return d.toLocaleDateString('en-IN', { weekday: 'short' })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function formatFullTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

const STATUS_ICON = {
  sent:      { icon: '✓',  color: 'text-gray-400' },
  delivered: { icon: '✓✓', color: 'text-gray-400' },
  read:      { icon: '✓✓', color: 'text-blue-500' },
  failed:    { icon: '✗',  color: 'text-red-500' },
}

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'outbound'
  const st = isOut ? (STATUS_ICON[msg.status] || STATUS_ICON.sent) : null

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1`}>
      <div className={`relative max-w-xs lg:max-w-sm xl:max-w-md px-3 py-2 rounded-xl shadow-sm text-sm
        ${isOut ? 'bg-[#dcf8c6] rounded-br-none' : 'bg-white rounded-bl-none'}`}>

        {msg.template_name && (
          <p className="text-[10px] text-green-700 font-semibold mb-1">📋 {msg.template_name}</p>
        )}
        {msg.filename && (
          <p className="text-xs text-blue-600 mb-1 flex items-center gap-1">
            <span>📎</span><span className="truncate max-w-48">{msg.filename}</span>
          </p>
        )}
        {msg.content && (
          <p className="text-gray-800 whitespace-pre-wrap break-words leading-snug">{msg.content}</p>
        )}

        <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-gray-400">{formatMsgTime(msg.created_at)}</span>
          {st && <span className={`text-[10px] ${st.color}`}>{st.icon}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Inbox Panel ───────────────────────────────────────────────
function InboxPanel() {
  const [contacts, setContacts]       = useState([])
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [messages, setMessages]       = useState([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [replyText, setReplyText]     = useState('')
  const [sending, setSending]         = useState(false)
  const [search, setSearch]           = useState('')
  const messagesEndRef = useRef()

  useEffect(() => {
    loadContacts()
    const sub = supabase
      .channel('wa_inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, () => {
        loadContacts()
      })
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [])

  useEffect(() => {
    if (!selectedPhone) return
    loadMessages(selectedPhone)
    const sub = supabase
      .channel(`wa_conv_${selectedPhone}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'whatsapp_messages',
        filter: `phone_number=eq.${selectedPhone}`,
      }, () => loadMessages(selectedPhone))
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [selectedPhone])

  async function loadContacts() {
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('phone_number, contact_name, content, direction, status, created_at')
      .order('created_at', { ascending: false })
      .limit(500)

    const seen = new Map()
    for (const msg of (data || [])) {
      if (!seen.has(msg.phone_number)) {
        seen.set(msg.phone_number, {
          phone:     msg.phone_number,
          name:      msg.contact_name,
          lastMsg:   msg.content,
          lastDir:   msg.direction,
          lastTime:  msg.created_at,
          lastStatus: msg.status,
        })
      }
    }
    setContacts([...seen.values()])
    setLoadingContacts(false)
  }

  async function loadMessages(phone) {
    setLoadingMsgs(true)
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('phone_number', phone)
      .order('created_at', { ascending: true })
      .limit(200)
    setMessages(data || [])
    setLoadingMsgs(false)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
  }

  async function sendReply() {
    if (!replyText.trim() || !selectedPhone || sending) return
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ to_phone: selectedPhone, message_text: replyText.trim(), message_type: 'text' }),
      })
      const body = await res.json()
      if (body.success) {
        setReplyText('')
        await loadMessages(selectedPhone)
      } else {
        alert(body.error || 'Failed to send message.\n\nNote: free-form text only works within 24 h of the customer\'s last message. Outside that window, use Sales Library → Share to send a file via template.')
      }
    } catch {
      alert('Network error — check connection')
    } finally {
      setSending(false)
    }
  }

  const filtered = contacts.filter(c =>
    !search || c.phone.includes(search) || (c.name || '').toLowerCase().includes(search.toLowerCase())
  )

  const selectedContact = contacts.find(c => c.phone === selectedPhone)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex"
      style={{ height: 'calc(100vh - 260px)', minHeight: '520px' }}>

      {/* ── Left: Contact list ── */}
      <div className="w-72 shrink-0 border-r border-gray-200 flex flex-col bg-white">
        <div className="p-3 border-b border-gray-100 bg-gray-50">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingContacts ? (
            <div className="py-8 text-center text-gray-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm px-4">
              {contacts.length === 0
                ? 'No conversations yet.\nSet up the webhook to receive messages.'
                : 'No matching contacts'}
            </div>
          ) : (
            filtered.map(c => (
              <button key={c.phone}
                onClick={() => setSelectedPhone(c.phone)}
                className={`w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors
                  ${selectedPhone === c.phone ? 'bg-green-50 border-l-4 border-l-green-500' : ''}`}>
                <div className="flex items-start gap-2.5">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center shrink-0 text-green-700 font-semibold text-sm">
                    {c.name ? c.name.charAt(0).toUpperCase() : c.phone.slice(-2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="font-medium text-gray-800 text-sm truncate">
                        {c.name || `+${c.phone}`}
                      </p>
                      <p className="text-[10px] text-gray-400 shrink-0">{formatMsgTime(c.lastTime)}</p>
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {c.lastDir === 'outbound' ? <span className="text-green-600">→ </span> : ''}
                      {c.lastMsg || '—'}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right: Conversation ── */}
      {selectedPhone ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center shrink-0 text-green-700 font-semibold text-sm">
              {selectedContact?.name ? selectedContact.name.charAt(0).toUpperCase() : '📱'}
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">
                {selectedContact?.name || `+${selectedPhone}`}
              </p>
              <p className="text-xs text-gray-400">+{selectedPhone}</p>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-0.5"
            style={{ background: 'linear-gradient(to bottom, #e5ddd5, #ddd5cd)' }}>
            {loadingMsgs ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">Loading messages…</div>
            ) : messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">No messages yet</div>
            ) : (
              <>
                {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Reply box */}
          <div className="px-3 py-2 border-t border-gray-200 bg-white flex items-end gap-2 shrink-0">
            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
              placeholder="Type a reply… (Enter to send, Shift+Enter for new line)"
              rows={1}
              className="flex-1 resize-none border border-gray-200 rounded-2xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500 max-h-32 overflow-y-auto"
              style={{ lineHeight: '1.4' }}
            />
            <button onClick={sendReply} disabled={sending || !replyText.trim()}
              className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center hover:bg-green-700 disabled:opacity-40 shrink-0 text-base transition-colors">
              {sending ? '…' : '➤'}
            </button>
          </div>
          <p className="px-4 pb-2 text-[10px] text-gray-400 bg-white">
            Free-form text works within 24 h of customer's last message. To send files, use <strong>Sales Library → Share</strong>.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#f0f2f5]">
          <div className="text-7xl mb-4">💬</div>
          <p className="text-lg font-semibold text-gray-600">WhatsApp Inbox</p>
          <p className="text-sm text-gray-400 mt-1.5">Select a contact to view the conversation</p>
          {contacts.length === 0 && (
            <p className="text-xs text-gray-400 mt-4 max-w-xs leading-relaxed">
              No conversations yet. Set up the webhook in Meta Developer Portal to start receiving messages here.
              Go to the <strong>Test & Debug</strong> tab for setup instructions.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Test & Debug Panel ────────────────────────────────────────
function TestPanel() {
  const [credStatus, setCredStatus] = useState(null) // null | 'ok' | 'err' | {error}
  const [checking, setChecking]     = useState(false)
  const [testPhone, setTestPhone]   = useState('')
  const [testText, setTestText]     = useState('Hello! This is a test message from Aryan Amusements. 🎮')
  const [testResult, setTestResult] = useState(null)
  const [testSending, setTestSending] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [verifyToken, setVerifyToken] = useState('')

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/whatsapp-webhook`)
    supabase.from('settings').select('key, value')
      .in('key', ['whatsapp_verify_token', 'whatsapp_phone_number_id'])
      .then(({ data }) => {
        const map = {}
        for (const r of (data || [])) map[r.key] = r.value
        setVerifyToken(map.whatsapp_verify_token || '(not set — go to Settings to add it)')
      })
  }, [])

  async function checkCredentials() {
    setChecking(true)
    setCredStatus(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ test: true }),
      })
      const body = await res.json()
      setCredStatus(body.configured ? 'ok' : { error: body.error || 'Not configured' })
    } catch (err) {
      setCredStatus({ error: err.message })
    } finally {
      setChecking(false)
    }
  }

  async function sendTestMessage() {
    if (!testPhone.trim()) return
    setTestSending(true)
    setTestResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          to_phone: testPhone,
          message_text: testText,
          message_type: 'text',
        }),
      })
      const data = await res.json()
      setTestResult(data)
    } catch (err) {
      setTestResult({ error: err.message })
    } finally {
      setTestSending(false)
    }
  }

  async function copyWebhookUrl() {
    await navigator.clipboard.writeText(webhookUrl)
  }

  return (
    <div className="space-y-5 max-w-2xl">

      {/* Credential check */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">1. Check API Credentials</h3>
        <p className="text-sm text-gray-500">Verifies the Phone Number ID and Access Token saved in Settings are present.</p>
        <div className="flex items-center gap-3">
          <button onClick={checkCredentials} disabled={checking}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {checking ? 'Checking…' : 'Check Credentials'}
          </button>
          {credStatus === 'ok' && (
            <span className="text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded-lg">✓ Credentials present</span>
          )}
          {credStatus && credStatus !== 'ok' && (
            <span className="text-sm text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">
              ✗ {credStatus.error}
            </span>
          )}
        </div>
      </div>

      {/* Send test message */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">2. Send Test Text Message</h3>
        <p className="text-sm text-gray-500">
          Sends a free-form text. Works only within a 24-hour window after the recipient last messaged you.
          Use this to confirm the API token is valid.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Phone (with country code)</label>
            <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
              placeholder="919876543210"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-green-500 outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Message</label>
            <textarea value={testText} onChange={e => setTestText(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none" />
          </div>
          <button onClick={sendTestMessage} disabled={testSending || !testPhone.trim()}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {testSending ? 'Sending…' : 'Send Test Message'}
          </button>
        </div>

        {testResult && (
          <div className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-all
            ${testResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {testResult.success
              ? `✓ Sent! Message ID: ${testResult.message_id || 'unknown'}`
              : `✗ Error:\n${testResult.error || JSON.stringify(testResult, null, 2)}`}
            {testResult.raw && (
              <div className="mt-2 pt-2 border-t border-red-200 text-gray-600">
                Raw API response:\n{JSON.stringify(testResult.raw, null, 2)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Webhook setup */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">3. Webhook Setup (Receive Incoming Messages)</h3>
        <p className="text-sm text-gray-500">
          Configure this in Meta Developer Portal so incoming customer messages appear in your inbox.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Webhook URL</label>
            <div className="flex gap-2">
              <input readOnly value={webhookUrl}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-700" />
              <button onClick={copyWebhookUrl}
                className="border border-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-50">
                Copy
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Verify Token</label>
            <input readOnly value={verifyToken}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-700" />
            <p className="text-xs text-gray-400 mt-1">
              Set this in <strong>Settings → WhatsApp → Webhook Verify Token</strong>
            </p>
          </div>
        </div>

        <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-800 space-y-1.5">
          <p className="font-semibold">How to configure in Meta Developer Portal:</p>
          <ol className="list-decimal list-inside space-y-1 text-blue-700">
            <li>Go to <strong>developers.facebook.com</strong> → your App → WhatsApp → Configuration</li>
            <li>Click <strong>Edit</strong> next to Webhooks</li>
            <li>Paste the <strong>Webhook URL</strong> above</li>
            <li>Paste the <strong>Verify Token</strong> above</li>
            <li>Click <strong>Verify and Save</strong></li>
            <li>Under Webhook Fields, click <strong>Subscribe</strong> next to <code>messages</code></li>
          </ol>
          <p className="text-blue-600 pt-1">
            Once configured, all incoming customer WhatsApp messages will appear in the Inbox tab in real time.
            Status updates (delivered, read) are also tracked automatically.
          </p>
        </div>
      </div>

      {/* Common errors */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-gray-800">Common Errors & Fixes</h3>
        <div className="space-y-2 text-sm">
          {[
            {
              code: '131047',
              title: 'Re-engagement message blocked',
              fix: 'More than 24 h since customer last messaged. Send a template message (use Sales Library → Share) instead of free-form text.',
            },
            {
              code: '131026',
              title: 'Message undeliverable',
              fix: 'The recipient\'s phone is not on WhatsApp, or the number format is wrong. Ensure you include the country code (e.g. 919876543210 for India).',
            },
            {
              code: '190',
              title: 'Invalid or expired token',
              fix: 'The Access Token has expired or been revoked. Go to Meta Business Suite → System Users → regenerate the token and update it in Settings.',
            },
            {
              code: '100',
              title: 'Invalid parameter / template not found',
              fix: 'The template name is wrong or not approved. Check Meta Business Manager → Message Templates. Templates must be APPROVED to send.',
            },
          ].map(e => (
            <div key={e.code} className="border border-gray-100 rounded-lg p-3">
              <p className="font-medium text-gray-700 text-xs">Error {e.code}: {e.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{e.fix}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Main Tab ──────────────────────────────────────────────────
export default function WhatsAppTab() {
  const [subTab, setSubTab] = useState('inbox')

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[['inbox', '💬 Inbox'], ['test', '🔧 Test & Debug']].map(([key, label]) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${subTab === key ? 'bg-green-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {subTab === 'inbox' && <InboxPanel />}
      {subTab === 'test'  && <TestPanel />}
    </div>
  )
}
