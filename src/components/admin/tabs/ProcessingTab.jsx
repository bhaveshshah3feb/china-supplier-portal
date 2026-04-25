import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../../lib/supabase'

const STATUS_BADGE = {
  pending:    'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-600',
}

export default function ProcessingTab() {
  const { t } = useTranslation()
  const [jobs, setJobs]   = useState([])
  const [filter, setFilter] = useState('pending')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    let q = supabase.from('processing_queue')
      .select(`*, uploads(original_filename, file_type, suppliers(company_name_en, supplier_code))`)
      .order('created_at', { ascending: false })
      .limit(100)
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setJobs(data || [])
    setLoading(false)
  }

  async function retryJob(id) {
    await supabase.from('processing_queue').update({ status: 'pending', attempts: 0, error_log: null }).eq('id', id)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'pending', attempts: 0, error_log: null } : j))
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {['all','pending','processing','failed','completed'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-sm px-4 py-1.5 rounded-full border transition-colors
              ${filter === s ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 text-gray-600 hover:border-gray-500'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400">{t('common.loading')}</div>
        ) : jobs.length === 0 ? (
          <div className="py-12 text-center text-gray-400">{t('admin.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['File','Supplier','Job Type','Status','Attempts','Error','Created',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobs.map(j => (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 max-w-40">
                      <p className="text-gray-700 truncate">{j.uploads?.original_filename}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700">{j.uploads?.suppliers?.company_name_en}</p>
                      <p className="text-xs font-mono text-gray-400">{j.uploads?.suppliers?.supplier_code}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{j.job_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[j.status]}`}>{j.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{j.attempts}/{j.max_attempts}</td>
                    <td className="px-4 py-3 max-w-48">
                      {j.error_log && <p className="text-xs text-red-500 truncate" title={j.error_log}>{j.error_log}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(j.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {(j.status === 'failed' || j.status === 'pending') && (
                        <button onClick={() => retryJob(j.id)}
                          className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-lg transition-colors">
                          {t('admin.retry')}
                        </button>
                      )}
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
