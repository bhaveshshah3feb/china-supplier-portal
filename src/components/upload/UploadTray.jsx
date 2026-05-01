import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { addListener, pauseUpload, resumeUpload, cancelUpload, formatBytes, formatEta } from '../../lib/uploadManager'
import { supabase } from '../../lib/supabase'

const STATUS_ICON = {
  queued:     '⏳',
  uploading:  '⬆️',
  paused:     '⏸️',
  uploaded:   '✅',
  completed:  '✅',
  failed:     '❌',
  processing: '⚙️',
}

const STATUS_COLOR = {
  queued:     'text-gray-500',
  uploading:  'text-blue-600',
  paused:     'text-yellow-600',
  uploaded:   'text-green-600',
  completed:  'text-green-600',
  failed:     'text-red-600',
  processing: 'text-purple-600',
}

export default function UploadTray() {
  const { t } = useTranslation()
  const [items, setItems]       = useState({})  // uploadId → item state
  const [collapsed, setCollapsed] = useState(false)
  const [itemData, setItemData] = useState({})  // uploadId → original enqueue data (for resume)

  const update = useCallback((uploadId, patch) => {
    setItems(prev => ({ ...prev, [uploadId]: { ...prev[uploadId], ...patch } }))
  }, [])

  useEffect(() => {
    const remove = addListener((event) => {
      switch (event.type) {
        case 'QUEUED':
          setItems(prev => ({
            ...prev,
            [event.uploadId]: { status: 'queued', pct: 0, speed: 0, eta: '—', error: null },
          }))
          break
        case 'STARTED':
          update(event.uploadId, { status: 'uploading' })
          break
        case 'PROGRESS':
          update(event.uploadId, {
            status: 'uploading',
            pct:   event.pct,
            speed: event.speed,
            eta:   event.eta,
            bytesUploaded: event.bytesUploaded,
            bytesTotal:    event.bytesTotal,
          })
          break
        case 'COMPLETE':
          update(event.uploadId, { status: 'uploaded', pct: 100 })
          triggerCategorize(event.uploadId, event.storagePath)
          // Auto-dismiss the tray item after 8 seconds — processing is fully background
          setTimeout(() => {
            setItems(prev => { const n = { ...prev }; delete n[event.uploadId]; return n })
          }, 8000)
          break
        case 'ERROR':
          update(event.uploadId, { status: 'failed', error: event.error })
          break
        case 'PAUSED':
          update(event.uploadId, { status: 'paused' })
          break
        case 'CANCELLED':
          setItems(prev => { const n = { ...prev }; delete n[event.uploadId]; return n })
          break
        default:
          break
      }
    })
    return remove
  }, [update])

  async function triggerCategorize(uploadId, storagePath) {
    try {
      await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, storagePath }),
      })
    } catch {
      // Non-fatal — GH Actions will also handle videos
    }
  }

  const entries = Object.entries(items)
  if (entries.length === 0) return null

  const activeCount = entries.filter(([, i]) => ['queued', 'uploading', 'paused'].includes(i.status)).length
  const allDone     = entries.every(([, i]) => ['completed', 'uploaded', 'failed'].includes(i.status))

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-800 text-white cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{t('upload.trayTitle')}</span>
          {activeCount > 0 && (
            <span className="bg-blue-500 text-white text-xs rounded-full px-2 py-0.5">{activeCount}</span>
          )}
          {allDone && <span className="text-green-400 text-xs">✓ {t('upload.allDone')}</span>}
        </div>
        <div className="flex items-center gap-3">
          {allDone && (
            <button
              onClick={e => { e.stopPropagation(); setItems({}) }}
              className="text-gray-400 hover:text-white text-xs"
            >
              Clear
            </button>
          )}
          <span className="text-gray-400 text-sm">{collapsed ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Items */}
      {!collapsed && (
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
          {entries.map(([uploadId, item]) => (
            <div key={uploadId} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span>{STATUS_ICON[item.status] || '📄'}</span>
                  <span className="text-sm text-gray-700 truncate">{uploadId.split('-')[0]}…</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {item.status === 'uploading' && (
                    <button onClick={() => pauseUpload(uploadId)} className="text-xs text-gray-500 hover:text-gray-700 border rounded px-1.5 py-0.5">{t('upload.pause')}</button>
                  )}
                  {item.status === 'paused' && (
                    <button onClick={() => resumeUpload(uploadId, itemData[uploadId])} className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-1.5 py-0.5">{t('upload.resume')}</button>
                  )}
                  {(item.status === 'uploading' || item.status === 'paused' || item.status === 'queued') && (
                    <button onClick={() => cancelUpload(uploadId)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-1.5 py-0.5">{t('upload.cancel')}</button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {(item.status === 'uploading' || item.status === 'paused') && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span className={STATUS_COLOR[item.status]}>{item.pct}%</span>
                    <span>{item.status === 'uploading' ? `${formatBytes(item.speed)}/s · ${item.eta}` : t('upload.paused')}</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              )}

              {item.status === 'uploaded' && (
                <div className="mt-1.5 space-y-0.5">
                  <p className="text-xs text-green-600 font-medium">✅ Upload complete!</p>
                  <p className="text-xs text-gray-400">AI processing happens in background — you can close the page safely.</p>
                </div>
              )}
              {item.status === 'processing' && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-purple-600">{t('upload.processing')}</span>
                </div>
              )}

              {item.status === 'failed' && item.error && (
                <p className="text-xs text-red-500 mt-1 truncate">{item.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
