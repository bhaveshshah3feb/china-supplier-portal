import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase, getSessionRole } from '../../lib/supabase'
import LanguageSwitcher from '../common/LanguageSwitcher'

const ADMIN_WHATSAPP = '919841081945'

export default function Login() {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language?.startsWith('zh')
  const navigate = useNavigate()

  // ── Login state ───────────────────────────────────────────────
  const [mode, setMode]       = useState('password')
  const [otpStep, setOtpStep] = useState('email')
  const [form, setForm]       = useState({ email: '', password: '', otp: '' })
  const [error, setError]     = useState('')
  const [otpInfo, setOtpInfo] = useState('')
  const [loading, setLoading] = useState(false)

  // ── Register state ────────────────────────────────────────────
  const [reg, setReg] = useState({
    email: '', password: '', confirmPassword: '',
    company_name_en: '', company_name_zh: '',
    phone: '', contact_person_en: '', contact_person_zh: '',
  })
  const [regError, setRegError]     = useState('')
  const [regLoading, setRegLoading] = useState(false)

  function set(k)  { return e => setForm(f => ({ ...f, [k]: e.target.value })) }
  function setR(k) { return e => setReg(f =>  ({ ...f, [k]: e.target.value })) }
  function reset() { setError(''); setOtpInfo('') }

  // ── Login helpers ─────────────────────────────────────────────
  async function afterLogin(userId) {
    const info = await getSessionRole(userId)
    if (!info)                       { setError('Account not found.'); return false }
    if (info.role === 'admin')       { navigate('/admin/dashboard'); return true }
    if (info.status === 'suspended') { setError(t('auth.suspended')); return false }
    navigate('/dashboard'); return true
  }

  async function submitPassword(e) {
    e.preventDefault(); reset(); setLoading(true)
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: form.email, password: form.password,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    await afterLogin(data.user.id)
  }

  async function sendOtp(e) {
    e.preventDefault(); reset()
    if (!form.email) { setError(isZh ? '请输入邮箱' : 'Please enter your email'); return }
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithOtp({
      email: form.email,
      options: { shouldCreateUser: false },
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setOtpInfo(isZh ? `验证码已发送至 ${form.email}，请查看邮件。` : `OTP sent to ${form.email} — check your inbox.`)
    setOtpStep('code')
  }

  async function verifyOtp(e) {
    e.preventDefault(); reset()
    if (!form.otp || form.otp.length < 6) {
      setError(isZh ? '请输入6位验证码' : 'Enter the 6-digit code'); return
    }
    setLoading(true)
    const { data, error: err } = await supabase.auth.verifyOtp({
      email: form.email, token: form.otp.trim(), type: 'email',
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    await afterLogin(data.user.id)
  }

  // ── Register handler ──────────────────────────────────────────
  async function submitRegister(e) {
    e.preventDefault()
    setRegError('')
    if (reg.password.length < 8)              { setRegError(t('auth.passwordMin')); return }
    if (reg.password !== reg.confirmPassword) { setRegError(t('auth.passwordMatch')); return }
    setRegLoading(true)
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: reg.email,
      password: reg.password,
      options: {
        data: {
          role:              'supplier',
          company_name_en:   reg.company_name_en,
          company_name_zh:   reg.company_name_zh,
          phone:             reg.phone,
          contact_person_en: reg.contact_person_en,
          contact_person_zh: reg.contact_person_zh,
        },
      },
    })
    setRegLoading(false)
    if (signUpErr) { setRegError(signUpErr.message); return }
    // Email confirmation disabled → session is returned immediately
    if (data.session) {
      navigate('/dashboard')
    } else {
      // Fallback if confirmation is still on in Supabase settings
      navigate('/verify')
    }
  }

  const inp   = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none'
  const inpSm = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none'

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-5xl">

        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl mb-3 shadow-lg">
            <span className="text-2xl font-bold text-brand-700">A</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Aryan Amusements</h1>
          <p className="text-brand-200 text-sm mt-1">Supplier Portal · 供应商门户</p>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* ── LEFT: Sign in ── */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">

            <div className="flex border-b border-gray-100">
              {[
                { key: 'password', label: isZh ? '🔑 密码登录'  : '🔑 Password' },
                { key: 'otp',      label: isZh ? '📩 验证码登录' : '📩 OTP Code' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => { setMode(key); reset(); setOtpStep('email') }}
                  className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors
                    ${mode === key ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="p-7 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800">
                  {mode === 'password' ? (isZh ? '欢迎回来' : 'Welcome back')
                   : otpStep === 'email' ? (isZh ? '获取验证码' : 'Get a one-time code')
                   : (isZh ? '输入验证码' : 'Enter your code')}
                </h2>
                <LanguageSwitcher className="text-gray-500 border-gray-300" />
              </div>

              {/* Password form */}
              {mode === 'password' && (
                <form onSubmit={submitPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                    <input type="email" required value={form.email} onChange={set('email')}
                      className={inp} placeholder="supplier@company.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.password')}</label>
                    <input type="password" required value={form.password} onChange={set('password')} className={inp} />
                  </div>
                  {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60">
                    {loading ? t('common.loading') : t('auth.loginBtn')}
                  </button>
                </form>
              )}

              {/* OTP email step */}
              {mode === 'otp' && otpStep === 'email' && (
                <form onSubmit={sendOtp} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                    <input type="email" required value={form.email} onChange={set('email')}
                      className={inp} placeholder="supplier@company.com" />
                  </div>
                  <p className="text-xs text-gray-500">
                    {isZh ? '我们将向您的注册邮箱发送一个6位验证码。' : "A 6-digit code will be emailed to your registered address."}
                  </p>
                  {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60">
                    {loading ? t('common.loading') : (isZh ? '发送验证码 →' : 'Send Code →')}
                  </button>
                </form>
              )}

              {/* OTP code step */}
              {mode === 'otp' && otpStep === 'code' && (
                <form onSubmit={verifyOtp} className="space-y-4">
                  {otpInfo && (
                    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
                      📩 {otpInfo}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {isZh ? '6位验证码' : '6-Digit Code'}
                    </label>
                    <input type="text" inputMode="numeric" maxLength={6} autoFocus
                      value={form.otp} onChange={set('otp')}
                      className={`${inp} text-center text-2xl font-mono tracking-[0.5em]`}
                      placeholder="------"
                    />
                  </div>
                  {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60">
                    {loading ? t('common.loading') : (isZh ? '验证并登录' : 'Verify & Login')}
                  </button>
                  <button type="button" onClick={() => { setOtpStep('email'); reset() }}
                    className="w-full text-sm text-gray-400 hover:text-gray-600">
                    ← {isZh ? '重新输入邮箱' : 'Change email / Resend'}
                  </button>
                </form>
              )}
            </div>

            {/* WhatsApp help */}
            <div className="bg-gray-50 border-t border-gray-100 px-6 py-4 flex items-start gap-3">
              <span className="text-xl shrink-0 mt-0.5">💬</span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-600">
                  {isZh ? '需要通过微信或WhatsApp登录？' : 'Prefer WhatsApp or WeChat?'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 mb-2">
                  {isZh ? '联系Bhavesh获取免密登录链接。' : 'Ask Bhavesh to send you a one-click login link.'}
                </p>
                <a href={`https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(
                    isZh ? '您好，请给我发送供应商门户的登录链接，谢谢！' : 'Hi Bhavesh, please send me a login link for the supplier portal.')}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors">
                  💬 {isZh ? 'WhatsApp联系' : 'Message on WhatsApp'}
                </a>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Register ── */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-brand-50">
              <h2 className="font-semibold text-gray-800">
                🏭 {isZh ? '首次访问？立即注册' : 'New Supplier? Create Account'}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {isZh ? '注册账户，上传您的产品目录和视频。' : 'Register to upload your product catalogs and videos.'}
              </p>
            </div>

            <div className="p-6">
              <form onSubmit={submitRegister} className="space-y-3">

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.companyNameEn')} *</label>
                    <input required value={reg.company_name_en} onChange={setR('company_name_en')}
                      className={inpSm} placeholder="Guangzhou ABC Co." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.companyNameZh')}</label>
                    <input value={reg.company_name_zh} onChange={setR('company_name_zh')}
                      className={inpSm} placeholder="广州ABC有限公司" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.contactPersonEn')}</label>
                    <input value={reg.contact_person_en} onChange={setR('contact_person_en')}
                      className={inpSm} placeholder="Wang Wei" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.contactPersonZh')}</label>
                    <input value={reg.contact_person_zh} onChange={setR('contact_person_zh')}
                      className={inpSm} placeholder="王伟" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.phone')} *</label>
                  <input required type="tel" value={reg.phone} onChange={setR('phone')}
                    className={inpSm} placeholder="+86 138 0000 0000" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.email')} *</label>
                  <input required type="email" value={reg.email} onChange={setR('email')}
                    className={inpSm} placeholder="supplier@company.com" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.password')} *</label>
                    <input required type="password" value={reg.password} onChange={setR('password')}
                      className={inpSm} placeholder={isZh ? '至少8位' : 'Min 8 chars'} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t('auth.confirmPassword')} *</label>
                    <input required type="password" value={reg.confirmPassword} onChange={setR('confirmPassword')}
                      className={inpSm} />
                  </div>
                </div>

                {regError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{regError}</p>}

                <button type="submit" disabled={regLoading}
                  className="w-full py-2.5 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60 text-sm">
                  {regLoading ? t('common.loading') : (isZh ? '注册账户 →' : 'Create Account →')}
                </button>

                <p className="text-center text-xs text-gray-400">
                  {isZh
                    ? '注册成功后即可直接登录，无需验证邮箱。'
                    : 'You will be logged in instantly — no email verification needed.'}
                </p>
              </form>
            </div>
          </div>

        </div>
      </div>

      <div className="fixed bottom-2 left-3 text-white/30 text-[10px] font-mono select-none">
        {__BUILD_HASH__} · {__BUILD_TIME__}
      </div>
    </div>
  )
}
