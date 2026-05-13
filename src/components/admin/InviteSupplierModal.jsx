import { useState } from 'react'
import { supabase } from '../../lib/supabase'

const SITE_URL = 'https://supply.indiajobworks.com'

function cleanPhone(p) { return (p || '').replace(/[^\d]/g, '') }

function buildWaMessage(invite, lang) {
  const name = lang === 'zh'
    ? (invite.contact_person_zh || invite.contact_person_en || invite.company_name_en || '您好')
    : (invite.contact_person_en || invite.company_name_en || 'Hello')
  if (lang === 'zh') {
    return `您好 ${name}！\n\nAryana Amusements（印度）邀请您通过专属链接直接上传您的产品图片、视频和价格表。\n\n点击以下链接即可开始（无需注册）：\n${invite.invite_url}\n\n如有疑问请联系：\nBhavesh — Aryana Amusements\n+91 9841081945`
  }
  return `Hello ${name}!\n\nAryana Amusements (India) has set up a secure upload portal for your product files.\n\nClick the link below to start uploading — no registration needed:\n${invite.invite_url}\n\nQuestions? Contact:\nBhavesh – Aryana Amusements\n+91 9841081945`
}

export default function InviteSupplierModal({ onClose, onDone }) {
  const [step, setStep]         = useState('form')   // 'form' | 'share'
  const [invite, setInvite]     = useState(null)
  const [linkType, setLinkType] = useState('specific')
  const [lang, setLang]         = useState('zh')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [urlCopied, setUrlCopied] = useState(false)
  const [msgCopied, setMsgCopied] = useState(false)
  const [emailState, setEmailState] = useState('idle')
  const [emailErr, setEmailErr] = useState('')

  const [form, setForm] = useState({
    company_name_en: '', company_name_zh: '',
    phone: '', contact_person_en: '', contact_person_zh: '',
    email: '', label: '',
  })
  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }

  async function createLink(e) {
    e.preventDefault()
    setCreateErr(''); setCreating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/invite-supplier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...form, action: 'create', link_type: linkType }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not create link')
      setInvite({ ...form, invite_url: json.invite_url, invite_token: json.invite_token, reused: json.reused })
      setStep('share')
    } catch (err) {
      setCreateErr(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function sendEmail() {
    if (!invite.email) return
    setEmailState('sending'); setEmailErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/invite-supplier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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
    setUrlCopied(true); setTimeout(() => setUrlCopied(false), 2500)
  }
  async function copyMsg() {
    await navigator.clipboard.writeText(buildWaMessage(invite, lang))
    setMsgCopied(true); setTimeout(() => setMsgCopied(false), 2500)
  }

  function reset() { setStep('form'); setInvite(null); setEmailState('idle'); setCreateErr('') }

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:border-red-400 outline-none'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-gray-100 z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              {step === 'form' ? '🔗 Create Upload Link' : '📤 Share Upload Link'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'form'
                ? 'All fields optional — supplier goes directly to upload page'
                : `Link ready${invite?.reused ? ' (existing link reused)' : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-4">×</button>
        </div>

        {/* ── STEP 1: Form ── */}
        {step === 'form' && (
          <form onSubmit={createLink} className="px-6 py-5 space-y-4">

            {/* Link type toggle */}
            <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
              {[
                { val: 'specific', icon: '👤', label: 'For one supplier', desc: 'Permanent personal link' },
                { val: 'open',     icon: '📢', label: 'Generic / Ad link', desc: 'Anyone can use it' },
              ].map(({ val, icon, label, desc }) => (
                <button key={val} type="button" onClick={() => setLinkType(val)}
                  className={`flex-1 flex flex-col items-center py-2.5 px-3 rounded-lg text-xs transition-all
                    ${linkType === val
                      ? 'bg-white shadow text-gray-800 font-medium'
                      : 'text-gray-500 hover:text-gray-700'}`}>
                  <span className="text-base mb-0.5">{icon}</span>
                  <span className="font-medium">{label}</span>
                  <span className="text-[10px] text-gray-400">{desc}</span>
                </button>
              ))}
            </div>

            {linkType === 'open' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
                Use this for advertisements or mass sharing. Each visitor gets their own account and a personal link to return later.
              </div>
            )}

            {/* Optional label */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Label <span className="text-gray-400 font-normal">(for your reference)</span></label>
              <input value={form.label} onChange={set('label')} className={inp}
                placeholder="e.g. UNIS Technology — Canton Fair 2026" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Company Name (English)</label>
                <input value={form.company_name_en} onChange={set('company_name_en')} className={inp}
                  placeholder="Guangzhou ABC Co." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">公司名称（中文）</label>
                <input value={form.company_name_zh} onChange={set('company_name_zh')} className={inp}
                  placeholder="广州ABC有限公司" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp Number</label>
                <input type="tel" value={form.phone} onChange={set('phone')} className={inp}
                  placeholder="+86 138 0000 0000" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={form.email} onChange={set('email')} className={inp}
                  placeholder="supplier@company.com" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contact Person (EN)</label>
                <input value={form.contact_person_en} onChange={set('contact_person_en')} className={inp}
                  placeholder="Wang Wei" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">联系人（中文）</label>
                <input value={form.contact_person_zh} onChange={set('contact_person_zh')} className={inp}
                  placeholder="王伟" />
              </div>
            </div>

            {createErr && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                ❌ {createErr}
              </div>
            )}

            <button type="submit" disabled={creating}
              className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {creating
                ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Creating…</>
                : '🔗 Create Upload Link'}
            </button>
          </form>
        )}

        {/* ── STEP 2: Share ── */}
        {step === 'share' && invite && (
          <div className="px-6 py-5 space-y-4">

            {/* Big copy URL section */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <p className="text-xs font-medium text-gray-500">Upload Link (permanent — no expiry)</p>
              <p className="text-xs font-mono text-gray-700 break-all bg-white border border-gray-200 rounded-lg px-3 py-2">
                {invite.invite_url}
              </p>
              <button onClick={copyUrl}
                className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  urlCopied
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-800 text-white hover:bg-gray-700'
                }`}>
                {urlCopied ? '✓ Copied to clipboard!' : '📋 Copy Link'}
              </button>
            </div>

            {/* Language toggle */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Message language:</span>
              {[['zh', '🇨🇳 中文'], ['en', '🇬🇧 English']].map(([l, label]) => (
                <button key={l} type="button" onClick={() => setLang(l)}
                  className={`px-3 py-1 rounded-full border text-xs transition-colors
                    ${lang === l ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 hover:border-gray-500 text-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* WhatsApp */}
            <div className="border border-green-200 rounded-xl overflow-hidden">
              <div className="bg-green-50 px-4 py-3 flex items-center gap-2">
                <span className="text-lg">💬</span>
                <div>
                  <p className="text-sm font-medium text-green-800">Send via WhatsApp</p>
                  <p className="text-xs text-green-600">{invite.phone ? `To: ${invite.phone}` : 'Open WhatsApp manually'}</p>
                </div>
              </div>
              <div className="px-4 py-3 space-y-2">
                {invite.phone && cleanPhone(invite.phone).length >= 7 ? (
                  <a href={`https://wa.me/${cleanPhone(invite.phone)}?text=${encodeURIComponent(buildWaMessage(invite, lang))}`}
                    target="_blank" rel="noreferrer"
                    className="block w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors text-center">
                    Open WhatsApp →
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">Add number to open WhatsApp directly:</p>
                    <div className="flex gap-2">
                      <input type="tel" placeholder="+86 138..." value={invite.phone || ''}
                        onChange={e => setInvite(i => ({ ...i, phone: e.target.value }))}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-400" />
                    </div>
                    {invite.phone && cleanPhone(invite.phone).length >= 7 && (
                      <a href={`https://wa.me/${cleanPhone(invite.phone)}?text=${encodeURIComponent(buildWaMessage(invite, lang))}`}
                        target="_blank" rel="noreferrer"
                        className="block w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors text-center">
                        Open WhatsApp →
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* WeChat */}
            <div className="border border-emerald-200 rounded-xl overflow-hidden">
              <div className="bg-emerald-50 px-4 py-3 flex items-center gap-2">
                <span className="text-lg">🟢</span>
                <div>
                  <p className="text-sm font-medium text-emerald-800">Send via WeChat</p>
                  <p className="text-xs text-emerald-500">Copy message and paste in WeChat</p>
                </div>
              </div>
              <div className="px-4 py-3 space-y-2">
                <textarea readOnly value={buildWaMessage(invite, lang)} rows={7}
                  className="w-full text-xs border border-gray-200 rounded-lg p-3 bg-white resize-none font-mono leading-relaxed text-gray-700 cursor-text"
                  onClick={e => e.target.select()} />
                <button onClick={copyMsg}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-all ${
                    msgCopied ? 'bg-green-500 text-white' : 'bg-emerald-700 text-white hover:bg-emerald-800'
                  }`}>
                  {msgCopied ? '✓ Copied! Paste in WeChat' : '📋 Copy Message'}
                </button>
              </div>
            </div>

            {/* Email (only if email provided) */}
            {invite.email && (
              <div className="border border-blue-200 rounded-xl overflow-hidden">
                <div className="bg-blue-50 px-4 py-3 flex items-center gap-2">
                  <span className="text-lg">📧</span>
                  <div>
                    <p className="text-sm font-medium text-blue-800">Send Email</p>
                    <p className="text-xs text-blue-500">To: {invite.email}</p>
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
                      <span className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" /> Sending…
                    </div>
                  )}
                  {emailState === 'ok' && <p className="text-sm text-green-700 py-1">✅ Email sent to {invite.email}</p>}
                  {emailState === 'err' && (
                    <div className="space-y-1">
                      <p className="text-xs text-red-600">❌ {emailErr}</p>
                      <button onClick={() => setEmailState('idle')} className="text-xs text-blue-600 hover:underline">Try again</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={reset}
                className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm transition-colors">
                + Create Another
              </button>
              <button onClick={() => { if (onDone) onDone(); onClose() }}
                className="flex-1 bg-red-600 text-white hover:bg-red-700 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                Done ✓
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
