import { useTranslation } from 'react-i18next'

export default function LanguageSwitcher({ className = '' }) {
  const { i18n } = useTranslation()
  const isZh = i18n.language?.startsWith('zh')

  function toggle() {
    i18n.changeLanguage(isZh ? 'en' : 'zh-CN')
  }

  return (
    <button
      onClick={toggle}
      className={`text-sm font-medium px-3 py-1.5 rounded-lg border border-current transition-opacity hover:opacity-75 ${className}`}
    >
      {isZh ? 'EN' : '中文'}
    </button>
  )
}
