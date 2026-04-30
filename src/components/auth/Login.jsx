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

  const [mode, setMode]     = useState('password')   // 'password' | 'otp'
  const [otpStep, setOtpStep] = useState('email')    // 'email' | 'code'

  const [form, setForm]     = useState({ email: '', password: '', otp: '' })
  const [error, setError]   = useState('')
  const [info, setInfo]     = useState('')
  const [loading, setLoading] = useState(false)

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }

  // ── Password login ─────────────────────────────────────────
  async function submitPassword(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data, error: authErr } = await supabase.auth.signInWithPassword({
      email: form.email, password: form.password,
    })
    if (authErr) { setError(authErr.message); setLoading(false); return }

    const info = await getSessionRole(data.user.id)
    if (!info) { setError('Account not found.'); setLoading(false); return }
    if (info.role === 'admin')             { navigate('/admin/dashboard'); return }
    if (info.status === 'pending')         { setError(t('auth.pendingApproval')); setLoading(false); return }
    if (info.status === 'suspended')       { setError(t('auth.suspended'));       setLoading(false); return }
    navigate('/dashboard')
  }

  // ── OTP: send code ─────────────────────────────────────────
  async function sendOtp(e) {
    e.preventDefault()
    if (!form.email) { setError(isZh ? '请输入邮箱' : 'Please enter your email'); return }
    setError(''); setLoading(true)
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: form.email,
      options: { shouldCreateUser: false },
    })
    setLoading(false)
    if (otpErr) { setError(otpErr.message); return }
    setInfo(isZh ? `验证码已发送至 ${form.email}，请查看邮件。` : `OTP sent to ${form.email}. Check your inbox.`)
    setOtpStep('code')
  }

  // ── OTP: verify code ───────────────────────────────────────
  async function verifyOtp(e) {
    e.preventDefault()
    if (!form.otp || form.otp.length < 6) { setError(isZh ? '请输入6位验证码' : 'Enter the 6-digit code'); return }
    setError(''); setLoading(true)
    const { data, error: verifyErr } = await supabase.auth.verifyOtp({
      email: form.email,
      token: form.otp.trim(),
      type: 'email',
    })
    if (verifyErr) { setError(verifyErr.message); setLoading(false); return }

    const roleInfo = await getSessionRole(data.user.id)
    setLoading(false)
    if (!roleInfo) { setError('Account not found.'); return }
    if (roleInfo.role === 'admin')       { navigate('/admin/dashboard'); return }
    if (roleInfo.status === 'pending')   { setError(t('auth.pendingApproval')); return }
    if (roleInfo.status === 'suspended') { setError(t('auth.suspended')); return }
    navigate('/dashboard')
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none'

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

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">

          {/* Mode tabs */}
          <div className="flex border-b border-gray-100">
            {[
              { key: 'password', label: isZh ? '🔑 密码登录' : '🔑 Password' },
              { key: 'otp',      label: isZh ? '📩 验证码登录' : '📩 OTP Login' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => { setMode(key); setError(''); setInfo(''); setOtpStep('email') }}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors
                  ${mode === key ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="p-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-800">
                {mode === 'password'
                  ? (isZh ? '欢迎回来' : 'Welcome back')
                  : otpStep === 'email'
                    ? (isZh ? '获取验证码' : 'Get a one-time code')
                    : (isZh ? '输入验证码' : 'Enter your code')}
              </h2>
              <LanguageSwitcher className="text-gray-500 border-gray-300" />
            </div>

            {/* ── Password form ── */}
            {mode === 'password' && (
              <form onSubmit={submitPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                  <input type="email" required value={form.email} onChange={set('email')}
                    className={inputCls} placeholder="supplier@company.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.password')}</label>
                  <input type="password" required value={form.password} onChange={set('password')}
                    className={inputCls} />
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60">
                  {loading ? t('common.loading') : t('auth.loginBtn')}
                </button>
              </form>
            )}

            {/* ── OTP: email step ── */}
            {mode === 'otp' && otpStep === 'email' && (
              <form onSubmit={sendOtp} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                  <input type="email" required value={form.email} onChange={set('email')}
                    className={inputCls} placeholder="supplier@company.com" />
                </div>
                <p className="text-xs text-gray-500">
                  {isZh ? '我们将向您的注册邮箱发送一个6位验证码。' : "We'll send a 6-digit code to your registered email address."}
                </p>
                {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60">
                  {loading ? t('common.loading') : (isZh ? '发送验证码' : 'Send OTP Code')}
                </button>
              </form>
            )}

            {/* ── OTP: code step ── */}
            {mode === 'otp' && otpStep === 'code' && (
              <form onSubmit={verifyOtp} className="space-y-4">
                {info && (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
                    📩 {info}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {isZh ? '6位验证码' : '6-Digit Code'}
                  </label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                    value={form.otp} onChange={set('otp')}
                    className={`${inputCls} text-center text-2xl font-mono tracking-[0.4em]`}
                    placeholder="000000" autoFocus
                  />
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60">
                  {loading ? t('common.loading') : (isZh ? '验证登录' : 'Verify & Login')}
                </button>
                <button type="button" onClick={() => { setOtpStep('email'); setInfo(''); setError('') }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700">
                  ← {isZh ? '重新发送' : 'Back / Resend'}
                </button>
              </form>
            )}

            <p className="text-center text-sm text-gray-500 mt-2">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="text-brand-600 font-medium hover:underline">{t('auth.register')}</Link>
            </p>
          </div>

          {/* ── WhatsApp / WeChat help ── */}
          <div className="bg-gray-50 border-t border-gray-100 px-6 py-4">
            <p className="text-xs font-medium text-gray-500 mb-2">
              {isZh ? '💬 需要通过微信或WhatsApp登录？' : '💬 Prefer WhatsApp or WeChat?'}
            </p>
            <p className="text-xs text-gray-400 mb-3">
              {isZh
                ? '联系管理员获取免密登录链接，可直接转发到您的微信或WhatsApp。'
                : 'Ask admin to send you a one-click login link — no password needed. They can send it via WhatsApp or WeChat.'}
            </p>
            <a
              href={`https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(isZh ? '您好，请给我发送供应商门户的登录链接，谢谢！' : 'Hi Bhavesh, please send me a login link for the supplier portal.')}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 bg-green-600 text-white text-xs px-3 py-2 rounded-lg hover:bg-green-700 transition-colors">
              💬 {isZh ? '在WhatsApp上联系管理员' : 'Message Admin on WhatsApp'}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
