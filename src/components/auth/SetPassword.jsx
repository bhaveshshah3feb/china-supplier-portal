import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, getSessionRole } from '../../lib/supabase'

export default function SetPassword() {
  const navigate = useNavigate()
  const [form, setForm]     = useState({ password: '', confirm: '' })
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)
  const [ready, setReady]   = useState(false)

  useEffect(() => {
    // Wait for Supabase to process the invite token from the URL hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate('/login', { replace: true })
      } else {
        setReady(true)
      }
    })
  }, [navigate])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    setSaving(true)
    const { error: err } = await supabase.auth.updateUser({ password: form.password })
    if (err) { setError(err.message); setSaving(false); return }
    // Navigate based on role
    const { data: { user } } = await supabase.auth.getUser()
    const info = await getSessionRole(user.id)
    navigate(info?.role === 'staff' ? '/admin/dashboard' : '/dashboard', { replace: true })
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-100 rounded-2xl mb-3">
            <span className="text-2xl">🔑</span>
          </div>
          <h1 className="text-xl font-bold text-gray-800">Set your password</h1>
          <p className="text-sm text-gray-500 mt-1">Choose a password to log in next time</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password" required autoFocus
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Min 8 characters"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input
              type="password" required
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <button type="submit" disabled={saving}
            className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60">
            {saving ? 'Saving…' : 'Set Password & Continue →'}
          </button>
        </form>
      </div>
    </div>
  )
}
