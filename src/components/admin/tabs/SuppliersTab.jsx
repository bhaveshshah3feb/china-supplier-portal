import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../../lib/supabase'

const STATUS_BADGE = {
  pending:   'bg-yellow-100 text-yellow-700',
  active:    'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
}

function timeAgo(dateStr) {
  const m = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (m < 60)    return `${m}m ago`
  if (m < 1440)  return `${Math.floor(m / 60)}h ago`
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export default function SuppliersTab() {
  const { t } = useTranslation()
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all')
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState(null)  // expanded supplier id

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('suppliers')
      .select('*, uploads(count)')
      .order('status', { ascending: true })   // pending first
      .order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setSuppliers(data || [])
    setLoading(false)
  }

  async function changeStatus(id, status) {
    await supabase.from('suppliers').update({ status }).eq('id', id)
    await logAction(`supplier_${status}`, 'supplier', id, { status })
    setSuppliers(prev => prev.map(s => s.id === id ? { ...s, status } : s))
  }

  async function logAction(action, targetType, targetId, details) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('admin_logs').insert({ admin_id: user.id, action, target_type: targetType, target_id: targetId, details })
  }

  const filtered = suppliers.filter(s =>
    s.company_name_en?.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase()) ||
    s.supplier_code?.toLowerCase().includes(search.toLowerCase())
  )

  const pending = filtered.filter(s => s.status === 'pending')
  const others  = filtered.filter(s => s.status !== 'pending')

  return (
    <div className="space-y-5">

      {/* ── Pending Approvals Banner ── */}
      {pending.length > 0 && filter === 'all' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-3 border-b border-amber-200">
            <span className="text-xl">⏳</span>
            <div>
              <p className="font-semibold text-amber-800">
                {pending.length} supplier{pending.length > 1 ? 's' : ''} waiting for approval
              </p>
              <p className="text-xs text-amber-600">Activate their accounts to let them start uploading files.</p>
            </div>
          </div>
          <div className="divide-y divide-amber-100">
            {pending.map(s => (
              <div key={s.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center font-bold text-amber-800 text-sm">
                    {s.company_name_en?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">{s.company_name_en}</p>
                    {s.company_name_zh && <p className="text-xs text-gray-400">{s.company_name_zh}</p>}
                    <p className="text-xs text-gray-500">{s.email} · {s.phone || 'No phone'} · joined {timeAgo(s.created_at)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => changeStatus(s.id, 'active')}
                    className="bg-green-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-green-700 transition-colors font-medium">
                    ✓ Activate
                  </button>
                  <button onClick={() => changeStatus(s.id, 'suspended')}
                    className="bg-gray-100 text-gray-600 text-sm px-4 py-1.5 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors">
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.search')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:ring-2 focus:ring-red-500 outline-none"
        />
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {['all', 'pending', 'active', 'suspended'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors capitalize
                ${filter === s ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
              {s === 'all' ? 'All' : t(`admin.${s}`)}
              {s === 'pending' && pending.length > 0 && filter !== 'pending' && (
                <span className="ml-1 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{pending.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400">{t('admin.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Code', 'Company', 'Contact', 'Uploads', 'Status', 'Joined', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(filter === 'all' ? others : filtered).map(s => (
                  <>
                    <tr key={s.id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.supplier_code}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{s.company_name_en}</p>
                        {s.company_name_zh && <p className="text-xs text-gray-400">{s.company_name_zh}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-600 text-xs">{s.email}</p>
                        {s.phone && <p className="text-gray-400 text-xs">{s.phone}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-center">{s.uploads?.[0]?.count ?? 0}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[s.status]}`}>
                          {t(`admin.${s.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{timeAgo(s.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {s.status !== 'active' && (
                            <button onClick={() => changeStatus(s.id, 'active')}
                              className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2 py-1 rounded-lg transition-colors">
                              Activate
                            </button>
                          )}
                          {s.status !== 'suspended' && (
                            <button onClick={() => changeStatus(s.id, 'suspended')}
                              className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded-lg transition-colors">
                              Suspend
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded details row */}
                    {expanded === s.id && (
                      <tr key={`${s.id}-detail`} className="bg-blue-50">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-400 mb-0.5">Supplier ID</p>
                              <p className="font-mono text-xs text-gray-700 break-all">{s.id}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400 mb-0.5">Contact (EN)</p>
                              <p className="text-gray-700">{s.contact_person_en || '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400 mb-0.5">Contact (ZH)</p>
                              <p className="text-gray-700">{s.contact_person_zh || '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400 mb-0.5">Last Updated</p>
                              <p className="text-gray-700">{new Date(s.updated_at).toLocaleString()}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
