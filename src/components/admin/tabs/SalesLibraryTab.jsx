import { useState, useEffect } from 'react'
import { supabase, getSalesUrl } from '../../../lib/supabase'

function fmtBytes(b) {
  if (!b) return '—'
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

const TYPE_ICON = { video: '🎬', image: '🖼️', pricelist: '📊', document: '📄', other: '📁' }

// ── Share Modal ───────────────────────────────────────────────
function ShareModal({ file, onClose }) {
  const url       = getSalesUrl(file.sales_path)
  const filename  = file.display_name || file.original_filename
  const fileType  = file.file_type
  const sizeMB    = (file.file_size || 0) / 1024 / 1024

  const [phone, setPhone]         = useState('')
  const [email, setEmail]         = useState('')
  const [caption, setCaption]     = useState(`Check out this amusement equipment from Aryana Amusements:\n\n${url}`)
  const [waSending, setWaSending] = useState(false)
  const [waResult, setWaResult]   = useState(null)  // null | 'ok' | string(err)
  const [copied, setCopied]       = useState(false)

  async function sendWhatsApp() {
    if (!phone.trim()) return
    setWaSending(true)
    setWaResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          to_phone:  phone,
          file_url:  url,
          filename:  filename,
          file_type: fileType,
          caption:   caption,
        }),
      })
      const body = await res.json()
      if (body.success) {
        setWaResult('ok')
      } else {
        setWaResult(body.error || 'Failed to send')
      }
    } catch {
      setWaResult('Network error — check connection')
    } finally {
      setWaSending(false)
    }
  }

  function openWaLink() {
    const cleanPhone = phone.replace(/[^\d]/g, '')
    const msg = encodeURIComponent(`${caption}\n\n${url}`)
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank')
  }

  function openMailto() {
    const subject = encodeURIComponent(`Amusement Equipment: ${filename}`)
    const body = encodeURIComponent(
      `Hi,\n\nPlease find the requested file below:\n\n${url}\n\n` +
      (sizeMB < 20 ? 'You can download it directly from the link above.\n\n' : '') +
      `File: ${filename}\nSize: ${fmtBytes(file.file_size)}\n\nBest regards,\nBhavesh — Aryana Amusements\n+91 9841081945`
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

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <p className="font-semibold text-gray-800 truncate max-w-xs">{filename}</p>
            <p className="text-xs text-gray-400">{fmtBytes(file.file_size)} · {file.suppliers?.company_name_en}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">

          {/* Quick actions */}
          <div className="flex gap-2">
            <button onClick={copyLink}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg text-sm transition-colors">
              {copied ? '✓ Copied!' : '🔗 Copy Link'}
            </button>
            <a href={url} download={filename} target="_blank" rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-2 rounded-lg text-sm transition-colors">
              ⬇ Download
            </a>
          </div>

          {/* WhatsApp section */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Share via WhatsApp</p>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Phone number with country code (e.g. 919876543210)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none"
            />
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none"
            />
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
              "Send via API" uses your configured WhatsApp Business API and sends the file directly.<br />
              "Open WhatsApp" opens the app/web with the message pre-filled (no API needed).
            </p>
          </div>

          {/* Email section */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Share via Email</p>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
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

  const [filter, setFilter] = useState({ supplier: 'all', category: 'all', type: 'all' })

  useEffect(() => { loadMeta() }, [])
  useEffect(() => { load() }, [filter])

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
        id, original_filename, display_name, file_type, file_size, mime_type,
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
            const url   = getSalesUrl(file.sales_path)
            const isImg = file.file_type === 'image'
            const isVid = file.file_type === 'video'
            return (
              <div key={file.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                {/* Thumbnail */}
                <div className="aspect-video bg-gray-100 relative overflow-hidden cursor-pointer"
                  onClick={() => setPreview(file)}>
                  {isImg ? (
                    <img src={url} alt={file.original_filename} className="w-full h-full object-cover"
                      onError={e => { e.target.style.display = 'none' }} />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                      <span className="text-4xl">{TYPE_ICON[file.file_type] || '📁'}</span>
                      {isVid && <span className="text-xs bg-black/50 text-white px-2 py-0.5 rounded-full">▶ Preview</span>}
                    </div>
                  )}
                  <div className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                    {file.suppliers?.supplier_code}
                  </div>
                </div>
                {/* Info */}
                <div className="p-2.5 space-y-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{file.display_name || file.original_filename}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {file.main_categories?.name_en}{file.sub_categories && <> › {file.sub_categories.name_en}</>}
                  </p>
                  <p className="text-[10px] text-gray-400">{file.suppliers?.company_name_en} · {fmtBytes(file.file_size)}</p>
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
                  {['', 'File', 'Supplier', 'Category', 'Size', 'Date', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {files.map(file => {
                  const url = getSalesUrl(file.sales_path)
                  return (
                    <tr key={file.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xl">{TYPE_ICON[file.file_type] || '📁'}</td>
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
                        {new Date(file.updated_at).toLocaleDateString()}
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
                          <a href={url} download={file.display_name || file.original_filename} target="_blank" rel="noreferrer"
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
                <a href={getSalesUrl(preview.sales_path)} download={preview.display_name || preview.original_filename}
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

      {/* ── Share Modal ── */}
      {sharing && <ShareModal file={sharing} onClose={() => setSharing(null)} />}

    </div>
  )
}
