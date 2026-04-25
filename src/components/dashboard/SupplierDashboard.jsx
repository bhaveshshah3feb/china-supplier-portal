import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import Header from '../common/Header'
import UploadZone from '../upload/UploadZone'
import UploadTray from '../upload/UploadTray'

const STATUS_BADGE = {
  pending:    'bg-yellow-100 text-yellow-700',
  active:     'bg-green-100 text-green-700',
  suspended:  'bg-red-100 text-red-700',
}

const PROC_BADGE = {
  pending:    'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-600',
  skipped:    'bg-gray-100 text-gray-400',
}

function formatBytes(b) {
  if (!b) return '—'
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function SupplierDashboard() {
  const { t } = useTranslation()
  const [supplier, setSupplier] = useState(null)
  const [uploads, setUploads]   = useState([])
  const [tab, setTab]           = useState('dashboard')
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const [{ data: sup }, { data: ups }] = await Promise.all([
        supabase.from('suppliers').select('*').eq('id', user.id).single(),
        supabase.from('uploads').select(`*, main_categories(name_en,name_zh), sub_categories(name_en,name_zh)`)
          .eq('supplier_id', user.id).order('created_at', { ascending: false }).limit(50),
      ])
      setSupplier(sup)
      setUploads(ups || [])
      setLoading(false)
    }
    load()

    // Realtime: reflect processing status changes instantly
    const channel = supabase.channel('uploads')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'uploads' },
        payload => setUploads(prev => prev.map(u => u.id === payload.new.id ? { ...u, ...payload.new } : u))
      ).subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const stats = {
    total:      uploads.length,
    processing: uploads.filter(u => u.processing_status === 'processing').length,
    completed:  uploads.filter(u => u.processing_status === 'completed').length,
    failed:     uploads.filter(u => u.processing_status === 'failed').length,
  }

  const isZh = document.documentElement.lang?.startsWith('zh')

  return (
    <div className="min-h-screen bg-gray-50">
      <Header role="supplier" />

      {/* Nav tabs */}
      <div className="bg-white border-b border-gray-200 px-4">
        <nav className="flex gap-1 max-w-5xl mx-auto">
          {['dashboard', 'uploads', 'newUpload'].map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {t(`nav.${k}`)}
            </button>
          ))}
        </nav>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* ── Dashboard tab ── */}
        {tab === 'dashboard' && (
          <div className="space-y-6">
            {/* Welcome + status */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">
                    {t('dashboard.welcome')}, {supplier?.company_name_en}
                  </h2>
                  {supplier?.company_name_zh && (
                    <p className="text-gray-500 text-sm mt-0.5">{supplier.company_name_zh}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{t('dashboard.supplierCode')}</p>
                    <p className="font-mono font-bold text-gray-700">{supplier?.supplier_code}</p>
                  </div>
                  <span className={`text-xs px-3 py-1 rounded-full font-medium ${STATUS_BADGE[supplier?.status]}`}>
                    {t(`dashboard.status.${supplier?.status}`)}
                  </span>
                </div>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: t('dashboard.totalUploads'), value: stats.total,      color: 'text-brand-700',  bg: 'bg-brand-50' },
                { label: t('dashboard.processing'),   value: stats.processing,  color: 'text-blue-700',   bg: 'bg-blue-50' },
                { label: t('dashboard.completed'),    value: stats.completed,   color: 'text-green-700',  bg: 'bg-green-50' },
                { label: t('dashboard.failed'),       value: stats.failed,      color: 'text-red-700',    bg: 'bg-red-50' },
              ].map(s => (
                <div key={s.label} className={`rounded-2xl p-5 ${s.bg}`}>
                  <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-sm text-gray-600 mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Recent uploads */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">{t('dashboard.recentUploads')}</h3>
                <button onClick={() => setTab('uploads')} className="text-sm text-brand-600 hover:underline">View all →</button>
              </div>
              {uploads.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-400 mb-4">{t('dashboard.noUploads')}</p>
                  <button onClick={() => setTab('newUpload')} className="text-brand-600 font-medium hover:underline">{t('dashboard.uploadNow')}</button>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {uploads.slice(0, 5).map(u => (
                    <UploadRow key={u.id} upload={u} isZh={isZh} t={t} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Uploads tab ── */}
        {tab === 'uploads' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">{t('nav.uploads')} ({uploads.length})</h3>
            </div>
            {uploads.length === 0 ? (
              <div className="text-center py-12 text-gray-400">{t('dashboard.noUploads')}</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {uploads.map(u => <UploadRow key={u.id} upload={u} isZh={isZh} t={t} />)}
              </div>
            )}
          </div>
        )}

        {/* ── New Upload tab ── */}
        {tab === 'newUpload' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-800 mb-5">{t('upload.title')}</h3>
            <UploadZone onUploadsStarted={() => setTab('uploads')} />
          </div>
        )}
      </div>

      {/* Persistent upload tray */}
      <UploadTray />
    </div>
  )
}

function UploadRow({ upload, isZh, t }) {
  const mainCat = upload.main_categories
  const subCat  = upload.sub_categories
  const nameKey = isZh ? 'name_zh' : 'name_en'
  const typeIcon = upload.file_type === 'video' ? '🎬' : upload.file_type === 'image' ? '🖼️' : '📄'

  return (
    <div className="px-6 py-4 flex items-center gap-4">
      <span className="text-2xl">{typeIcon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-700 truncate">{upload.original_filename}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {mainCat?.[nameKey] || '—'}
          {subCat?.[nameKey] ? ` › ${subCat[nameKey]}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
          upload.processing_status === 'completed' ? 'bg-green-100 text-green-700' :
          upload.processing_status === 'processing' ? 'bg-blue-100 text-blue-700' :
          upload.processing_status === 'failed' ? 'bg-red-100 text-red-600' :
          'bg-gray-100 text-gray-500'
        }`}>
          {t(`upload.${upload.processing_status}`) || upload.processing_status}
        </span>
        <p className="text-xs text-gray-400 mt-1">
          {new Date(upload.created_at).toLocaleDateString()}
        </p>
      </div>
    </div>
  )
}
