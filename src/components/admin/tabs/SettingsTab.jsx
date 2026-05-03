import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

const NOTIFICATION_KEYS = [
  {
    key:         'notification_email',
    label:       'Notification Email',
    placeholder: 'bhavesh.shah@gamesnmore.co.in',
    help:        'Daily summary report is sent to this email address',
    type:        'email',
  },
  {
    key:         'notification_whatsapp',
    label:       'Notification WhatsApp',
    placeholder: '919841081945',
    help:        'Digits only, no + (e.g. 919841081945 for +91 9841081945)',
    type:        'text',
  },
  {
    key:         'resend_api_key',
    label:       'Resend API Key',
    placeholder: 're_xxxxxxxxxxxx',
    help:        'Get a free key at resend.com — needed for email delivery',
    type:        'password',
  },
]

const WA_KEYS = [
  {
    key:         'whatsapp_phone_number_id',
    label:       'Phone Number ID',
    placeholder: '123456789012345',
    help:        'Meta Developer Portal → WhatsApp → Getting Started',
    type:        'text',
  },
  {
    key:         'whatsapp_access_token',
    label:       'Access Token',
    placeholder: 'EAAxxxxxxx...',
    help:        'Meta Business Suite → System Users → Generate Token (never expires)',
    type:        'password',
  },
  {
    key:         'whatsapp_business_account_id',
    label:       'Business Account ID',
    placeholder: '123456789',
    help:        'Meta Business Suite → Business Settings → Business Info',
    type:        'text',
  },
]

export default function SettingsTab() {
  const [settings, setSettings] = useState({})
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [showToken, setShowToken] = useState(false)
  const [testState, setTestState] = useState('idle') // idle | testing | ok | err
  const [testMsg, setTestMsg]   = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('settings').select('key, value')
    const map = {}
    for (const row of (data || [])) map[row.key] = row.value
    setSettings(map)
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const upserts = WA_KEYS.map(({ key }) => ({ key, value: settings[key] || '' }))
      const { error: err } = await supabase.from('settings').upsert(upserts, { onConflict: 'key' })
      if (err) throw new Error(err.message)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setTestState('testing')
    setTestMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ test: true }),
      })
      const body = await res.json()
      if (body.configured) {
        setTestState('ok')
        setTestMsg('Credentials loaded successfully. Ready to send.')
      } else {
        setTestState('err')
        setTestMsg(body.error || 'Not configured')
      }
    } catch {
      setTestState('err')
      setTestMsg('Could not reach API')
    }
    setTimeout(() => setTestState('idle'), 5000)
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Loading settings…</div>

  return (
    <div className="max-w-2xl space-y-6">

      {/* Daily Notifications */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <span className="text-2xl">🔔</span>
          <div>
            <h2 className="font-semibold text-gray-800">Daily Notifications</h2>
            <p className="text-xs text-gray-400">Summary sent every day at 9 AM IST via WhatsApp and email</p>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {NOTIFICATION_KEYS.map(({ key, label, placeholder, help, type }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                type={type === 'password' ? 'text' : type}
                value={settings[key] || ''}
                onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">{help}</p>
            </div>
          ))}
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} disabled={saving}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Settings'}
            </button>
            <a href="https://resend.com/signup" target="_blank" rel="noreferrer"
              className="text-xs text-blue-600 hover:underline">Get Resend API key (free) →</a>
          </div>
        </div>
      </div>

      {/* WhatsApp Business API */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <span className="text-2xl">💬</span>
          <div>
            <h2 className="font-semibold text-gray-800">WhatsApp Business API</h2>
            <p className="text-xs text-gray-400">Send files directly to customer phones via WhatsApp Cloud API</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {WA_KEYS.map(({ key, label, placeholder, help, type }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <div className="relative">
                <input
                  type={type === 'password' && !showToken ? 'password' : 'text'}
                  value={settings[key] || ''}
                  onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none font-mono pr-20"
                />
                {type === 'password' && (
                  <button
                    type="button"
                    onClick={() => setShowToken(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">{help}</p>
            </div>
          ))}

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <button onClick={save} disabled={saving}
              className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Settings'}
            </button>
            <button onClick={testConnection} disabled={testState === 'testing'}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-200 transition-colors disabled:opacity-50">
              {testState === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>
            {testMsg && (
              <span className={`text-xs px-3 py-1.5 rounded-lg ${testState === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {testState === 'ok' ? '✓ ' : '✗ '}{testMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Setup guide */}
      <div className="bg-amber-50 rounded-2xl border border-amber-100 p-6">
        <h3 className="font-semibold text-amber-800 text-sm mb-3">How to get WhatsApp API credentials</h3>
        <ol className="text-xs text-amber-700 space-y-2 list-decimal list-inside leading-relaxed">
          <li>Go to <strong>developers.facebook.com</strong> → My Apps → Create App → Business type</li>
          <li>In the app, click <strong>Add Product</strong> → WhatsApp → Set Up</li>
          <li>Copy the <strong>Phone Number ID</strong> shown in the Getting Started section</li>
          <li>Go to <strong>business.facebook.com</strong> → Settings → System Users</li>
          <li>Create a System User with <strong>Admin</strong> role, click Generate Token</li>
          <li>Select your WhatsApp app, grant <strong>whatsapp_business_messaging</strong> permission</li>
          <li>Copy the generated token — it never expires</li>
          <li>Also note the <strong>WhatsApp Business Account ID</strong> from Business Settings → Business Info</li>
        </ol>
        <a
          href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
          target="_blank"
          rel="noreferrer"
          className="inline-block mt-3 text-xs text-blue-600 hover:underline"
        >
          Official WhatsApp Cloud API Documentation →
        </a>
      </div>

    </div>
  )
}
