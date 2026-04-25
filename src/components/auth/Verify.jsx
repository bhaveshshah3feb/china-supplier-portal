import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'

export default function Verify() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [status, setStatus] = useState('waiting')

  useEffect(() => {
    // If this page is loaded with a token in the URL hash, Supabase handles it automatically
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        setStatus('verified')
        setTimeout(() => navigate('/dashboard'), 2000)
      }
    })
    return () => subscription.unsubscribe()
  }, [navigate])

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center">
        {status === 'waiting' ? (
          <>
            <div className="text-6xl mb-5">✉️</div>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">{t('auth.verifyEmail')}</h2>
            <p className="text-gray-500 text-sm leading-relaxed">{t('auth.verifyMsg')}</p>
          </>
        ) : (
          <>
            <div className="text-6xl mb-5">✅</div>
            <h2 className="text-xl font-semibold text-green-700 mb-3">Email verified!</h2>
            <p className="text-gray-500 text-sm">Redirecting to your dashboard…</p>
          </>
        )}
      </div>
    </div>
  )
}
