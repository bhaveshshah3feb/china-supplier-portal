import { useState } from 'react'
import { supabase } from '../../lib/supabase'

// ── helpers ────────────────────────────────────────────────────
function cleanPhone(p) {
  return (p || '').replace(/[^\d]/g, '')  // digits only — wa.me needs no +
}

function waLink(phone, text) {
  return `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(text)}`
}

function buildMessage(invite, lang) {
  const name = lang === 'zh'
    ? (invite.contact_person_zh || invite.contact_person_en || invite.company_name_zh || invite.company_name_en)
    : (invite.contact_person_en || invite.company_name_en)

  if (lang === 'zh') {
    return `您好 ${name}！\n\nAryana Amusements（印度）诚邀您加入我们的供应商门户。\n\n请点击以下链接创建账户：\n${invite.invite_url}\n\n您的公司信息已预填写，只需设置密码即可完成注册。\n\n如有疑问请联系：\nBhavesh — Aryana Amusements\n+91 9841081945`
  }
  return `Hello ${name}!\n\nAryana Amusements (India) has invited you to join our Supplier Portal.\n\nCreate your account here:\n${invite.invite_url}\n\nYour company details are pre-filled — just set a password to finish.\n\nQuestions? Contact:\nBhavesh – Aryana Amusements\n+91 9841081945`
}

// ── component ─────────────────────────────────────────────────
export default function InviteSupplierModal({ onClose, onDone }) {
  // step: 'form' → fill details  |  'share' → show send options
  const [step, setStep]         = useState('form')
  const [invite, setInvite]     = useState(null)   // { invite_url, email, phone, ... }
  const [lang, setLang]         = useState('zh')   // default Chinese for supplier outreach

  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')

  // email-send state (separate from creation)
  const [emailState, setEmailState] = useState('idle')  // 'idle'|'sending'|'ok'|'err'
  const [emailErr, setEmailErr]     = useState('')

  const [urlCopied, setUrlCopied]   = useState(false)
  const [msgCopied, setMsgCopied]   = useState(false)

  const [form, setForm] = useState({
    email: '', company_name_en: '', company_name_zh: '',
    phone: '', contact_person_en: '', contact_person_zh: '', notes: '',
  })
  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }

  // ── Step 1: create invite record (no email sent yet) ──────
  async function createInvite(e) {
    e.preventDefault()
    if (!form.email || !form.company_name_en) {
      setCreateErr('Email and Company Name (English) are required.')
      return
    }
    setCreateErr(''); setCreating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/invite-supplier', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ...form, action: 'create' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not create invitation')
      setInvite({ ...form, invite_url: json.invite_url, invite_token: json.invite_token })
      setStep('share')
    } catch (err) {
      setCreateErr(err.message)
    } finally {
      setCreating(false)
    }
  }

  // ── Step 2: send email (separate call) ───────────────────
  async function sendEmail() {
    setEmailState('sending'); setEmailErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/invite-supplier', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'email', invite_token: invite.invite_token }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Email failed')
      setEmailState('ok')
    } catch (err) {
      setEmailState('err'); setEmailErr(err.message)
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(invite.invite_url)
    setUrlCopied(true); setTimeout(() => setUrlCopied(false), 2000)
  }

  async function copyMsg() {
    await navigator.clipboard.writeText(buildMessage(invite, lang))
    setMsgCopied(true); setTimeout(() => setMsgCopied(false), 2000)
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none'

  // ── render ────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-gray-100 z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              {step === 'form' ? '✉️ Invite New Supplier' : '📤 Send Invitation'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'form'
                ? 'Fill in the supplier details to generate an invite link'
                : `Invite link created for ${invite?.email}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-4">×</button>
        </div>

        {/* ── STEP 1: Form ── */}
        {step === 'form' && (
          <form onSubmit={createInvite} className="px-6 py-5 space-y-4">

            {/* Language toggle */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Message language:</span>
              {[['zh', '🇨🇳 中文'], ['en', '🇬🇧 English']].map(([l, label]) => (
                <button key={l} type="button" onClick={() => setLang(l)}
                  className={`px-3 py-1 rounded-full border text-xs transition-colors
                    ${lang === l ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 hover:border-brand-400 text-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                <input type="email" required value={form.email} onChange={set('email')}
                  className={inputCls} placeholder="supplier@company.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone (WhatsApp)</label>
                <input type="tel" value={form.phone} onChange={set('phone')}
                  className={inputCls} placeholder="+86 138 0000 0000" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Company Name (English) *</label>
                <input required value={form.company_name_en} onChange={set('company_name_en')}
                  className={inputCls} placeholder="Guangzhou ABC Co." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">公司名称（中文）</label>
                <input value={form.company_name_zh} onChange={set('company_name_zh')}
                  className={inputCls} placeholder="广州ABC有限公司" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contact Person (EN)</label>
                <input value={form.contact_person_en} onChange={set('contact_person_en')}
                  className={inputCls} placeholder="Wang Wei" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">联系人（中文）</label>
                <input value={form.contact_person_zh} onChange={set('contact_person_zh')}
                  className={inputCls} placeholder="王伟" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Internal Notes</label>
              <input value={form.notes} onChange={set('notes')}
                className={inputCls} placeholder="e.g. Met at Canton Fair 2025" />
            </div>

            {createErr && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                ❌ {createErr}
              </div>
            )}

            <button type="submit" disabled={creating}
              className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {creating
                ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Creating…</>
                : '✉️ Create Invitation Link'}
            </button>
          </form>
        )}

        {/* ── STEP 2: Send options ── */}
        {step === 'share' && invite && (
          <div className="px-6 py-5 space-y-4">

            {/* Invite URL */}
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Invite Link (valid 14 days)</p>
              <p className="text-xs font-mono text-gray-600 break-all mb-2">{invite.invite_url}</p>
              <button onClick={copyUrl}
                className="text-xs bg-white border border-gray-200 hover:border-brand-400 px-3 py-1.5 rounded-lg transition-colors">
                {urlCopied ? '✓ Copied!' : '📋 Copy link'}
              </button>
            </div>

            {/* ── Email ── */}
            <div className="border border-blue-200 rounded-xl overflow-hidden">
              <div className="bg-blue-50 px-4 py-3 flex items-center gap-2">
                <span className="text-lg">📧</span>
                <div>
                  <p className="text-sm font-medium text-blue-800">Send Email Invite</p>
                  <p className="text-xs text-blue-500">Supabase sends an email to {invite.email}</p>
                </div>
              </div>
              <div className="px-4 py-3">
                {emailState === 'idle' && (
                  <button onClick={sendEmail}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                    Send Email Now
                  </button>
                )}
                {emailState === 'sending' && (
                  <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-500">
                    <span className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                    Sending…
                  </div>
                )}
                {emailState === 'ok' && (
                  <p className="text-sm text-green-700 py-1">✅ Email invite sent to {invite.email}</p>
                )}
                {emailState === 'err' && (
                  <div className="space-y-2">
                    <p className="text-xs text-red-600">❌ {emailErr}</p>
                    <p className="text-xs text-gray-500">
                      If this keeps failing, share the invite link above manually via WhatsApp or WeChat instead.
                    </p>
                    <button onClick={() => setEmailState('idle')}
                      className="text-xs text-blue-600 hover:underline">Try again</button>
                  </div>
                )}
              </div>
            </div>

            {/* ── WhatsApp ── */}
            <div className="border border-green-200 rounded-xl overflow-hidden">
              <div className="bg-green-50 px-4 py-3 flex items-center gap-2">
                <span className="text-lg">💬</span>
                <div>
                  <p className="text-sm font-medium text-green-800">Send via WhatsApp</p>
                  <p className="text-xs text-green-500">
                    {invite.phone ? `To: ${invite.phone}` : 'No phone number — add one to enable'}
                  </p>
                </div>
              </div>
              <div className="px-4 py-3">
                {invite.phone ? (
                  /* ⚑ KEY FIX: <a> tag, not window.open — works on all mobile browsers */
                  <a
                    href={waLink(invite.phone, buildMessage(invite, lang))}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors text-center">
                    Open WhatsApp →
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">Enter the supplier's WhatsApp number:</p>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        placeholder="+86 138 0000 0000"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-400"
                        onChange={e => setInvite(i => ({ ...i, phone: e.target.value }))}
                        value={invite.phone || ''}
                      />
                    </div>
                    {invite.phone && cleanPhone(invite.phone).length >= 8 && (
                      <a
                        href={waLink(invite.phone, buildMessage(invite, lang))}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors text-center">
                        Open WhatsApp →
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── WeChat ── */}
            <div className="border border-emerald-200 rounded-xl overflow-hidden">
              <div className="bg-emerald-50 px-4 py-3 flex items-center gap-2">
                <span className="text-lg">🟢</span>
                <div>
                  <p className="text-sm font-medium text-emerald-800">Send via WeChat</p>
                  <p className="text-xs text-emerald-500">Copy this message and paste it in WeChat</p>
                </div>
              </div>
              <div className="px-4 py-3 space-y-2">
                {/* Language toggle for message */}
                <div className="flex gap-1.5 mb-2">
                  {[['zh', '中文'], ['en', 'English']].map(([l, label]) => (
                    <button key={l} type="button" onClick={() => setLang(l)}
                      className={`px-2.5 py-1 rounded-full border text-xs transition-colors
                        ${lang === l ? 'bg-emerald-700 text-white border-emerald-700' : 'border-gray-300 text-gray-600 hover:border-emerald-500'}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* ⚑ KEY FIX: textarea so user can see and copy the text */}
                <textarea
                  readOnly
                  value={buildMessage(invite, lang)}
                  rows={8}
                  className="w-full text-xs border border-gray-200 rounded-lg p-3 bg-white resize-none font-mono leading-relaxed text-gray-700 cursor-text"
                  onClick={e => e.target.select()}
                />

                <button onClick={copyMsg}
                  className="w-full py-2 bg-emerald-700 text-white rounded-lg text-sm font-medium hover:bg-emerald-800 transition-colors">
                  {msgCopied ? '✓ Copied! Now paste in WeChat' : '📋 Copy Message'}
                </button>
                <p className="text-xs text-gray-400 text-center">
                  Tap the message box above to select all, or use the Copy button
                </p>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setStep('form'); setInvite(null); setEmailState('idle'); setCreateErr('') }}
                className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm transition-colors">
                + Invite Another
              </button>
              <button onClick={() => { if (onDone) onDone(); onClose() }}
                className="flex-1 bg-brand-600 text-white hover:bg-brand-700 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                Done ✓
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
