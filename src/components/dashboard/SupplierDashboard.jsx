import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase, getSalesUrl } from '../../lib/supabase'
import Header from '../common/Header'
import UploadZone from '../upload/UploadZone'
import UploadTray from '../upload/UploadTray'

const PROC_COLOR = {
  pending:    { bg: 'bg-gray-100',   text: 'text-gray-500',  label: 'Pending' },
  processing: { bg: 'bg-blue-100',   text: 'text-blue-700',  label: 'Processing' },
  completed:  { bg: 'bg-green-100',  text: 'text-green-700', label: 'Ready' },
  failed:     { bg: 'bg-red-100',    text: 'text-red-600',   label: 'Failed' },
  skipped:    { bg: 'bg-gray-100',   text: 'text-gray-400',  label: 'Skipped' },
  uploading:  { bg: 'bg-yellow-100', text: 'text-yellow-700',label: 'Uploading' },
}

function fmtBytes(b) {
  if (!b) return '—'
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3)   return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)    return 'just now'
  if (m < 60)   return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

export default function SupplierDashboard() {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language?.startsWith('zh')
  const nameKey = isZh ? 'name_zh' : 'name_en'

  const [supplier, setSupplier]   = useState(null)
  const [uploads,  setUploads]    = useState([])
  const [tab,      setTab]        = useState('upload')
  const [loading,  setLoading]    = useState(true)
  const [loadErr,  setLoadErr]    = useState(null)

  useEffect(() => {
    load()
    // Realtime: UPDATE refreshes status on existing rows, INSERT adds new uploads
    const ch = supabase.channel('supplier_uploads')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'uploads' },
        p => setUploads(prev => prev.map(u => u.id === p.new.id ? { ...u, ...p.new } : u))
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'uploads' },
        () => load()   // re-fetch so we get joined category data too
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function load() {
    setLoadErr(null)
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser()
      if (authErr || !user) throw new Error('Not authenticated — ' + (authErr?.message || 'session expired'))

      const [{ data: sup, error: supErr }, { data: ups, error: upsErr }] = await Promise.all([
        supabase.from('suppliers').select('*').eq('id', user.id).single(),
        supabase.from('uploads')
          .select('*, main_categories!main_category_id(name_en,name_zh), sub_categories!sub_category_id(name_en,name_zh)')
          .eq('supplier_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      if (upsErr) throw new Error('Could not load uploads: ' + upsErr.message)

      setSupplier(sup)
      setUploads(ups || [])
    } catch (e) {
      console.error('load() failed:', e)
      setLoadErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const stats = {
    total:      uploads.length,
    uploading:  uploads.filter(u => u.upload_status === 'uploading').length,
    processing: uploads.filter(u => ['pending','processing'].includes(u.processing_status) && u.upload_status === 'completed').length,
    ready:      uploads.filter(u => u.processing_status === 'completed').length,
    failed:     uploads.filter(u => u.processing_status === 'failed').length,
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header role="supplier" />

      {/* Sub-nav */}
      <div className="bg-white border-b border-gray-200 px-4">
        <nav className="flex gap-0 max-w-5xl mx-auto">
          {[
            { key: 'upload',  icon: '⬆️', label: isZh ? '上传文件' : 'Upload Files' },
            { key: 'uploads', icon: '📁', label: isZh ? `我的上传${stats.total ? ` (${stats.total})` : ''}` : `My Uploads${stats.total ? ` (${stats.total})` : ''}` },
            { key: 'account', icon: '👤', label: isZh ? '账户信息' : 'Account' },
          ].map(({ key, icon, label }) => (
            <button key={key} onClick={() => { setTab(key); if (key === 'uploads') load() }}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              <span>{icon}</span> {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 space-y-5">

        {/* ── Upload Tab ── */}
        {tab === 'upload' && (
          <div className="space-y-5">
            {/* Welcome banner */}
            <div className="bg-gradient-to-r from-brand-700 to-brand-500 rounded-2xl p-5 text-white flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t('dashboard.welcome')}, {supplier?.company_name_en}</h2>
                <p className="text-brand-100 text-sm mt-0.5">{isZh ? '请上传您的产品目录、视频和价格表' : 'Upload your product catalogs, videos and pricelists below'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-brand-200">{isZh ? '供应商编码' : 'Supplier Code'}</p>
                <p className="font-mono font-bold text-lg">{supplier?.supplier_code}</p>
              </div>
            </div>

            {/* Stats row */}
            {stats.total > 0 && (
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: isZh ? '总文件' : 'Total', value: stats.total, color: 'text-gray-700' },
                  { label: isZh ? '处理中' : 'Processing', value: stats.processing, color: 'text-blue-600' },
                  { label: isZh ? '已完成' : 'Ready', value: stats.ready, color: 'text-green-600' },
                  { label: isZh ? '失败' : 'Failed', value: stats.failed, color: 'text-red-500' },
                ].map(s => (
                  <div key={s.label} className="bg-white rounded-xl p-3 text-center border border-gray-100">
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Upload zone */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-800 mb-4">
                {isZh ? '📤 上传新文件' : '📤 Upload New Files'}
              </h3>
              <UploadZone onUploadsStarted={() => setTab('uploads')} />
            </div>

            {/* How it works */}
            <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
              <h4 className="font-semibold text-blue-900 mb-3">{isZh ? '上传流程说明' : 'How it works'}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {[
                  { icon: '📤', step: isZh ? '您上传文件' : 'You upload files' },
                  { icon: '🤖', step: isZh ? 'AI自动分类' : 'AI auto-categorizes' },
                  { icon: '🎨', step: isZh ? '添加品牌水印' : 'Branding applied' },
                  { icon: '✅', step: isZh ? '文件准备就绪' : 'Files ready for sales' },
                ].map(({ icon, step }, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-blue-700">
                    <span className="text-lg">{icon}</span>
                    <span>{step}</span>
                    {i < 3 && <span className="text-blue-300 hidden sm:block">→</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── My Uploads Tab ── */}
        {tab === 'uploads' && (
          <div className="space-y-4">
            {loadErr && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                ⚠️ {loadErr}
              </div>
            )}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">{isZh ? '我的上传记录' : 'My Uploads'} ({uploads.length})</h3>
              <div className="flex gap-2">
                <button onClick={load}
                  className="text-sm border border-gray-300 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                  🔄 {isZh ? '刷新' : 'Refresh'}
                </button>
                <button onClick={() => setTab('upload')}
                  className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">
                  + {isZh ? '上传更多' : 'Upload More'}
                </button>
              </div>
            </div>

            {uploads.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
                <div className="text-5xl mb-4">📂</div>
                <p className="text-gray-500 mb-4">{t('dashboard.noUploads')}</p>
                <button onClick={() => setTab('upload')}
                  className="text-brand-600 font-medium hover:underline">{t('dashboard.uploadNow')}</button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['', 'File', 'Category', 'Size', 'Status', 'Watermark', 'Uploaded'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {uploads.map(u => {
                        const p = PROC_COLOR[u.processing_status] || PROC_COLOR.pending
                        const typeIcon = u.file_type === 'video' ? '🎬' : u.file_type === 'image' ? '🖼️' : '📄'
                        return (
                          <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-xl">{typeIcon}</td>
                            <td className="px-4 py-3 max-w-48">
                              <p className="text-gray-800 font-medium truncate">{u.original_filename}</p>
                            </td>
                            <td className="px-4 py-3 text-gray-500">
                              <p>{u.main_categories?.[nameKey] || '—'}</p>
                              {u.sub_categories && <p className="text-xs text-gray-400">{u.sub_categories[nameKey]}</p>}
                            </td>
                            <td className="px-4 py-3 text-gray-400">{fmtBytes(u.file_size)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${p.bg} ${p.text}`}>{p.label}</span>
                            </td>
                            <td className="px-4 py-3">
                              {u.processing_status === 'completed'
                                ? <span className="text-xs text-green-600 font-medium">✅ Applied</span>
                                : <span className="text-xs text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{timeAgo(u.created_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Account Tab ── */}
        {tab === 'account' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5 max-w-lg">
            <h3 className="font-semibold text-gray-800">{isZh ? '账户信息' : 'Account Information'}</h3>
            <div className="space-y-3">
              {[
                { label: isZh ? '供应商编码' : 'Supplier Code', value: supplier?.supplier_code, mono: true },
                { label: isZh ? '公司名称（英文）' : 'Company (English)', value: supplier?.company_name_en },
                { label: isZh ? '公司名称（中文）' : 'Company (Chinese)', value: supplier?.company_name_zh },
                { label: isZh ? '电话' : 'Phone', value: supplier?.phone },
                { label: isZh ? '账户状态' : 'Account Status', value: supplier?.status },
              ].map(({ label, value, mono }) => (
                <div key={label} className="flex justify-between items-center py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-500">{label}</span>
                  <span className={`text-sm font-medium text-gray-800 ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              {isZh
                ? '如需修改账户信息，请联系管理员：+91 9841081945'
                : 'To update account details, contact admin: +91 9841081945'}
            </p>
          </div>
        )}

      </div>

      <UploadTray />
    </div>
  )
}
