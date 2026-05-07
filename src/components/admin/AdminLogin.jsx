import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase, getSessionRole } from '../../lib/supabase'

export default function AdminLogin() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [form, setForm]   = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }

  async function submit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data, error: authErr } = await supabase.auth.signInWithPassword({
      email: form.email, password: form.password,
    })
    if (authErr) { setError(authErr.message); setLoading(false); return }

    const userRole = data.user?.user_metadata?.role
    if (userRole !== 'admin' && userRole !== 'staff') {
      await supabase.auth.signOut()
      setError('Access denied. This portal is for admin and staff only.')
      setLoading(false)
      return
    }

    navigate('/admin/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-red-600 rounded-2xl mb-4">
            <span className="text-white text-xl font-bold">A</span>
          </div>
          <h1 className="text-xl font-bold text-white">Admin Portal</h1>
          <p className="text-gray-400 text-sm mt-1">Aryana Amusements</p>
        </div>

        <div className="bg-gray-800 rounded-2xl p-7 border border-gray-700">
          <h2 className="text-lg font-semibold text-white mb-5">{t('auth.adminLogin')}</h2>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('auth.email')}</label>
              <input
                type="email" required value={form.email} onChange={set('email')}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('auth.password')}</label>
              <input
                type="password" required value={form.password} onChange={set('password')}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
              />
            </div>
            {error && <p className="text-sm text-red-400 bg-red-900/30 px-3 py-2 rounded-lg">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {loading ? t('common.loading') : t('auth.loginBtn')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
