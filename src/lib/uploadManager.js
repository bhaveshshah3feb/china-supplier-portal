import * as tus from 'tus-js-client'
import { supabase } from './supabase.js'

const SUPABASE_URL    = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON   = import.meta.env.VITE_SUPABASE_ANON_KEY
const TUS_ENDPOINT    = `${SUPABASE_URL}/storage/v1/upload/resumable`

// Files under this threshold use a single PUT request instead of TUS.
// TUS adds ~200 ms of round-trip overhead PER CHUNK (worse on China connections).
// A 5 MB image with 512 KB chunks = 10 round-trips = 2+ extra seconds wasted.
// Direct upload = 1 request, 3–5× faster for small files.
const DIRECT_THRESHOLD = 10 * 1024 * 1024   // 10 MB

// TUS settings — only used for large files
const CHUNK_SIZE      = 512 * 1024
const MAX_CONCURRENT  = 3   // 3 concurrent — OK for a mix of large+small files
const RETRY_DELAYS    = [0, 1000, 2000, 4000, 8000, 16000, 30000]

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
    // Route: small files → direct PUT (fast), large files → TUS (resumable)
    if (item.file.size < DIRECT_THRESHOLD) {
      _startDirect(item)
    } else {
      _startTus(item)
    }
  }
}

export function enqueue(item) {
  emit({ type: 'QUEUED', uploadId: item.uploadId })
  queue.push(item)
  tryDequeue()
}

// ── Direct upload (single PUT) — for files under DIRECT_THRESHOLD ──────
// Faster than TUS for small files: 1 round-trip vs N round-trips (one per chunk).
// Retries up to 3 times on network failure before reporting an error —
// this handles China GFW-related drops without needing resumability.
// If all retries fail, falls back to TUS so the upload is never truly lost.
async function _startDirect(item) {
  const { uploadId, file, storagePath, accessToken, dbId, bucketName = 'uploads' } = item
  emit({ type: 'STARTED', uploadId })
  emit({ type: 'PROGRESS', uploadId, pct: 0, bytesUploaded: 0, bytesTotal: file.size, speed: 0, eta: '—' })

  const MAX_RETRIES = 3
  let lastErr = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        const delay = attempt * 1500
        console.log(`Direct upload retry ${attempt}/${MAX_RETRIES} in ${delay}ms…`)
        await new Promise(r => setTimeout(r, delay))
      }

      const t0  = Date.now()
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${bucketName}/${storagePath}`,
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type':  file.type || 'application/octet-stream',
            'x-upsert':      'true',
            'apikey':        SUPABASE_ANON,
          },
          body: file,
        }
      )

      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`HTTP ${res.status}: ${txt}`)
      }

      const speed = file.size / ((Date.now() - t0) / 1000)
      active.delete(uploadId)
      running--
      emit({ type: 'PROGRESS', uploadId, pct: 100, bytesUploaded: file.size, bytesTotal: file.size, speed, eta: '0s' })
      emit({ type: 'COMPLETE', uploadId, storagePath })
      tryDequeue()

      if (dbId) {
        try {
          await supabase.from('uploads').update({ upload_status: 'completed' }).eq('id', dbId)
          await supabase.from('processing_queue').insert({ upload_id: dbId, job_type: 'categorize', status: 'pending' })
        } catch (err) { console.error('DB update after direct upload failed:', err) }
      }
      return  // success

    } catch (err) {
      lastErr = err
    }
  }

  // All retries failed — fall back to TUS which can resume on a future run
  console.warn(`Direct upload failed after ${MAX_RETRIES} retries — falling back to TUS:`, lastErr?.message)
  _startTus(item)
}

// ── TUS upload (resumable) — for files over DIRECT_THRESHOLD ────────────
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
      const msg = err.message || String(err)
      // Give a friendlier message for the common China connection drop error
      const friendly = msg.includes('unexpected response')
        ? 'Connection interrupted — please try uploading again. The file will resume where it left off.'
        : msg
      emit({ type: 'ERROR', uploadId, error: friendly })
      if (dbId) {
        supabase.from('uploads')
          .update({ upload_status: 'failed', error_message: msg })
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
