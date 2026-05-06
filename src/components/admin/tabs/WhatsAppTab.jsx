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
  const [diagPhone, setDiagPhone]   = useState('')
  const [diagFileUrl, setDiagFileUrl] = useState('')
  const [diagFileType, setDiagFileType] = useState('image')
  const [diagResult, setDiagResult] = useState(null)
  const [diagRunning, setDiagRunning] = useState(false)
  const [testPhone, setTestPhone]     = useState('')
  const [testText, setTestText]       = useState('')
  const [testResult, setTestResult]   = useState(null)
  const [testSending, setTestSending] = useState(false)
  const [freePhone, setFreePhone]     = useState('')
  const [freeMsg, setFreeMsg]         = useState('Hi, this is a test message from Aryan Amusements.')
  const [freeResult, setFreeResult]   = useState(null)
  const [freeSending, setFreeSending] = useState(false)
  const [forwardUrl, setForwardUrl]     = useState('')
  const [forwardSecret, setForwardSecret] = useState('')

  useEffect(() => {
    setForwardUrl(`${window.location.origin}/api/whatsapp-webhook`)
    supabase.from('settings').select('key, value')
      .in('key', ['whatsapp_forward_secret'])
      .then(({ data }) => {
        const map = {}
        for (const r of (data || [])) map[r.key] = r.value
        setForwardSecret(map.whatsapp_forward_secret || '')
      })
  }, [])

  async function runDiagnostics() {
    setDiagRunning(true)
    setDiagResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/whatsapp-diag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          to_phone:  diagPhone.trim() || undefined,
          file_url:  diagFileUrl.trim() || undefined,
          file_type: diagFileUrl.trim() ? diagFileType : undefined,
        }),
      })
      const body = await res.json()
      setDiagResult(body)
    } catch (err) {
      setDiagResult({ error: err.message })
    } finally {
      setDiagRunning(false)
    }
  }

  async function sendTestMessage() {
    if (!testPhone.trim() || !testText.trim()) return
    setTestSending(true)
    setTestResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      // Detect file type from URL extension, default to document
      const url = testText.trim()
      const ext = url.split('?')[0].split('.').pop().toLowerCase()
      const fileType = ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext) ? 'video'
                     : ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext) ? 'image'
                     : 'document'
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          to_phone:     testPhone,
          file_url:     url,
          file_type:    fileType,
          filename:     'test-file.' + ext,
          machine_name: 'Test',
          category:     'Aryan Amusements',
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

  async function sendFreeForm() {
    if (!freePhone.trim() || !freeMsg.trim()) return
    setFreeSending(true)
    setFreeResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ to_phone: freePhone.trim(), message_text: freeMsg.trim(), message_type: 'text' }),
      })
      const data = await res.json()
      setFreeResult({ httpStatus: res.status, ...data })
    } catch (err) {
      setFreeResult({ error: err.message })
    } finally {
      setFreeSending(false)
    }
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(buildPhpSnippet())
  }

  function buildPhpSnippet() {
    const secret = forwardSecret || 'YOUR_FORWARD_SECRET_HERE'
    return `// ── Forward to China Supplier Portal ──────────────────────
// Add this to your wa_webhook.php AFTER reading the POST body.
// If you already read it with json_decode, re-capture it like this:
//   $raw_body = file_get_contents('php://input');
// Otherwise add that line at the very top of the file.

$portal_url    = '${forwardUrl}';
$portal_secret = '${secret}';

$ch = curl_init($portal_url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $raw_body);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'X-Forward-Secret: ' . $portal_secret,
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 5);
curl_exec($ch);
curl_close($ch);
// ────────────────────────────────────────────────────────────`
  }

  return (
    <div className="space-y-5 max-w-2xl">

      {/* Full diagnostics */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">1. Run Full Diagnostics</h3>
        <p className="text-sm text-gray-500">
          Checks credentials, verifies them live against Meta API, and optionally sends a test message
          — showing the exact raw response so we can see what WhatsApp is actually saying.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Your phone (to receive test)</label>
              <input value={diagPhone} onChange={e => setDiagPhone(e.target.value)}
                placeholder="919841081945"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-green-500 outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">File type</label>
              <select value={diagFileType} onChange={e => setDiagFileType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none">
                <option value="image">Image (game_pic template)</option>
                <option value="video">Video (game_vidpic template)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Public file URL to test template with (paste any image from Sales Library)
            </label>
            <input value={diagFileUrl} onChange={e => setDiagFileUrl(e.target.value)}
              placeholder="https://… (right-click an image in Sales Library → copy image address)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-green-500 outline-none" />
          </div>
          <button onClick={runDiagnostics} disabled={diagRunning}
            className="bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800 disabled:opacity-50">
            {diagRunning ? 'Running diagnostics…' : 'Run Diagnostics'}
          </button>
        </div>

        {diagResult && (
          <div className="space-y-2">
            {diagResult.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">✗ {diagResult.error}</div>
            )}
            {(diagResult.checks || []).map((c, i) => (
              <div key={i} className={`rounded-lg border p-3 text-xs space-y-1
                ${c.ok === true  ? 'bg-green-50 border-green-200' :
                  c.ok === false ? 'bg-red-50 border-red-200' :
                                   'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold">
                    {c.ok === true ? '✓' : c.ok === false ? '✗' : '⚠'}
                  </span>
                  <div className="flex-1 space-y-1">
                    <p className="font-semibold text-gray-800">{c.name}</p>
                    <p className="text-gray-600">{c.detail}</p>
                    {c.langWarning && (
                      <p className="text-red-700 bg-red-50 px-2 py-1 rounded mt-1 font-semibold">
                        ⚠ {c.langWarning}
                      </p>
                    )}
                    {c.fix && (
                      <p className="text-blue-700 bg-blue-50 px-2 py-1 rounded mt-1">
                        Fix: {c.fix}
                      </p>
                    )}
                    {c.raw && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-400">Raw API response</summary>
                        <pre className="mt-1 bg-gray-900 text-green-300 p-2 rounded text-[10px] overflow-x-auto">
                          {JSON.stringify(c.raw, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send test file — direct send, no template (same as original working approach) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">2. Send Test File (Direct — No Template)</h3>
        <p className="text-sm text-gray-500">
          Sends a file directly to the phone — the same approach the original module used and which confirmed working.
          Paste any publicly accessible image, video, or document URL. Works anytime, no 24-hour restriction.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          ⚠ <strong>Why not plain text?</strong> WhatsApp blocks free-form text messages unless the recipient has messaged
          you within the last 24 hours. Use a file URL instead — that works anytime.
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Phone (with country code)</label>
            <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
              placeholder="919876543210"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-green-500 outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">File URL (any public image / video / PDF)</label>
            <input value={testText} onChange={e => setTestText(e.target.value)}
              placeholder="https://example.com/sample.jpg"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-green-500 outline-none" />
            <p className="text-[10px] text-gray-400 mt-1">
              Tip: right-click any image in the Sales Library → "Copy image address" and paste it here.
            </p>
          </div>
          <button onClick={sendTestMessage} disabled={testSending || !testPhone.trim() || !testText.trim()}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {testSending ? 'Sending…' : 'Send Test File'}
          </button>
        </div>

        {testResult && (
          <div className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-all
            ${testResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {testResult.success
              ? `✓ Sent! Message ID: ${testResult.message_id || 'unknown'}\n\nIf you don't receive it within 30 seconds, the URL may not be publicly accessible.`
              : `✗ Error: ${testResult.error || JSON.stringify(testResult, null, 2)}`}
            {testResult.raw && (
              <details className="mt-2 pt-2 border-t border-red-200">
                <summary className="cursor-pointer text-gray-500">Raw API response</summary>
                <pre className="mt-1 text-gray-600">{JSON.stringify(testResult.raw, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Free-form text test — uses 24h window, shows complete raw response */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">3. Free-Form Text Message (Raw Error Capture)</h3>
        <p className="text-sm text-gray-500">
          Sends a plain text message. Only works within 24 hours of the customer last messaging you —
          use this when that window is open to confirm the API connection works and capture the exact error if it doesn't.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Phone (with country code)</label>
            <input value={freePhone} onChange={e => setFreePhone(e.target.value)}
              placeholder="919841081945"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-green-500 outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Message</label>
            <textarea value={freeMsg} onChange={e => setFreeMsg(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none" />
          </div>
          <button onClick={sendFreeForm} disabled={freeSending || !freePhone.trim() || !freeMsg.trim()}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {freeSending ? 'Sending…' : 'Send Free-Form Text'}
          </button>
        </div>

        {freeResult && (
          <div className={`rounded-lg border p-3 text-xs space-y-2
            ${freeResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`font-semibold ${freeResult.success ? 'text-green-800' : 'text-red-700'}`}>
              {freeResult.success
                ? `✓ Sent! Message ID: ${freeResult.message_id}`
                : `✗ ${freeResult.error || 'Failed'}`}
            </p>
            <details open>
              <summary className="cursor-pointer text-gray-500 font-medium">Complete raw API response (HTTP {freeResult.httpStatus})</summary>
              <pre className="mt-2 bg-gray-900 text-green-300 p-3 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(freeResult, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>

      {/* PHP Forwarding setup */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">4. Receive Incoming Messages (PHP Forwarding)</h3>
        <p className="text-sm text-gray-500">
          Your existing webhook at <code className="bg-gray-100 px-1 rounded text-xs">indiajobwork.com/tasks/api/wa_webhook.php</code> stays
          untouched. You just add ~10 lines to it so it forwards a copy of every event to this portal.
          Your task app continues to work exactly as before.
        </p>

        <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-800 space-y-2">
          <p className="font-semibold">Step-by-step:</p>
          <ol className="list-decimal list-inside space-y-1.5 text-blue-700">
            <li>Go to <strong>Settings → WhatsApp → Webhook Forward Secret</strong> and enter any random string (e.g. <code>aryan-wa-2026</code>). Save.</li>
            <li>Come back here — the PHP snippet below will update with your secret filled in.</li>
            <li>Click <strong>Copy PHP Snippet</strong> and paste it into <code>wa_webhook.php</code> on your server, right after the line that reads the POST body.</li>
            <li>Done — incoming messages from customers will appear in the Inbox tab in real time.</li>
          </ol>
        </div>

        {/* Forward secret status */}
        {!forwardSecret && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
            ⚠ Forward Secret not set yet. Go to Settings → WhatsApp → Webhook Forward Secret and save a value first.
          </div>
        )}
        {forwardSecret && (
          <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">
            ✓ Forward Secret is set. Your PHP snippet is ready below.
          </div>
        )}

        {/* PHP snippet */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">PHP snippet to add to wa_webhook.php</label>
            <button onClick={copySnippet}
              className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">
              Copy PHP Snippet
            </button>
          </div>
          <pre className="bg-gray-900 text-green-300 text-[11px] rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre">
{buildPhpSnippet()}
          </pre>
        </div>

        {/* Our URL for reference */}
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Our endpoint URL (already in the snippet above)</label>
          <input readOnly value={forwardUrl}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-700" />
        </div>

        <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-600 space-y-1">
          <p className="font-semibold text-gray-700">Where to place the snippet in wa_webhook.php</p>
          <p>Near the top of the file, find the line that reads the POST body — usually looks like:</p>
          <pre className="bg-white border border-gray-200 rounded px-3 py-2 mt-1 text-gray-700">{`$data = json_decode(file_get_contents('php://input'), true);`}</pre>
          <p className="mt-1">Change it to two lines so the raw body is saved before decoding:</p>
          <pre className="bg-white border border-gray-200 rounded px-3 py-2 mt-1 text-gray-700">{`$raw_body = file_get_contents('php://input');\n$data = json_decode($raw_body, true);`}</pre>
          <p className="mt-1">Then paste the forwarding snippet anywhere after those two lines.</p>
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
