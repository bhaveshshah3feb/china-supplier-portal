import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase, getUploadSignedUrl } from '../../../lib/supabase'

// ── Hover-to-play thumbnail (uploads bucket — needs signed URL) ──
function UploadThumb({ upload }) {
  const [hovered, setHovered]     = useState(false)
  const [signedUrl, setSignedUrl] = useState(null)
  const videoRef = useRef()
  const isVid = upload.file_type === 'video'
  const isImg = upload.file_type === 'image'

  async function handleMouseEnter() {
    setHovered(true)
    if ((isVid || isImg) && !signedUrl && upload.storage_path) {
      try { setSignedUrl(await getUploadSignedUrl(upload.storage_path)) } catch {}
    }
  }
  function handleMouseLeave() {
    setHovered(false)
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0 }
  }
  useEffect(() => {
    if (hovered && signedUrl && videoRef.current) videoRef.current.play().catch(() => {})
  }, [hovered, signedUrl])

  return (
    <div className="w-20 h-14 bg-gray-100 rounded-lg overflow-hidden relative cursor-default shrink-0"
      onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {isImg && signedUrl ? (
        <img src={signedUrl} alt="" className="w-full h-full object-cover" />
      ) : isVid && signedUrl ? (
        <>
          <video ref={videoRef} src={signedUrl} muted loop playsInline preload="none"
            className="w-full h-full object-cover" />
          {!hovered && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <span className="text-lg">▶</span>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xl">
          {upload.file_type === 'video' ? '🎬' : upload.file_type === 'image' ? '🖼️' : '📄'}
        </div>
      )}
    </div>
  )
}

const PROC_BADGE = {
  pending:    'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-600',
  skipped:    'bg-gray-100 text-gray-400',
}

function fmtBytes(b) {
  if (!b) return '—'
  if (b < 1024**2) return `${(b/1024).toFixed(0)} KB`
  if (b < 1024**3) return `${(b/1024**2).toFixed(1)} MB`
  return `${(b/1024**3).toFixed(2)} GB`
}

export default function UploadsTab() {
  const { t } = useTranslation()
  const [uploads, setUploads]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState({ type: 'all', status: 'all' })
  const [triggering, setTriggering]   = useState(false)
  const [triggerMsg, setTriggerMsg]   = useState(null) // { type: 'ok'|'err', text }

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    try {
      let q = supabase.from('uploads')
        .select(`*, suppliers(company_name_en, supplier_code), main_categories!main_category_id(name_en), sub_categories!sub_category_id(name_en)`)
        .order('created_at', { ascending: false })
        .limit(200)

      if (filter.type !== 'all')   q = q.eq('file_type', filter.type)
      if (filter.status !== 'all') q = q.eq('processing_status', filter.status)
      const { data, error } = await q
      if (error) throw new Error(`Database error: ${error.message}`)
      setUploads(data || [])
    } catch (err) {
      console.error('Load failed:', err)
      setUploads([])
    } finally {
      setLoading(false)
    }
  }

  async function viewOriginal(upload) {
    try {
      const url = await getUploadSignedUrl(upload.storage_path)
      window.open(url, '_blank')
    } catch {
      alert('Could not generate view link. The file may have been deleted.')
    }
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
        setTriggerMsg({ type: 'ok', text: 'Workflow triggered! Processing starts in ~30 seconds.' })
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

  async function deleteUpload(upload) {
    if (!window.confirm(t('admin.confirmDelete'))) return
    await supabase.storage.from('uploads').remove([upload.storage_path])
    if (upload.sales_path) await supabase.storage.from('sales').remove([upload.sales_path])
    await supabase.from('uploads').delete().eq('id', upload.id)
    setUploads(prev => prev.filter(u => u.id !== upload.id))
  }

  const typeIcon = t => t === 'video' ? '🎬' : t === 'image' ? '🖼️' : '📄'

  const pendingCount = uploads.filter(u => ['pending','processing'].includes(u.processing_status)).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <select value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
        >
          {['all','video','image','pricelist','document'].map(v => (
            <option key={v} value={v}>{v === 'all' ? 'All Types' : v}</option>
          ))}
        </select>
        <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
        >
          {['all','pending','processing','completed','failed'].map(v => (
            <option key={v} value={v}>{v === 'all' ? 'All Statuses' : v}</option>
          ))}
        </select>
        <button onClick={load}
          className="border border-gray-300 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">
          ↻ Refresh
        </button>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <button onClick={triggerProcessing} disabled={triggering}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            {triggering ? '⏳ Triggering…' : `▶ Process Now${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`}
          </button>
          {triggerMsg && (
            <span className={`text-xs px-3 py-1.5 rounded-lg ${triggerMsg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {triggerMsg.type === 'ok' ? '✓ ' : '✗ '}{triggerMsg.text}
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400">{t('common.loading')}</div>
        ) : uploads.length === 0 ? (
          <div className="py-12 text-center text-gray-400">{t('admin.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['','File','Supplier','Type','Category','Size','Status','Date',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {uploads.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2">
                      <UploadThumb upload={u} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span>{typeIcon(u.file_type)}</span>
                        <span className="text-gray-700 max-w-40 truncate">{u.original_filename}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700">{u.suppliers?.company_name_en}</p>
                      <p className="text-xs text-gray-400 font-mono">{u.suppliers?.supplier_code}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 capitalize">{u.file_type}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {u.main_categories?.name_en || '—'}
                      {u.sub_categories?.name_en && <span className="text-gray-400"> › {u.sub_categories.name_en}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fmtBytes(u.file_size)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${PROC_BADGE[u.processing_status]}`}>
                        {u.processing_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => viewOriginal(u)}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">
                          View ↗
                        </button>
                        <button onClick={() => deleteUpload(u)}
                          className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors">
                          {t('admin.delete')}
                        </button>
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
