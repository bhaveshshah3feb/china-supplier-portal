import * as tus from 'tus-js-client'
import { supabase } from './supabase.js'

const SUPABASE_URL    = import.meta.env.VITE_SUPABASE_URL
const TUS_ENDPOINT    = `${SUPABASE_URL}/storage/v1/upload/resumable`
const CHUNK_SIZE      = 6 * 1024 * 1024
const MAX_CONCURRENT  = 3
const RETRY_DELAYS    = [0, 3000, 8000, 15000]

const active = new Map()

let listeners = []
export function addListener(fn) {
  listeners.push(fn)
  return () => { listeners = listeners.filter(l => l !== fn) }
}
function emit(event) {
  listeners.forEach(fn => fn(event))
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatEta(bytesLeft, speed) {
  if (!speed || speed === 0) return '—'
  const secs = bytesLeft / speed
  if (secs < 60) return `${Math.ceil(secs)}s`
  if (secs < 3600) return `${Math.ceil(secs / 60)}m`
  return `${(secs / 3600).toFixed(1)}h`
}

export function detectFileType(file) {
  const mime = file.type || ''
  if (mime.startsWith('video/'))       return 'video'
  if (mime.startsWith('image/'))       return 'image'
  if (mime === 'application/pdf' ||
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      mime.includes('csv'))            return 'pricelist'
  return 'document'
}

let queue   = []
let running = 0

function tryDequeue() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift()
    running++
    _startTus(item)
  }
}

export function enqueue(item) {
  emit({ type: 'QUEUED', uploadId: item.uploadId })
  queue.push(item)
  tryDequeue()
}

function _startTus({ uploadId, file, storagePath, accessToken, dbId, bucketName = 'uploads' }) {
  let lastBytes = 0
  let lastTime  = Date.now()
  let speed     = 0

  emit({ type: 'STARTED', uploadId })

  const upload = new tus.Upload(file, {
    endpoint: TUS_ENDPOINT,
    retryDelays: RETRY_DELAYS,
    chunkSize: CHUNK_SIZE,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-upsert': 'true',
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    metadata: {
      bucketName,
      objectName:   storagePath,
      contentType:  file.type || 'application/octet-stream',
      cacheControl: '3600',
    },

    onProgress(bytesUploaded, bytesTotal) {
      const now   = Date.now()
      const dt    = (now - lastTime) / 1000
      if (dt > 0.5) {
        speed     = (bytesUploaded - lastBytes) / dt
        lastBytes = bytesUploaded
        lastTime  = now
      }
      const pct      = Math.round((bytesUploaded / bytesTotal) * 100)
      const bytesLeft = bytesTotal - bytesUploaded
      emit({ type: 'PROGRESS', uploadId, pct, bytesUploaded, bytesTotal, speed, eta: formatEta(bytesLeft, speed) })
    },

    async onSuccess() {
      active.delete(uploadId)
      running--
      emit({ type: 'COMPLETE', uploadId, storagePath })
      tryDequeue()

      // ── Mark upload completed in DB and create processing job ──
      if (dbId) {
        try {
          await supabase
            .from('uploads')
            .update({ upload_status: 'completed' })
            .eq('id', dbId)

          await supabase
            .from('processing_queue')
            .insert({ upload_id: dbId, job_type: 'categorize', status: 'pending' })
        } catch (err) {
          console.error('Failed to update upload status after TUS success:', err)
        }
      }
    },

    onError(err) {
      active.delete(uploadId)
      running--
      emit({ type: 'ERROR', uploadId, error: err.message || String(err) })
      // Mark as failed in DB
      if (dbId) {
        supabase.from('uploads')
          .update({ upload_status: 'failed', error_message: err.message || String(err) })
          .eq('id', dbId)
          .then(() => {})
      }
      tryDequeue()
    },
  })

  active.set(uploadId, upload)

  upload.findPreviousUploads().then(prev => {
    if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0])
    upload.start()
  })
}

export function pauseUpload(uploadId) {
  const u = active.get(uploadId)
  if (u) { u.abort(); emit({ type: 'PAUSED', uploadId }) }
}

export function resumeUpload(uploadId, item) {
  if (!active.has(uploadId) && item) {
    running++
    _startTus(item)
  }
}

export function cancelUpload(uploadId) {
  const u = active.get(uploadId)
  if (u) {
    u.abort()
    active.delete(uploadId)
    running = Math.max(0, running - 1)
  }
  queue = queue.filter(i => i.uploadId !== uploadId)
  emit({ type: 'CANCELLED', uploadId })
  tryDequeue()
}
