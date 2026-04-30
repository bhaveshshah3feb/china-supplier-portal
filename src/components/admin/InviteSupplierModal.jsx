import { useState } from 'react'
import { supabase } from '../../lib/supabase'

const ADMIN_WHATSAPP = '919841081945'
const SITE_URL       = 'https://supply.indiajobworks.com'

// Build a wa.me link from admin → supplier
function waLink(phone, text) {
  const clean = phone.replace(/[^\d+]/g, '').replace(/^\+/, '')
  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`
}

function inviteText(invite, lang = 'en') {
  if (lang === 'zh') {
    return `您好 ${invite.contact_person_zh || invite.contact_person_en || invite.company_name_zh || invite.company_name_en}！\n\nAryana Amusements（印度）诚邀您加入我们的供应商门户。\n\n请点击以下链接创建账户：\n${invite.invite_url}\n\n您的公司信息已预填写，只需设置密码即可完成注册。\n\n如有问题请联系：\nBhavesh，Aryana Amusements\n+91 9841081945`
  }
  return `Hello ${invite.contact_person_en || invite.company_name_en}!\n\nAryana Amusements (India) has invited you to join our Supplier Portal.\n\nClick here to create your account:\n${invite.invite_url}\n\nYour company details are pre-filled — just set a password to complete registration.\n\nQuestions? Contact:\nBhavesh, Aryana Amusements\n+91 9841081945`
}

export default function InviteSupplierModal({ onClose, onInvited }) {
  const [step, setStep]       = useState('form')   // 'form' | 'sent'
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [invite, setInvite]   = useState(null)
  const [copied, setCopied]   = useState(false)
  const [lang, setLang]       = useState('en')

  const [form, setForm] = useState({
    email: '', company_name_en: '', company_name_zh: '',
    phone: '', contact_person_en: '', contact_person_zh: '', notes: '',
  })

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }

  async function createInvite(channel, sendEmail = false) {
    if (!form.email || !form.company_name_en) {
      setError('Email and Company Name (English) are required.')
      return null
    }
    if (channel === 'whatsapp' && !form.phone) {
      setError('Phone number is required to send via WhatsApp.')
      return null
    }
    setError('')
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/invite-supplier', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ...form, channel, send_email: sendEmail }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create invitation')
      setInvite({ ...form, ...json, invite_url: json.invite_url })
      setStep('sent')
      if (onInvited) onInvited()
      return json
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function sendEmail() {
    await createInvite('email', true)
  }

  async function sendWhatsApp() {
    const result = await createInvite('whatsapp', false)
    if (!result) return
    const inv = { ...form, ...result }
    const text = inviteText(inv, lang)
    window.open(waLink(form.phone, text), '_blank')
  }

  async function copyWeChat() {
    const result = await createInvite('wechat', false)
    if (!result) return
    const inv = { ...form, ...result }
    const text = inviteText(inv, 'zh')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  async function copyLink() {
    if (!invite) return
    await navigator.clipboard.writeText(invite.invite_url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const field = (label, key, props = {}) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        value={form[key]} onChange={set(key)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
        {...props}
      />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              {step === 'form' ? '✉️ Invite New Supplier' : '✅ Invitation Ready'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'form' ? 'Create an invite link and send it via email, WhatsApp, or WeChat'
                               : `Invitation created for ${invite?.email}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {step === 'form' ? (
          <div className="px-6 py-5 space-y-4">
            {/* Required fields */}
            <div className="grid grid-cols-2 gap-3">
              {field('Email *', 'email', { type: 'email', required: true, placeholder: 'supplier@company.com' })}
              {field('Phone (for WhatsApp)', 'phone', { type: 'tel', placeholder: '+86 138 0000 0000' })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field('Company Name (English) *', 'company_name_en', { required: true, placeholder: 'Guangzhou ABC Co.' })}
              {field('公司名称（中文）', 'company_name_zh', { placeholder: '广州ABC有限公司' })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field('Contact Person (EN)', 'contact_person_en', { placeholder: 'Wang Wei' })}
              {field('联系人（中文）', 'contact_person_zh', { placeholder: '王伟' })}
            </div>
            {field('Internal Notes (admin only)', 'notes', { placeholder: 'e.g. Met at Canton Fair 2025' })}

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            {/* Message language toggle for WhatsApp/WeChat */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Message language:</span>
              {['en', 'zh'].map(l => (
                <button key={l} onClick={() => setLang(l)}
                  className={`px-2.5 py-1 rounded-full border transition-colors ${lang === l ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 hover:border-brand-400'}`}>
                  {l === 'en' ? '🇬🇧 English' : '🇨🇳 中文'}
                </button>
              ))}
            </div>

            {/* Send buttons */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button onClick={sendEmail} disabled={loading}
                className="flex flex-col items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-3 rounded-xl font-medium text-xs transition-colors disabled:opacity-60">
                <span className="text-2xl">📧</span>
                <span>Send Email Invite</span>
                <span className="text-blue-200 text-[10px] font-normal">Automated</span>
              </button>

              <button onClick={sendWhatsApp} disabled={loading}
                className="flex flex-col items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3 py-3 rounded-xl font-medium text-xs transition-colors disabled:opacity-60">
                <span className="text-2xl">💬</span>
                <span>Send via WhatsApp</span>
                <span className="text-green-200 text-[10px] font-normal">Opens your WA</span>
              </button>

              <button onClick={copyWeChat} disabled={loading}
                className="flex flex-col items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-3 rounded-xl font-medium text-xs transition-colors disabled:opacity-60">
                <span className="text-2xl">🟢</span>
                <span>{copied ? '✓ Copied!' : 'Copy for WeChat'}</span>
                <span className="text-emerald-300 text-[10px] font-normal">Paste in WeChat</span>
              </button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-brand-500 rounded-full animate-spin" />
                Creating invitation…
              </div>
            )}
          </div>
        ) : (
          /* ── Success / Send Step ── */
          <div className="px-6 py-5 space-y-4">
            {/* Invite URL */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Invite Link</p>
              <p className="text-sm font-mono text-gray-700 break-all">{invite?.invite_url}</p>
              <button onClick={copyLink}
                className="text-xs bg-white border border-gray-200 hover:border-brand-400 px-3 py-1.5 rounded-lg transition-colors">
                {copied ? '✓ Copied!' : '📋 Copy Link'}
              </button>
            </div>

            {/* Share again options */}
            <p className="text-sm font-medium text-gray-700">Share this invite:</p>
            <div className="grid grid-cols-2 gap-2">
              {form.phone && (
                <a href={waLink(form.phone, inviteText(invite, lang))} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
                  💬 Open WhatsApp →
                </a>
              )}
              <button onClick={async () => {
                await navigator.clipboard.writeText(inviteText(invite, 'zh'))
                setCopied(true); setTimeout(() => setCopied(false), 2000)
              }}
                className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
                🟢 {copied ? '✓ Copied!' : 'Copy WeChat Message'}
              </button>
            </div>

            {/* Info */}
            <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
              <p className="font-medium">📌 What happens next</p>
              <p>The supplier opens the link → their details are pre-filled → they set a password → account is created (pending your approval).</p>
              <p>Link expires in <strong>14 days</strong>.</p>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => { setStep('form'); setInvite(null) }}
                className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm transition-colors">
                + Invite Another
              </button>
              <button onClick={onClose}
                className="flex-1 bg-brand-600 text-white hover:bg-brand-700 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
