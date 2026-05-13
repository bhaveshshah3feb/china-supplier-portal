import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function GuestLanding() {
  const { token } = useParams()
  const [stage, setStage]       = useState('loading')  // loading | ready | uploading | error
  const [error, setError]       = useState('')
  const [form, setForm]         = useState({ companyName: '', phone: '' })
  const [isOpen, setIsOpen]     = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { checkLink() }, [token])

  async function checkLink() {
    if (!token) { setError('No link token provided'); setStage('error'); return }
    try {
      const { data: invite } = await supabase
        .from('supplier_invitations')
        .select('link_type, status, expires_at')
        .eq('invite_token', token)
        .eq('status', 'pending')
        .maybeSingle()

      if (!invite) { setError('Link not found or no longer active'); setStage('error'); return }
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        setError('This link has expired. Contact Aryana Amusements for a new one.')
        setStage('error'); return
      }
      setIsOpen(invite.link_type === 'open')
      setStage('ready')
    } catch {
      setError('Could not connect to server')
      setStage('error')
    }
  }

  async function activate(companyName, phone) {
    setSubmitting(true)
    try {
      // Step 1: call API to create/find supplier account, get token hash back
      const res = await fetch('/api/guest-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          companyName: companyName || undefined,
          phone: phone || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Failed to activate link'); setStage('error'); return }

      if (json.personalToken) {
        localStorage.setItem('guestPersonalToken', json.personalToken)
      }

      // Step 2: verify OTP client-side — no redirect URL needed, works on any domain
      const { error: otpErr } = await supabase.auth.verifyOtp({
        token_hash: json.tokenHash,
        type: 'magiclink',
      })
      if (otpErr) { setError('Could not sign in: ' + otpErr.message); setStage('error'); return }

      // Step 3: navigate to dashboard
      window.location.href = '/dashboard'
    } catch (e) {
      setError('Could not connect to server')
      setStage('error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ────────────────────────────────────────────────
  if (stage === 'loading') return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
      <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-500 text-sm">Preparing your upload session…</p>
    </div>
  )

  // ── Error ──────────────────────────────────────────────────
  if (stage === 'error') return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl border border-red-200 p-8 max-w-sm w-full text-center space-y-3 shadow-sm">
        <div className="text-4xl">🔗</div>
        <h2 className="font-semibold text-gray-800">Link unavailable</h2>
        <p className="text-sm text-red-600">{error}</p>
        <p className="text-xs text-gray-400 mt-2">
          Contact Aryana Amusements:<br />
          <a href="https://wa.me/919841081945" className="text-green-600 font-medium hover:underline">
            WhatsApp Bhavesh +91 98410 81945
          </a>
        </p>
      </div>
    </div>
  )

  // ── Main page ──────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-red-700 to-red-500 px-8 py-6 text-white text-center">
          <div className="text-3xl mb-2">📤</div>
          <h1 className="text-xl font-bold">Upload Your Products</h1>
          <p className="text-red-200 text-xs mt-1">Aryana Amusements — Supplier Portal</p>
        </div>

        <div className="px-8 py-6 space-y-5">

          {/* Primary action — always at top */}
          <button
            onClick={() => activate(form.companyName, form.phone)}
            disabled={submitting}
            className="w-full py-3.5 bg-red-600 text-white rounded-xl font-bold text-base hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm"
          >
            {submitting
              ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Starting…</>
              : 'Start Uploading →'}
          </button>

          {/* Divider */}
          {isOpen && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-xs text-gray-400">optional — helps us label your files</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              {/* Optional fields — at bottom */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Company Name</label>
                  <input
                    value={form.companyName}
                    onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
                    placeholder="e.g. Guangzhou ABC Technology Co."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">WhatsApp / WeChat Number</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
                    placeholder="+86 138 0000 0000"
                  />
                </div>
              </div>

              <p className="text-[11px] text-gray-300 text-center">
                Your files will be processed and branded by Aryana Amusements for sales use.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
