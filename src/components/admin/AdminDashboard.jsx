import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import Header from '../common/Header'
import SuppliersTab    from './tabs/SuppliersTab'
import UploadsTab      from './tabs/UploadsTab'
import ProcessingTab   from './tabs/ProcessingTab'
import CategoriesTab   from './tabs/CategoriesTab'
import LogsTab         from './tabs/LogsTab'
import SalesLibraryTab from './tabs/SalesLibraryTab'
import SettingsTab     from './tabs/SettingsTab'
import RenameTab      from './tabs/RenameTab'

const TABS = [
  { key: 'overview',     icon: '📊', label: 'Overview' },
  { key: 'library',      icon: '✅', label: 'Sales Library' },
  { key: 'rename',       icon: '✏️',  label: 'Rename / Edit' },
  { key: 'suppliers',    icon: '🏭', label: 'Suppliers' },
  { key: 'uploads',      icon: '📁', label: 'Uploads' },
  { key: 'processing',   icon: '⚙️',  label: 'Processing' },
  { key: 'categories',   icon: '🗂️',  label: 'Categories' },
  { key: 'logs',         icon: '📋', label: 'Logs' },
  { key: 'settings',     icon: '⚙',  label: 'Settings' },
]

function fmtBytes(b) {
  if (!b) return '0 MB'
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

export default function AdminDashboard() {
  const { t } = useTranslation()
  const [tab, setTab]           = useState('overview')
  const [stats, setStats]       = useState(null)
  const [recentUploads, setRecentUploads] = useState([])
  const [loadingStats, setLoadingStats]   = useState(true)

  useEffect(() => {
    if (tab === 'overview') loadStats()
  }, [tab])

  async function loadStats() {
    setLoadingStats(true)
    const [
      { count: totalSuppliers },
      { count: activeSuppliers },
      { count: pendingSuppliers },
      { count: totalUploads },
      { count: readyFiles },
      { count: pendingJobs },
      { count: failedJobs },
      { data: storageData },
      { data: recent },
    ] = await Promise.all([
      supabase.from('suppliers').select('id', { count: 'exact', head: true }),
      supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('uploads').select('id', { count: 'exact', head: true }),
      supabase.from('uploads').select('id', { count: 'exact', head: true }).eq('processing_status', 'completed').not('sales_path', 'is', null),
      supabase.from('processing_queue').select('id', { count: 'exact', head: true }).in('status', ['pending', 'processing']),
      supabase.from('processing_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      supabase.from('uploads').select('file_size').eq('upload_status', 'completed'),
      supabase.from('uploads')
        .select('id, original_filename, file_type, processing_status, created_at, suppliers(company_name_en, supplier_code)')
        .order('created_at', { ascending: false })
        .limit(8),
    ])
    const totalBytes = (storageData || []).reduce((s, u) => s + (u.file_size || 0), 0)
    setStats({ totalSuppliers, activeSuppliers, pendingSuppliers, totalUploads, readyFiles, pendingJobs, failedJobs, totalBytes })
    setRecentUploads(recent || [])
    setLoadingStats(false)
  }

  const PROC_COLOR = {
    pending:    'text-gray-400',
    processing: 'text-blue-500',
    completed:  'text-green-600',
    failed:     'text-red-500',
    skipped:    'text-gray-300',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header role="admin" />

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4">
        <nav className="flex gap-0 max-w-7xl mx-auto overflow-x-auto">
          {TABS.map(({ key, icon, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors
                ${tab === key ? 'border-red-600 text-red-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              <span>{icon}</span>
              <span>{label}</span>
              {key === 'library' && stats?.readyFiles > 0 && (
                <span className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium">{stats.readyFiles}</span>
              )}
              {key === 'suppliers' && stats?.pendingSuppliers > 0 && (
                <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium">{stats.pendingSuppliers}</span>
              )}
              {key === 'processing' && stats?.pendingJobs > 0 && (
                <span className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium">{stats.pendingJobs}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ── Overview ── */}
        {tab === 'overview' && (
          <div className="space-y-6">

            {loadingStats ? (
              <div className="flex items-center gap-2 text-gray-400">
                <div className="w-5 h-5 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin" />
                Loading dashboard…
              </div>
            ) : stats && (
              <>
                {/* ── Action alerts ── */}
                <div className="space-y-3">
                  {stats.pendingSuppliers > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">⏳</span>
                        <div>
                          <p className="font-semibold text-amber-800">
                            {stats.pendingSuppliers} supplier{stats.pendingSuppliers > 1 ? 's' : ''} waiting for approval
                          </p>
                          <p className="text-sm text-amber-600">Activate their accounts to let them start uploading.</p>
                        </div>
                      </div>
                      <button onClick={() => setTab('suppliers')}
                        className="shrink-0 bg-amber-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors font-medium">
                        Review Suppliers →
                      </button>
                    </div>
                  )}

                  {stats.failedJobs > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">❌</span>
                        <div>
                          <p className="font-semibold text-red-800">{stats.failedJobs} processing job{stats.failedJobs > 1 ? 's' : ''} failed</p>
                          <p className="text-sm text-red-600">Check the processing queue and retry failed jobs.</p>
                        </div>
                      </div>
                      <button onClick={() => setTab('processing')}
                        className="shrink-0 bg-red-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-red-700 transition-colors font-medium">
                        View Queue →
                      </button>
                    </div>
                  )}

                  {stats.pendingJobs > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-center gap-3">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-blue-700 rounded-full animate-spin" />
                      <p className="text-blue-800 text-sm font-medium">
                        {stats.pendingJobs} file{stats.pendingJobs > 1 ? 's' : ''} currently being processed (AI categorization + watermarking)
                      </p>
                    </div>
                  )}
                </div>

                {/* ── Metric cards ── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    {
                      label: 'Suppliers',
                      value: stats.totalSuppliers,
                      sub: `${stats.activeSuppliers} active · ${stats.pendingSuppliers} pending`,
                      bg: 'bg-indigo-50', color: 'text-indigo-700',
                      action: () => setTab('suppliers'),
                    },
                    {
                      label: 'Total Uploads',
                      value: stats.totalUploads,
                      sub: 'across all suppliers',
                      bg: 'bg-purple-50', color: 'text-purple-700',
                      action: () => setTab('uploads'),
                    },
                    {
                      label: 'Ready in Library',
                      value: stats.readyFiles,
                      sub: 'watermarked & categorized',
                      bg: 'bg-green-50', color: 'text-green-700',
                      action: () => setTab('library'),
                    },
                    {
                      label: 'Storage Used',
                      value: fmtBytes(stats.totalBytes),
                      sub: 'in upload bucket',
                      bg: 'bg-orange-50', color: 'text-orange-700',
                      action: null,
                    },
                  ].map(s => (
                    <div key={s.label}
                      className={`rounded-2xl p-5 ${s.bg} ${s.action ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                      onClick={s.action || undefined}>
                      <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-sm font-semibold text-gray-700 mt-1">{s.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
                      {s.action && <p className={`text-xs mt-2 font-medium ${s.color}`}>View →</p>}
                    </div>
                  ))}
                </div>

                {/* ── Quick links ── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { icon: '✅', label: 'Browse Sales Library', desc: 'View watermarked files', tab: 'library', color: 'border-green-200 hover:border-green-400' },
                    { icon: '🏭', label: 'Manage Suppliers', desc: 'Approve, suspend, view', tab: 'suppliers', color: 'border-indigo-200 hover:border-indigo-400' },
                    { icon: '⚙️', label: 'Processing Queue', desc: 'Monitor AI jobs', tab: 'processing', color: 'border-blue-200 hover:border-blue-400' },
                    { icon: '🗂️', label: 'Categories', desc: 'Manage & approve suggestions', tab: 'categories', color: 'border-orange-200 hover:border-orange-400' },
                  ].map(q => (
                    <button key={q.tab} onClick={() => setTab(q.tab)}
                      className={`text-left bg-white rounded-xl border-2 p-4 transition-colors ${q.color}`}>
                      <div className="text-2xl mb-2">{q.icon}</div>
                      <p className="font-semibold text-gray-800 text-sm">{q.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{q.desc}</p>
                    </button>
                  ))}
                </div>

                {/* ── Recent uploads ── */}
                {recentUploads.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                      <h3 className="font-semibold text-gray-800">Recent Uploads</h3>
                      <button onClick={() => setTab('uploads')} className="text-sm text-red-600 hover:underline">View all →</button>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {recentUploads.map(u => {
                        const typeIcon = u.file_type === 'video' ? '🎬' : u.file_type === 'image' ? '🖼️' : '📄'
                        return (
                          <div key={u.id} className="flex items-center justify-between px-5 py-2.5 hover:bg-gray-50">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-lg shrink-0">{typeIcon}</span>
                              <div className="min-w-0">
                                <p className="text-sm text-gray-800 truncate">{u.original_filename}</p>
                                <p className="text-xs text-gray-400">{u.suppliers?.company_name_en} · {u.suppliers?.supplier_code}</p>
                              </div>
                            </div>
                            <span className={`text-xs font-medium shrink-0 ml-4 ${PROC_COLOR[u.processing_status]}`}>
                              {u.processing_status}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'library'    && <SalesLibraryTab />}
        {tab === 'rename'     && <RenameTab />}
        {tab === 'suppliers'  && <SuppliersTab />}
        {tab === 'uploads'    && <UploadsTab />}
        {tab === 'processing' && <ProcessingTab />}
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'logs'       && <LogsTab />}
        {tab === 'settings'   && <SettingsTab />}

      </div>
    </div>
  )
}
