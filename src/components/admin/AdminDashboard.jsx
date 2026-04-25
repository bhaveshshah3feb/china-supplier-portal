import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import Header from '../common/Header'
import SuppliersTab   from './tabs/SuppliersTab'
import UploadsTab     from './tabs/UploadsTab'
import ProcessingTab  from './tabs/ProcessingTab'
import CategoriesTab  from './tabs/CategoriesTab'
import LogsTab        from './tabs/LogsTab'

const TABS = ['overview', 'suppliers', 'uploads', 'processing', 'categories', 'logs']

export default function AdminDashboard() {
  const { t } = useTranslation()
  const [tab, setTab]     = useState('overview')
  const [stats, setStats] = useState(null)

  useEffect(() => {
    async function loadStats() {
      const [
        { count: totalSuppliers },
        { count: activeSuppliers },
        { count: pendingSuppliers },
        { count: totalUploads },
        { count: pendingJobs },
        { data: storageData },
      ] = await Promise.all([
        supabase.from('suppliers').select('id', { count: 'exact', head: true }),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('uploads').select('id', { count: 'exact', head: true }),
        supabase.from('processing_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('uploads').select('file_size').eq('upload_status', 'completed'),
      ])
      const totalBytes = (storageData || []).reduce((s, u) => s + (u.file_size || 0), 0)
      setStats({ totalSuppliers, activeSuppliers, pendingSuppliers, totalUploads, pendingJobs, totalBytes })
    }
    loadStats()
  }, [tab])

  function fmtBytes(b) {
    if (!b) return '0 MB'
    if (b < 1024**3) return `${(b/1024**2).toFixed(1)} MB`
    return `${(b/1024**3).toFixed(2)} GB`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header role="admin" />

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4">
        <nav className="flex gap-1 max-w-7xl mx-auto overflow-x-auto">
          {TABS.map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors
                ${tab === k ? 'border-red-600 text-red-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {t(`admin.${k}`)}
            </button>
          ))}
        </nav>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ── Overview ── */}
        {tab === 'overview' && stats && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-800">{t('admin.dashboard')}</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: t('admin.totalSuppliers'), value: stats.totalSuppliers, sub: `${stats.activeSuppliers} active · ${stats.pendingSuppliers} pending`, color: 'bg-brand-50 text-brand-700' },
                { label: t('admin.totalUploads'),   value: stats.totalUploads,   sub: 'across all suppliers',        color: 'bg-purple-50 text-purple-700' },
                { label: t('admin.storageUsed'),    value: fmtBytes(stats.totalBytes), sub: 'completed uploads',    color: 'bg-green-50 text-green-700' },
                { label: t('admin.pendingJobs'),    value: stats.pendingJobs,    sub: 'in processing queue',         color: 'bg-orange-50 text-orange-700' },
              ].map(s => (
                <div key={s.label} className={`rounded-2xl p-6 ${s.color.split(' ')[0]}`}>
                  <p className={`text-3xl font-bold ${s.color.split(' ')[1]}`}>{s.value}</p>
                  <p className="text-sm font-medium text-gray-700 mt-1">{s.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
                </div>
              ))}
            </div>

            {stats.pendingSuppliers > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-yellow-800">{stats.pendingSuppliers} supplier{stats.pendingSuppliers > 1 ? 's' : ''} waiting for approval</p>
                  <p className="text-sm text-yellow-600">Review and activate them to allow uploads.</p>
                </div>
                <button onClick={() => setTab('suppliers')} className="text-sm bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700">
                  Review →
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'suppliers'   && <SuppliersTab />}
        {tab === 'uploads'     && <UploadsTab />}
        {tab === 'processing'  && <ProcessingTab />}
        {tab === 'categories'  && <CategoriesTab />}
        {tab === 'logs'        && <LogsTab />}
      </div>
    </div>
  )
}
