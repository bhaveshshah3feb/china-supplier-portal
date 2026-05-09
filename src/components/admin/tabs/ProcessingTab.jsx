import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../../lib/supabase'

const MAX_ATTEMPTS = 3

const STATUS_BADGE = {
  pending:    'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-600',
}

export default function ProcessingTab() {
  const { t } = useTranslation()
  const [jobs, setJobs]         = useState([])
  const [filter, setFilter]     = useState('pending')
  const [loading, setLoading]   = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState(null)
  const [expandedError, setExpandedError] = useState(null)

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    let q = supabase.from('processing_queue')
      .select(`*, uploads(original_filename, file_type, suppliers(company_name_en, supplier_code))`)
      .order('created_at', { ascending: false })
      .limit(200)
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setJobs(data || [])
    setLoading(false)
  }

  async function triggerProcessing() {
    setTriggering(true)
    setTriggerMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/trigger-processing', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const body = await res.json()
      if (body.ok) {
        setTriggerMsg({ type: 'ok', text: 'GitHub Actions triggered — check back in ~60 seconds.' })
      } else {
        setTriggerMsg({ type: 'err', text: body.error || 'Failed to trigger' })
      }
    } catch {
      setTriggerMsg({ type: 'err', text: 'Could not reach server' })
    } finally {
      setTriggering(false)
      setTimeout(() => setTriggerMsg(null), 8000)
    }
  }

  async function retryJob(job) {
    // Reset this job to pending
    await supabase.from('processing_queue')
      .update({ status: 'pending', attempts: 0, error_log: null, started_at: null })
      .eq('id', job.id)
    // Also reset the parent upload so the UI shows pending
    if (job.upload_id) {
      await supabase.from('uploads')
        .update({ processing_status: 'pending' })
        .eq('id', job.upload_id)
    }
    setJobs(prev => prev.map(j =>
      j.id === job.id ? { ...j, status: 'pending', attempts: 0, error_log: null, started_at: null } : j
    ))
    // Fire GitHub Actions so it picks up immediately
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/trigger-processing', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      setTriggerMsg({ type: 'ok', text: 'Job reset and GitHub Actions triggered.' })
      setTimeout(() => setTriggerMsg(null), 6000)
    } catch {}
  }

  async function retryAllFailed() {
    const failed = jobs.filter(j => j.status === 'failed')
    if (!failed.length) return
    const ids = failed.map(j => j.id)
    const uploadIds = [...new Set(failed.map(j => j.upload_id).filter(Boolean))]
    await supabase.from('processing_queue')
      .update({ status: 'pending', attempts: 0, error_log: null, started_at: null })
      .in('id', ids)
    if (uploadIds.length) {
      await supabase.from('uploads')
        .update({ processing_status: 'pending' })
        .in('id', uploadIds)
    }
    setJobs(prev => prev.map(j =>
      ids.includes(j.id) ? { ...j, status: 'pending', attempts: 0, error_log: null } : j
    ))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/trigger-processing', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
    } catch {}
    setTriggerMsg({ type: 'ok', text: `${failed.length} failed job(s) reset and GitHub Actions triggered.` })
    setTimeout(() => setTriggerMsg(null), 6000)
  }

  const pendingCount = jobs.filter(j => j.status === 'pending').length
  const failedCount  = jobs.filter(j => j.status === 'failed').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {/* Status filters */}
        <div className="flex gap-1">
          {['all','pending','processing','failed','completed'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors
                ${filter === s ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 text-gray-600 hover:border-gray-500'}`}
            >
              {s}
            </button>
          ))}
        </div>

        <button onClick={load}
          className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-full text-sm hover:bg-gray-50 transition-colors">
          ↻ Refresh
        </button>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {failedCount > 0 && filter !== 'completed' && (
            <button onClick={retryAllFailed}
              className="text-sm bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 transition-colors font-medium">
              ↺ Retry All Failed ({failedCount})
            </button>
          )}
          <button onClick={triggerProcessing} disabled={triggering}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            {triggering ? '⏳ Triggering…' : `▶ Process Now${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`}
          </button>
        </div>
      </div>

      {triggerMsg && (
        <div className={`text-sm px-4 py-2.5 rounded-xl border ${
          triggerMsg.type === 'ok'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-600 border-red-200'
        }`}>
          {triggerMsg.type === 'ok' ? '✓ ' : '✗ '}{triggerMsg.text}
        </div>
      )}

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
                  {['File','Supplier','Job','Status','Tries','Error','Created',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobs.map(j => (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 max-w-40">
                      <p className="text-gray-700 truncate">{j.uploads?.original_filename}</p>
                      <p className="text-xs text-gray-400 capitalize">{j.uploads?.file_type}</p>
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
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      <span className={j.attempts >= MAX_ATTEMPTS ? 'text-red-500 font-medium' : ''}>
                        {j.attempts}/{MAX_ATTEMPTS}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-52">
                      {j.error_log && (
                        <div>
                          <p
                            className="text-xs text-red-500 cursor-pointer hover:text-red-700 line-clamp-2"
                            title="Click to expand"
                            onClick={() => setExpandedError(expandedError === j.id ? null : j.id)}
                          >
                            {j.error_log.slice(0, 120)}{j.error_log.length > 120 ? '…' : ''}
                          </p>
                          {expandedError === j.id && (
                            <pre className="mt-1 text-[10px] text-red-600 bg-red-50 rounded p-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                              {j.error_log}
                            </pre>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(j.created_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short',
                        hour: '2-digit', minute: '2-digit', hour12: true,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {(j.status === 'failed' || j.status === 'pending') && (
                        <button onClick={() => retryJob(j)}
                          className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-lg transition-colors whitespace-nowrap">
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
