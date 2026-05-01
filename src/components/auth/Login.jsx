import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase, getSessionRole } from '../../lib/supabase'
import LanguageSwitcher from '../common/LanguageSwitcher'

const ADMIN_WHATSAPP = '919841081945'

export default function Login() {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language?.startsWith('zh')
  const navigate = useNavigate()

  const [mode, setMode]       = useState('password')  // 'password' | 'otp'
  const [otpStep, setOtpStep] = useState('email')     // 'email' | 'code'

  const [form, setForm]       = useState({ email: '', password: '', otp: '' })
  const [error, setError]     = useState('')
  const [otpInfo, setOtpInfo] = useState('')
  const [loading, setLoading] = useState(false)

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }
  function reset() { setError(''); setOtpInfo('') }

  // ── helpers ───────────────────────────────────────────────
  async function afterLogin(userId) {
    const info = await getSessionRole(userId)
    if (!info)                       { setError('Account not found.'); return false }
    if (info.role === 'admin')       { navigate('/admin/dashboard'); return true }
    if (info.status === 'pending')   { setError(t('auth.pendingApproval')); return false }
    if (info.status === 'suspended') { setError(t('auth.suspended')); return false }
    navigate('/dashboard'); return true
  }

  // ── Password login ─────────────────────────────────────
  async function submitPassword(e) {
    e.preventDefault(); reset(); setLoading(true)
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: form.email, password: form.password,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    await afterLogin(data.user.id)
  }

  // ── OTP step 1: send code ─────────────────────────────
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

  // ── OTP step 2: verify ───────────────────────────────
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

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none'

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">

        {/* Logo */}
        <div className="text-center mb-2">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4 shadow-lg">
            <span className="text-2xl font-bold text-brand-700">A</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Aryana Amusements</h1>
          <p className="text-brand-200 text-sm mt-1">Supplier Portal · 供应商门户</p>
        </div>

        {/* ── Login card ── */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">

          {/* Mode tabs */}
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
                  <input
                    type="text" inputMode="numeric" maxLength={6} autoFocus
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

        {/* ── Self-register card ── */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20 text-center">
          <p className="text-white font-semibold text-sm">
            {isZh ? '🏭 首次访问？' : '🏭 New Supplier?'}
          </p>
          <p className="text-brand-200 text-xs mt-1 mb-4">
            {isZh
              ? '注册账户，上传您的产品目录和视频。'
              : 'Create an account to upload your product catalogs and videos.'}
          </p>
          <Link to="/register"
            className="inline-block bg-white text-brand-700 font-semibold text-sm px-6 py-2.5 rounded-xl hover:bg-brand-50 transition-colors shadow">
            {isZh ? '立即注册 →' : 'Create Account →'}
          </Link>
        </div>

      </div>

      {/* Build stamp — bottom left */}
      <div className="fixed bottom-2 left-3 text-white/30 text-[10px] font-mono select-none">
        {__BUILD_HASH__} · {__BUILD_TIME__}
      </div>
    </div>
  )
}
