import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

const STATUS_COLOR = {
  pending:    'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-600',
  skipped:    'bg-gray-100 text-gray-400',
}

const JOB_COLOR = {
  categorize: 'bg-purple-100 text-purple-700',
  watermark:  'bg-indigo-100 text-indigo-700',
}

function fmtDt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

function ErrorCell({ log }) {
  const [open, setOpen] = useState(false)
  if (!log) return <span className="text-gray-300 text-xs">—</span>
  const preview = log.slice(0, 80)
  return (
    <div className="max-w-xs">
      <p className="text-xs text-red-500 font-mono">{preview}{log.length > 80 && !open ? '…' : ''}</p>
      {log.length > 80 && (
        <button onClick={() => setOpen(v => !v)}
          className="text-[10px] text-red-400 hover:text-red-600 mt-0.5">
          {open ? 'Show less ▲' : 'Full error ▼'}
        </button>
      )}
      {open && (
        <pre className="text-[10px] text-red-500 whitespace-pre-wrap mt-1 max-h-40 overflow-y-auto bg-red-50 rounded p-2 leading-relaxed">
          {log}
        </pre>
      )}
    </div>
  )
}

export default function LogsTab() {
  const [jobs, setJobs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('all')   // all | failed | completed | pending
  const [typeFilter, setType]   = useState('all')   // all | video | image | document
  const PAGE = 100

  useEffect(() => { load() }, [filter, typeFilter])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('processing_queue')
      .select(`
        id, job_type, status, attempts, error_log,
        created_at, started_at, completed_at,
        uploads(
          id, original_filename, file_type, file_size, created_at,
          suppliers(company_name_en, supplier_code)
        )
      `)
      .order('created_at', { ascending: false })
      .limit(PAGE)

    if (filter !== 'all')     q = q.eq('status', filter)
    if (typeFilter !== 'all') q = q.eq('uploads.file_type', typeFilter)

    const { data, error } = await q
    if (error) console.error(error)
    setJobs((data || []).filter(j => typeFilter === 'all' || j.uploads?.file_type === typeFilter))
    setLoading(false)
  }

  async function retryJob(id) {
    await supabase.from('processing_queue')
      .update({ status: 'pending', attempts: 0, error_log: null })
      .eq('id', id)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'pending', attempts: 0, error_log: null } : j))
  }

  const failed = jobs.filter(j => j.status === 'failed').length

  return (
    <div className="space-y-4">

      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {['all','pending','processing','failed','completed'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors
                ${filter === s ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 text-gray-600 hover:border-gray-500'}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 ml-4">
          {['all','video','image','document','pricelist'].map(t => (
            <button key={t} onClick={() => setType(t)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors
                ${typeFilter === t ? 'bg-red-700 text-white border-red-700' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
              {t === 'all' ? 'All Types' : t}
            </button>
          ))}
        </div>
        <button onClick={load}
          className="ml-auto border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">
          ↻ Refresh
        </button>
      </div>

      {failed > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          ❌ <strong>{failed}</strong> failed job{failed > 1 ? 's' : ''} — click Retry on each row, or use "Process Now" in the Uploads tab to re-queue automatically.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400">Loading processing log…</div>
        ) : jobs.length === 0 ? (
          <div className="py-12 text-center text-gray-400">No processing events match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['File', 'Supplier', 'Type', 'Job', 'Status', 'Attempts', 'Uploaded At', 'Queued At', 'Error', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobs.map(j => (
                  <tr key={j.id} className={`hover:bg-gray-50 ${j.status === 'failed' ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3 max-w-44">
                      <p className="text-gray-800 text-sm truncate font-medium">{j.uploads?.original_filename || '—'}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-gray-700 text-sm">{j.uploads?.suppliers?.company_name_en || '—'}</p>
                      <p className="text-xs font-mono text-gray-400">{j.uploads?.suppliers?.supplier_code}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-sm capitalize whitespace-nowrap">
                      {j.uploads?.file_type === 'video' ? '🎬 video' : j.uploads?.file_type === 'image' ? '🖼️ image' : `📄 ${j.uploads?.file_type || '—'}`}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${JOB_COLOR[j.job_type] || 'bg-gray-100 text-gray-600'}`}>
                        {j.job_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[j.status] || 'bg-gray-100 text-gray-500'}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500 text-sm">
                      {j.attempts ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {fmtDt(j.uploads?.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {fmtDt(j.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <ErrorCell log={j.error_log} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {(j.status === 'failed' || j.status === 'pending') && (
                        <button onClick={() => retryJob(j.id)}
                          className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-lg transition-colors">
                          Retry
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
