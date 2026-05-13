import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function GuestLanding() {
  const { token } = useParams()
  const [stage, setStage]       = useState('loading')  // loading | form | error
  const [error, setError]       = useState('')
  const [form, setForm]         = useState({ companyName: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { checkLink() }, [token])

  async function checkLink() {
    if (!token) { setError('No link token provided'); setStage('error'); return }

    try {
      // Read link_type from public invitation record (no auth needed)
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

      if (invite.link_type === 'open') {
        // Show optional form before creating account
        setStage('form')
      } else {
        // Specific link — auto-login immediately
        await activate()
      }
    } catch {
      setError('Could not connect to server')
      setStage('error')
    }
  }

  async function activate(overrideForm) {
    const f = overrideForm || form
    try {
      const res = await fetch('/api/guest-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          companyName: f.companyName || undefined,
          phone: f.phone || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Failed to activate link'); setStage('error'); return }

      // Store personal token so dashboard can show the "bookmark your link" banner
      if (json.personalToken) {
        localStorage.setItem('guestPersonalToken', json.personalToken)
      }
      // Redirect to Supabase magic link → auto-authenticates → lands on /dashboard
      window.location.href = json.redirectUrl
    } catch {
      setError('Could not connect to server')
      setStage('error')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    await activate(form)
    setSubmitting(false)
  }

  // ── Loading spinner ────────────────────────────────────────
  if (stage === 'loading') return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
      <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-500 text-sm">Preparing your upload session…</p>
    </div>
  )

  // ── Error state ────────────────────────────────────────────
  if (stage === 'error') return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl border border-red-200 p-8 max-w-sm w-full text-center space-y-3 shadow-sm">
        <div className="text-4xl">🔗</div>
        <h2 className="font-semibold text-gray-800">Link unavailable</h2>
        <p className="text-sm text-red-600">{error}</p>
        <p className="text-xs text-gray-400 mt-2">
          Contact Aryana Amusements for a new link:<br />
          <a href="https://wa.me/919841081945" className="text-green-600 font-medium hover:underline">
            WhatsApp Bhavesh +91 98410 81945
          </a>
        </p>
      </div>
    </div>
  )

  // ── Open-link form ─────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-8 space-y-6">

        <div className="text-center space-y-2">
          <div className="text-4xl">📤</div>
          <h1 className="text-xl font-bold text-gray-800">Upload Your Products</h1>
          <p className="text-sm text-gray-400">Aryana Amusements — Supplier Portal</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Company Name <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              value={form.companyName}
              onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400"
              placeholder="e.g. Guangzhou ABC Technology Co."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              WhatsApp Number <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400"
              placeholder="+86 138 0000 0000"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold text-sm hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting
              ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Starting…</>
              : 'Start Uploading →'}
          </button>

          <button
            type="button"
            onClick={() => activate({ companyName: '', phone: '' })}
            disabled={submitting}
            className="w-full text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors"
          >
            Skip — upload without details
          </button>
        </form>

        <p className="text-[11px] text-gray-300 text-center">
          Your files will be processed and branded by Aryana Amusements for sales use.
        </p>
      </div>
    </div>
  )
}
