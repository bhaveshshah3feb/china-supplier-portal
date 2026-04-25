import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../../lib/supabase'

export default function LogsTab() {
  const { t } = useTranslation()
  const [logs, setLogs]     = useState([])
  const [page, setPage]     = useState(0)
  const [loading, setLoading] = useState(true)
  const PAGE_SIZE = 50

  useEffect(() => { load() }, [page])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('admin_logs')
      .select('*, admins(name, email)')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    setLogs(data || [])
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400">{t('common.loading')}</div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-gray-400">{t('admin.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Admin','Action','Target','IP','Time'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{l.admins?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full font-mono">{l.action}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{l.target_id?.slice(0, 8) || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{l.ip_address || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-gray-100 flex justify-between items-center">
          <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}
            className="text-sm text-gray-500 disabled:opacity-30 hover:text-gray-800">← Previous</button>
          <span className="text-sm text-gray-400">Page {page + 1}</span>
          <button onClick={() => setPage(p => p+1)} disabled={logs.length < PAGE_SIZE}
            className="text-sm text-gray-500 disabled:opacity-30 hover:text-gray-800">Next →</button>
        </div>
      </div>
    </div>
  )
}
