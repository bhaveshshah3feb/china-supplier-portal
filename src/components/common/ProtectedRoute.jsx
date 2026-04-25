import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase, getSessionRole } from '../../lib/supabase'

export default function ProtectedRoute({ children, requireRole }) {
  const [state, setState] = useState('loading')

  useEffect(() => {
    let mounted = true
    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { if (mounted) setState('no-session'); return }

      const info = await getSessionRole(session.user.id)
      if (!mounted) return

      if (!info) { setState('no-role'); return }
      if (requireRole && info.role !== requireRole) { setState('wrong-role'); return }
      setState('ok')
    }
    check()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setState('no-session')
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [requireRole])

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (state === 'no-session')  return <Navigate to="/login" replace />
  if (state === 'wrong-role' && requireRole === 'admin') return <Navigate to="/dashboard" replace />
  if (state === 'wrong-role')  return <Navigate to="/admin/dashboard" replace />
  if (state === 'no-role')     return <Navigate to="/login" replace />

  return children
}
