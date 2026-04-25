import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../../lib/supabase'

const STATUS_BADGE = {
  pending:   'bg-yellow-100 text-yellow-700',
  active:    'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
}

export default function SuppliersTab() {
  const { t } = useTranslation()
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all')
  const [loading, setLoading]     = useState(true)

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    let q = supabase.from('suppliers').select('*, uploads(count)').order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setSuppliers(data || [])
    setLoading(false)
  }

  async function changeStatus(id, status) {
    await supabase.from('suppliers').update({ status }).eq('id', id)
    await logAction(`supplier_status_${status}`, 'supplier', id, { status })
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

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.search')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:ring-2 focus:ring-red-500 outline-none"
        />
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
        >
          {['all','pending','active','suspended'].map(s => (
            <option key={s} value={s}>{t(`admin.${s}`)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
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
                  {['Code','Company','Email','Phone','Uploads','Status','Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.supplier_code}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{s.company_name_en}</p>
                      {s.company_name_zh && <p className="text-xs text-gray-400">{s.company_name_zh}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.email}</td>
                    <td className="px-4 py-3 text-gray-600">{s.phone || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.uploads?.[0]?.count ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[s.status]}`}>
                        {t(`admin.${s.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {s.status !== 'active' && (
                          <button onClick={() => changeStatus(s.id, 'active')}
                            className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2 py-1 rounded-lg transition-colors">
                            {t('admin.activate')}
                          </button>
                        )}
                        {s.status !== 'suspended' && (
                          <button onClick={() => changeStatus(s.id, 'suspended')}
                            className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded-lg transition-colors">
                            {t('admin.suspend')}
                          </button>
                        )}
                        {s.status !== 'pending' && (
                          <button onClick={() => changeStatus(s.id, 'pending')}
                            className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors">
                            Pending
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
