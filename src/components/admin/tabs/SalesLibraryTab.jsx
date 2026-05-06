import { useState, useEffect, useRef } from 'react'
import { supabase, getSalesUrl } from '../../../lib/supabase'

const WA_LIMITS_MB = { video: 16, image: 5, pricelist: 100, document: 100 }

function fmtBytes(b) {
  if (!b) return '—'
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

const TYPE_ICON = { video: '🎬', image: '🖼️', pricelist: '📊', document: '📄', other: '📁' }

function waLimitWarning(file) {
  const sizeMB = (file.file_size || 0) / 1024 / 1024
  const limitMB = WA_LIMITS_MB[file.file_type] ?? 100
  if (sizeMB > limitMB) return `${sizeMB.toFixed(1)} MB > ${limitMB} MB WA limit`
  return null
}

function templatePreview(fileType, name, cat) {
  if (fileType === 'document' || fileType === 'pricelist') return `"${name} — ${cat}"`
  const typeWord = fileType === 'image' ? 'image' : 'video'
  return `"Here's the ${typeWord} for ${name} — ${cat}"`
}

// ── Hover-to-play thumbnail (sales bucket — public URLs) ──────
function SalesThumb({ file, onClick }) {
  const [hovered, setHovered]   = useState(false)
  const [inView, setInView]     = useState(false)
  const videoRef     = useRef()
  const containerRef = useRef()
  const url   = getSalesUrl(file.sales_path)
  const isVid = file.file_type === 'video'
  const isImg = file.file_type === 'image'

  useEffect(() => {
    if (!isVid) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect() } },
      { rootMargin: '300px', threshold: 0 }
    )
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [isVid])

  function onLoadedMetadata() {
    if (videoRef.current && !hovered) videoRef.current.currentTime = 1
  }
  function handleMouseEnter() {
    setHovered(true)
    if (videoRef.current) { videoRef.current.currentTime = 0; videoRef.current.play().catch(() => {}) }
  }
  function handleMouseLeave() {
    setHovered(false)
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 1 }
  }

  return (
    <div ref={containerRef}
      className="aspect-video bg-gray-100 relative overflow-hidden cursor-pointer"
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isImg ? (
        <img src={url} alt="" className="w-full h-full object-cover"
          onError={e => { e.target.style.display = 'none' }} />
      ) : isVid ? (
        <>
          {inView && (
            <video ref={videoRef} src={url} muted loop playsInline preload="metadata"
              onLoadedMetadata={onLoadedMetadata}
              className="w-full h-full object-cover" />
          )}
          {!hovered && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-black/40 rounded-full w-10 h-10 flex items-center justify-center">
                <span className="text-white text-lg pl-0.5">▶</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-4xl">{TYPE_ICON[file.file_type] || '📁'}</span>
        </div>
      )}
      <div className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
        {file.suppliers?.supplier_code}
      </div>
    </div>
  )
}

// ── Single Share Modal ────────────────────────────────────────
function ShareModal({ file, onClose }) {
  const url       = getSalesUrl(file.sales_path)
  const filename  = file.display_name || file.original_filename
  const fileType  = file.file_type
  const sizeMB    = (file.file_size || 0) / 1024 / 1024

  const machineName = file.ai_game_name || file.display_name || file.original_filename.replace(/\.[^.]+$/, '')
  const category = file.main_categories?.name_en || ''

  const [phone, setPhone]         = useState('')
  const [email, setEmail]         = useState('')
  const [waName, setWaName]       = useState(machineName)
  const [waCat, setWaCat]         = useState(category)
  const [waSending, setWaSending] = useState(false)
  const [waResult, setWaResult]   = useState(null)
  const [copied, setCopied]       = useState(false)

  const waWarning = waLimitWarning(file)

  async function sendWhatsApp() {
    if (!phone.trim()) return
    setWaSending(true)
    setWaResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          to_phone: phone,
          file_url: url,
          filename,
          file_type: fileType,
          file_size: file.file_size,
          machine_name: waName,
          category: waCat,
        }),
      })
      const body = await res.json()
      setWaResult(body.success ? 'ok' : (body.error || 'Failed to send'))
    } catch {
      setWaResult('Network error — check connection')
    } finally {
      setWaSending(false)
    }
  }

  function openWaLink() {
    const cleanPhone = phone.replace(/[^\d]/g, '')
    const typeWord = fileType === 'image' ? 'image' : 'video'
    const msg = encodeURIComponent(`Here's the ${typeWord} for ${waName} — ${waCat}`)
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank')
  }

  function openMailto() {
    const typeWord = fileType === 'video' ? 'video' : fileType === 'image' ? 'image' : 'file'
    const subject = encodeURIComponent(`Amusement Equipment: ${filename}`)
    const body = encodeURIComponent(
      `Hi,\n\nPlease find the ${typeWord} for ${machineName}${category ? ` (${category})` : ''} below:\n\n${url}\n\n` +
      (sizeMB < 20 ? 'You can download it directly from the link above.\n\n' : '') +
      `File: ${filename}\nSize: ${fmtBytes(file.file_size)}\n\nBest regards,\nBhavesh — Aryan Amusements\n+91 9841081945`
    )
    window.open(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <p className="font-semibold text-gray-800 truncate max-w-xs">{filename}</p>
            <p className="text-xs text-gray-400">{fmtBytes(file.file_size)} · {file.suppliers?.company_name_en}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex gap-2">
            <button onClick={copyLink}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg text-sm transition-colors">
              {copied ? '✓ Copied!' : '🔗 Copy Link'}
            </button>
            <a href={getSalesUrl(file.sales_path, { download: true, filename })} target="_blank" rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-2 rounded-lg text-sm transition-colors">
              ⬇ Download
            </a>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Share via WhatsApp</p>
            {waWarning && (
              <p className="text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">⚠ {waWarning} — may be rejected by WhatsApp</p>
            )}
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="Phone with country code (e.g. 919876543210)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Machine Name</label>
                <input value={waName} onChange={e => setWaName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <input value={waCat} onChange={e => setWaCat(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
              </div>
            </div>
            <p className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-lg italic">
              {templatePreview(fileType, waName, waCat)}
            </p>
            <div className="flex gap-2">
              <button onClick={sendWhatsApp} disabled={waSending || !phone.trim()}
                className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
                {waSending ? 'Sending…' : 'Send via API'}
              </button>
              <button onClick={openWaLink} disabled={!phone.trim()}
                className="flex-1 border border-green-500 text-green-700 px-4 py-2 rounded-lg text-sm hover:bg-green-50 disabled:opacity-50 transition-colors">
                Open WhatsApp ↗
              </button>
            </div>
            {waResult === 'ok' && (
              <p className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">✓ Message sent successfully!</p>
            )}
            {waResult && waResult !== 'ok' && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">✗ {waResult}</p>
            )}
            <p className="text-[10px] text-gray-400">
              <strong>Send via API</strong> sends the file as an attachment directly to the number above.<br />
              <strong>Open WhatsApp</strong> opens WhatsApp with the caption pre-filled (text only — attach the file manually).
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Share via Email</p>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <button onClick={openMailto} disabled={!email.trim()}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Open in Email Client ↗
            </button>
            <p className="text-[10px] text-gray-400">
              Opens your default email app with the file link pre-filled.
              {sizeMB < 20 ? ' File is under 20 MB — you can attach it manually too.' : ' File is large — the link allows direct download.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Multi-Share Modal ─────────────────────────────────────────
function MultiShareModal({ files, onClose }) {
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [fileFields, setFileFields] = useState(
    files.map(f => ({
      id: f.id,
      waName: f.ai_game_name || f.display_name || f.original_filename.replace(/\.[^.]+$/, ''),
      waCat: f.main_categories?.name_en || 'Amusement Equipment',
    }))
  )
  const [waSending, setWaSending] = useState(false)
  const [waProgress, setWaProgress] = useState([])

  function updateField(idx, key, val) {
    setFileFields(prev => prev.map((f, i) => i === idx ? { ...f, [key]: val } : f))
  }

  async function sendAllWhatsApp() {
    if (!phone.trim()) return
    setWaSending(true)
    const statuses = new Array(files.length).fill(null)
    setWaProgress([...statuses])
    const { data: { session } } = await supabase.auth.getSession()

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const fields = fileFields[i]
      const warning = waLimitWarning(file)
      if (warning) {
        statuses[i] = `Skipped: ${warning}`
        setWaProgress([...statuses])
        continue
      }
      statuses[i] = 'sending'
      setWaProgress([...statuses])
      try {
        const res = await fetch('/api/send-whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            to_phone: phone,
            file_url: getSalesUrl(file.sales_path),
            filename: file.display_name || file.original_filename,
            file_type: file.file_type,
            file_size: file.file_size,
            machine_name: fields.waName,
            category: fields.waCat,
          }),
        })
        const body = await res.json()
        statuses[i] = body.success ? 'ok' : (body.error || 'Failed')
      } catch {
        statuses[i] = 'Network error'
      }
      setWaProgress([...statuses])
    }
    setWaSending(false)
  }

  function openMultiMailto() {
    const subject = encodeURIComponent(`Amusement Equipment — ${files.length} Files`)
    const bodyLines = files.map((f, i) => {
      const url = getSalesUrl(f.sales_path)
      const { waName, waCat } = fileFields[i]
      return `${i + 1}. ${waName}${waCat ? ` (${waCat})` : ''}\n   ${url}\n   Size: ${fmtBytes(f.file_size)}`
    })
    const body = encodeURIComponent(
      `Hi,\n\nPlease find the following amusement equipment files:\n\n${bodyLines.join('\n\n')}\n\nBest regards,\nBhavesh — Aryan Amusements\n+91 9841081945`
    )
    window.open(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`)
  }

  const sentCount = waProgress.filter(s => s === 'ok').length
  const doneCount = waProgress.filter(s => s !== null && s !== 'sending').length
  const allDone   = waProgress.length > 0 && doneCount === files.length

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <p className="font-semibold text-gray-800">Share {files.length} Files</p>
            <p className="text-xs text-gray-400">WhatsApp sends {files.length} separate messages · Email bundles all links in one</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* File list with editable name/category */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Files ({files.length})</p>
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {files.map((file, idx) => {
                const warning = waLimitWarning(file)
                const status  = waProgress[idx]
                return (
                  <div key={file.id} className={`flex items-center gap-2 p-2 rounded-lg ${warning ? 'bg-orange-50' : 'bg-gray-50'}`}>
                    <span className="text-base shrink-0">{TYPE_ICON[file.file_type] || '📁'}</span>
                    <div className="flex-1 min-w-0 grid grid-cols-2 gap-1">
                      <input value={fileFields[idx]?.waName || ''}
                        onChange={e => updateField(idx, 'waName', e.target.value)}
                        placeholder="Machine name"
                        className="border border-gray-200 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-green-500 outline-none bg-white" />
                      <input value={fileFields[idx]?.waCat || ''}
                        onChange={e => updateField(idx, 'waCat', e.target.value)}
                        placeholder="Category"
                        className="border border-gray-200 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-green-500 outline-none bg-white" />
                      {warning && <p className="col-span-2 text-[10px] text-orange-600 mt-0.5">⚠ {warning} — will be skipped</p>}
                    </div>
                    <div className="shrink-0 w-20 text-right text-xs">
                      {(status === null || status === undefined) && <span className="text-gray-400">{fmtBytes(file.file_size)}</span>}
                      {status === 'sending' && <span className="text-blue-500">Sending…</span>}
                      {status === 'ok' && <span className="text-green-600 font-medium">✓ Sent</span>}
                      {status && status !== 'sending' && status !== 'ok' && (
                        <span className="text-red-500 text-[10px] leading-tight block">{status.slice(0, 28)}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* WhatsApp */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Share via WhatsApp</p>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="Phone with country code (e.g. 919876543210)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            {allDone && (
              <p className={`text-xs px-3 py-2 rounded-lg ${sentCount > 0 ? 'text-green-700 bg-green-50' : 'text-gray-600 bg-gray-50'}`}>
                {sentCount > 0
                  ? `✓ ${sentCount}/${files.length} messages sent successfully`
                  : 'All messages skipped (files exceeded WhatsApp size limits)'}
              </p>
            )}
            <button onClick={sendAllWhatsApp} disabled={waSending || !phone.trim()}
              className="w-full bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
              {waSending
                ? `Sending ${waProgress.filter(s => s !== null).length}/${files.length}…`
                : `Send ${files.length} WhatsApp Messages`}
            </button>
            <p className="text-[10px] text-gray-400">
              Each file is sent as a separate WhatsApp message (1 media attachment per template).
              Files over the size limit are skipped automatically.
            </p>
          </div>

          {/* Email */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Share via Email</p>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <button onClick={openMultiMailto} disabled={!email.trim()}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Open Email with All {files.length} Links ↗
            </button>
            <p className="text-[10px] text-gray-400">
              Opens your email client with all {files.length} file download links in the message body.
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────
export default function SalesLibraryTab() {
  const [files, setFiles]           = useState([])
  const [suppliers, setSuppliers]   = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading]       = useState(true)
  const [view, setView]             = useState('grid')
  const [copied, setCopied]         = useState(null)
  const [preview, setPreview]       = useState(null)
  const [sharing, setSharing]       = useState(null)
  const [selected, setSelected]     = useState(new Set())
  const [multiSharing, setMultiSharing] = useState(false)

  const [filter, setFilter] = useState({ supplier: 'all', category: 'all', type: 'all' })

  useEffect(() => { loadMeta() }, [])
  useEffect(() => { load() }, [filter])

  // Clean up stale selections when file list changes
  useEffect(() => {
    const validIds = new Set(files.map(f => f.id))
    setSelected(prev => {
      const filtered = new Set([...prev].filter(id => validIds.has(id)))
      return filtered.size === prev.size ? prev : filtered
    })
  }, [files])

  async function loadMeta() {
    const [{ data: sups }, { data: cats }] = await Promise.all([
      supabase.from('suppliers').select('id, company_name_en, supplier_code').eq('status', 'active').order('company_name_en'),
      supabase.from('main_categories').select('id, name_en').order('display_order'),
    ])
    setSuppliers(sups || [])
    setCategories(cats || [])
  }

  async function load() {
    setLoading(true)
    let q = supabase
      .from('uploads')
      .select(`
        id, original_filename, display_name, ai_game_name, file_type, file_size, mime_type,
        sales_path, processing_status, created_at, updated_at, ai_confidence,
        suppliers(id, company_name_en, company_name_zh, supplier_code),
        main_categories!main_category_id(id, name_en, name_zh),
        sub_categories!sub_category_id(id, name_en, name_zh)
      `)
      .eq('processing_status', 'completed')
      .not('sales_path', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(300)

    if (filter.supplier !== 'all') q = q.eq('supplier_id', filter.supplier)
    if (filter.category !== 'all') q = q.eq('main_category_id', filter.category)
    if (filter.type !== 'all')     q = q.eq('file_type', filter.type)

    const { data } = await q
    setFiles(data || [])
    setLoading(false)
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function clearSelection() { setSelected(new Set()) }

  const selectedFiles = files.filter(f => selected.has(f.id))

  async function copyUrl(file) {
    const url = getSalesUrl(file.sales_path)
    await navigator.clipboard.writeText(url)
    setCopied(file.id)
    setTimeout(() => setCopied(null), 2000)
  }

  async function deleteFile(file) {
    if (!window.confirm('Delete this file from the Sales Library? This cannot be undone.')) return
    await Promise.all([
      supabase.storage.from('sales').remove([file.sales_path]),
      supabase.from('uploads').update({ processing_status: 'skipped', sales_path: null }).eq('id', file.id),
    ])
    setFiles(prev => prev.filter(f => f.id !== file.id))
  }

  const stats = {
    total:  files.length,
    videos: files.filter(f => f.file_type === 'video').length,
    images: files.filter(f => f.file_type === 'image').length,
    docs:   files.filter(f => !['video', 'image'].includes(f.file_type)).length,
    size:   fmtBytes(files.reduce((s, f) => s + (f.file_size || 0), 0)),
  }

  return (
    <div className="space-y-5">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Ready Files', value: stats.total,  color: 'text-green-700',  bg: 'bg-green-50' },
          { label: 'Videos',      value: stats.videos, color: 'text-purple-700', bg: 'bg-purple-50' },
          { label: 'Images',      value: stats.images, color: 'text-blue-700',   bg: 'bg-blue-50' },
          { label: 'Documents',   value: stats.docs,   color: 'text-orange-700', bg: 'bg-orange-50' },
          { label: 'Total Size',  value: stats.size,   color: 'text-gray-700',   bg: 'bg-gray-100' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-3 text-center ${s.bg}`}>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={filter.supplier} onChange={e => setFilter(f => ({ ...f, supplier: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none flex-1 min-w-40">
          <option value="all">All Suppliers</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.company_name_en} ({s.supplier_code})</option>)}
        </select>
        <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none flex-1 min-w-40">
          <option value="all">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
        </select>
        <select value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none">
          {['all', 'video', 'image', 'pricelist', 'document'].map(v => (
            <option key={v} value={v}>{v === 'all' ? 'All Types' : v.charAt(0).toUpperCase() + v.slice(1) + 's'}</option>
          ))}
        </select>
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5 ml-auto">
          {[['grid', '⊞'], ['list', '≡']].map(([v, icon]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${view === v ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-medium text-green-800">
            {selected.size} file{selected.size !== 1 ? 's' : ''} selected
          </span>
          <button onClick={() => setMultiSharing(true)}
            className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
            Share Selected ({selected.size})
          </button>
          <button onClick={clearSelection}
            className="text-sm text-green-700 hover:text-green-900 ml-auto transition-colors">
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400">Loading sales library…</div>
      ) : files.length === 0 ? (
        <div className="py-16 text-center">
          <div className="text-5xl mb-4">📭</div>
          <p className="text-gray-500 font-medium">No watermarked files yet</p>
          <p className="text-sm text-gray-400 mt-1">Files appear here once AI categorization and watermarking are complete</p>
        </div>
      ) : view === 'grid' ? (
        /* ── Grid ── */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {files.map(file => {
            const url      = getSalesUrl(file.sales_path)
            const isSelected = selected.has(file.id)
            return (
              <div key={file.id}
                className={`bg-white rounded-xl border-2 overflow-hidden hover:shadow-md transition-all ${isSelected ? 'border-green-500 shadow-md' : 'border-gray-200'}`}>
                <div className="relative">
                  <SalesThumb file={file} onClick={() => setPreview(file)} />
                  {/* Selection checkbox */}
                  <button
                    className={`absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                      ${isSelected ? 'bg-green-600 border-green-600' : 'bg-white/90 border-gray-400 hover:border-green-500'}`}
                    onClick={e => { e.stopPropagation(); toggleSelect(file.id) }}
                  >
                    {isSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                  </button>
                </div>
                <div className="p-2.5 space-y-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{file.display_name || file.original_filename}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {file.main_categories?.name_en}{file.sub_categories && <> › {file.sub_categories.name_en}</>}
                  </p>
                  <p className="text-[10px] text-gray-400">{file.suppliers?.company_name_en} · {fmtBytes(file.file_size)}</p>
                  <p className="text-[10px] text-gray-300">Added {new Date(file.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  <div className="flex gap-1 pt-1">
                    <button onClick={() => setSharing(file)}
                      className="flex-1 text-center text-[10px] bg-green-50 text-green-700 hover:bg-green-100 px-1.5 py-1 rounded transition-colors font-medium">
                      Share
                    </button>
                    <button onClick={() => setPreview(file)}
                      className="flex-1 text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-1.5 py-1 rounded transition-colors">
                      Preview
                    </button>
                    <a href={url} download={file.display_name || file.original_filename} target="_blank" rel="noreferrer"
                      className="flex-1 text-center text-[10px] bg-gray-50 text-gray-600 hover:bg-gray-100 px-1.5 py-1 rounded transition-colors">
                      ⬇
                    </a>
                    <button onClick={() => deleteFile(file)}
                      className="text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 px-1.5 py-1 rounded transition-colors">
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── List ── */
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 w-8"></th>
                  {['', 'File', 'Supplier', 'Category', 'Size', 'Added', 'Actions'].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {files.map(file => {
                  const url        = getSalesUrl(file.sales_path)
                  const isSelected = selected.has(file.id)
                  return (
                    <tr key={file.id} className={`transition-colors ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => toggleSelect(file.id)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                            ${isSelected ? 'bg-green-600 border-green-600' : 'border-gray-300 hover:border-green-500'}`}
                        >
                          {isSelected && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                        </button>
                      </td>
                      <td className="px-3 py-2 w-24">
                        <div className="w-20 h-14 rounded overflow-hidden">
                          <SalesThumb file={file} onClick={() => setPreview(file)} />
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-48">
                        <p className="font-medium text-gray-800 truncate">{file.display_name || file.original_filename}</p>
                        <p className="text-xs text-gray-400 font-mono">{file.suppliers?.supplier_code}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{file.suppliers?.company_name_en}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        <p>{file.main_categories?.name_en || '—'}</p>
                        {file.sub_categories && <p className="text-gray-400">{file.sub_categories.name_en}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtBytes(file.file_size)}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(file.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={() => setSharing(file)}
                            className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded-lg transition-colors font-medium">
                            Share
                          </button>
                          <button onClick={() => setPreview(file)}
                            className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors">
                            Preview
                          </button>
                          <a href={getSalesUrl(file.sales_path, { download: true, filename: file.display_name || file.original_filename })}
                            target="_blank" rel="noreferrer"
                            className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors">
                            ⬇ Download
                          </a>
                          <button onClick={() => deleteFile(file)}
                            className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Preview Modal ── */}
      {preview && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div>
                <p className="font-semibold text-gray-800 truncate max-w-xs">{preview.display_name || preview.original_filename}</p>
                <p className="text-xs text-gray-400">{preview.suppliers?.company_name_en} · {preview.suppliers?.supplier_code}</p>
              </div>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="bg-black flex items-center justify-center min-h-48 max-h-[70vh]">
              {preview.file_type === 'image' ? (
                <img src={getSalesUrl(preview.sales_path)} alt={preview.original_filename}
                  className="max-w-full max-h-[70vh] object-contain" />
              ) : preview.file_type === 'video' ? (
                <video src={getSalesUrl(preview.sales_path)} controls autoPlay
                  className="max-w-full max-h-[70vh]" />
              ) : (
                <div className="py-16 text-center text-white">
                  <div className="text-6xl mb-4">{TYPE_ICON[preview.file_type]}</div>
                  <p className="text-gray-300 mb-4">Preview not available for this file type</p>
                  <a href={getSalesUrl(preview.sales_path)} target="_blank" rel="noreferrer"
                    className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700">
                    Open File ↗
                  </a>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200">
              <div className="text-xs text-gray-500 space-x-4">
                <span>{preview.main_categories?.name_en}{preview.sub_categories && ` › ${preview.sub_categories.name_en}`}</span>
                <span>{fmtBytes(preview.file_size)}</span>
                {preview.ai_confidence && <span>AI: {Math.round(preview.ai_confidence * 100)}%</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setPreview(null); setSharing(preview) }}
                  className="text-sm bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors">
                  Share
                </button>
                <a href={getSalesUrl(preview.sales_path, { download: true, filename: preview.display_name || preview.original_filename })}
                  target="_blank" rel="noreferrer"
                  className="text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">
                  ⬇ Download
                </a>
                <a href={getSalesUrl(preview.sales_path)} target="_blank" rel="noreferrer"
                  className="text-sm bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors">
                  Open Full ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Single Share Modal ── */}
      {sharing && <ShareModal file={sharing} onClose={() => setSharing(null)} />}

      {/* ── Multi Share Modal ── */}
      {multiSharing && selectedFiles.length > 0 && (
        <MultiShareModal files={selectedFiles} onClose={() => setMultiSharing(false)} />
      )}

    </div>
  )
}
