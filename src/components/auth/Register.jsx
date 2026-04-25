import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import LanguageSwitcher from '../common/LanguageSwitcher'

export default function Register() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    email: '', password: '', confirmPassword: '',
    company_name_en: '', company_name_zh: '',
    phone: '', contact_person_en: '', contact_person_zh: '',
  })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 8)             { setError(t('auth.passwordMin')); return }
    if (form.password !== form.confirmPassword) { setError(t('auth.passwordMatch')); return }

    setLoading(true)
    const { error: signUpErr } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/verify`,
        data: {
          role:             'supplier',
          company_name_en:  form.company_name_en,
          company_name_zh:  form.company_name_zh,
          phone:            form.phone,
          contact_person_en: form.contact_person_en,
          contact_person_zh: form.contact_person_zh,
        },
      },
    })

    if (signUpErr) { setError(signUpErr.message); setLoading(false); return }
    navigate('/verify')
  }

  const field = (label, key, props = {}) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        value={form[key]} onChange={set(key)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
        {...props}
      />
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4 shadow-lg">
            <span className="text-2xl font-bold text-brand-700">A</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Aryana Amusements</h1>
          <p className="text-brand-200 text-sm mt-1">Supplier Portal · 供应商门户</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">{t('auth.register')}</h2>
            <LanguageSwitcher className="text-gray-500 border-gray-300" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {field(t('auth.companyNameEn') + ' *', 'company_name_en', { required: true, placeholder: 'Guangzhou ABC Co.' })}
              {field(t('auth.companyNameZh'), 'company_name_zh', { placeholder: '广州ABC有限公司' })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field(t('auth.contactPersonEn'), 'contact_person_en', { placeholder: 'Wang Wei' })}
              {field(t('auth.contactPersonZh'), 'contact_person_zh', { placeholder: '王伟' })}
            </div>
            {field(t('auth.phone') + ' *', 'phone', { required: true, type: 'tel', placeholder: '+86 138 0000 0000' })}
            {field(t('auth.email') + ' *', 'email', { required: true, type: 'email', placeholder: 'supplier@company.com' })}
            <div className="grid grid-cols-2 gap-3">
              {field(t('auth.password') + ' *', 'password', { required: true, type: 'password' })}
              {field(t('auth.confirmPassword') + ' *', 'confirmPassword', { required: true, type: 'password' })}
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60"
            >
              {loading ? t('common.loading') : t('auth.registerBtn')}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="text-brand-600 font-medium hover:underline">{t('auth.login')}</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
