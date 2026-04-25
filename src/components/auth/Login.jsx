import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase, getSessionRole } from '../../lib/supabase'
import LanguageSwitcher from '../common/LanguageSwitcher'

export default function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [form, setForm]     = useState({ email: '', password: '' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }

  async function submit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data, error: authErr } = await supabase.auth.signInWithPassword({
      email: form.email, password: form.password,
    })
    if (authErr) { setError(authErr.message); setLoading(false); return }

    const info = await getSessionRole(data.user.id)
    if (!info) { setError('Account not found.'); setLoading(false); return }

    if (info.role === 'admin') { navigate('/admin/dashboard'); return }

    if (info.status === 'pending')   { setError(t('auth.pendingApproval'));  setLoading(false); return }
    if (info.status === 'suspended') { setError(t('auth.suspended'));        setLoading(false); return }

    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4 shadow-lg">
            <span className="text-2xl font-bold text-brand-700">A</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Aryana Amusements</h1>
          <p className="text-brand-200 text-sm mt-1">Supplier Portal · 供应商门户</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">{t('auth.login')}</h2>
            <LanguageSwitcher className="text-gray-500 border-gray-300" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
              <input
                type="email" required value={form.email} onChange={set('email')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                placeholder="supplier@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.password')}</label>
              <input
                type="password" required value={form.password} onChange={set('password')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
              />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60"
            >
              {loading ? t('common.loading') : t('auth.loginBtn')}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="text-brand-600 font-medium hover:underline">{t('auth.register')}</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
