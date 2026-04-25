import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LanguageSwitcher from './LanguageSwitcher'

export default function Header({ role }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">A</div>
        <span className="font-semibold text-gray-800 text-sm">
          Aryana Amusements
          {role === 'admin' && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Admin</span>}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <LanguageSwitcher className="text-gray-600 border-gray-300" />
        <button
          onClick={logout}
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          {t('auth.logout')}
        </button>
      </div>
    </header>
  )
}
