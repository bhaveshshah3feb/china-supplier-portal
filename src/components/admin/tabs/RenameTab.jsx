import { useState, useEffect, useRef } from 'react'
import { supabase, getSalesUrl, getUploadSignedUrl } from '../../../lib/supabase'

const TYPE_ICON = { video: '🎬', image: '🖼️', pricelist: '📊', document: '📄', other: '📁' }

// ── Hover-to-play thumbnail ───────────────────────────────────
function MediaThumb({ file }) {
  const [hovered, setHovered]     = useState(false)
  const [signedUrl, setSignedUrl] = useState(null)
  const videoRef = useRef()

  const salesUrl = file.sales_path ? getSalesUrl(file.sales_path) : null
  const isVideo  = file.file_type === 'video'
  const isImage  = file.file_type === 'image'

  async function handleMouseEnter() {
    setHovered(true)
    if (isVideo) {
      // Use sales URL (public) if available, else fetch signed URL once
      if (!salesUrl && file.storage_path && !signedUrl) {
        try {
          const url = await getUploadSignedUrl(file.storage_path)
          setSignedUrl(url)
        } catch {}
      }
    }
  }

  function handleMouseLeave() {
    setHovered(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  useEffect(() => {
    if (hovered && videoRef.current) {
      videoRef.current.play().catch(() => {})
    }
  }, [hovered, signedUrl])

  const videoSrc = salesUrl || signedUrl

  return (
    <div
      className="relative w-28 h-20 bg-gray-100 rounded-lg overflow-hidden shrink-0 cursor-default"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isImage && salesUrl ? (
        <img src={salesUrl} alt="" className="w-full h-full object-cover" />
      ) : isVideo && videoSrc ? (
        <>
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            loop
            playsInline
            preload="none"
            className="w-full h-full object-cover"
          />
          {!hovered && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20">
              <span className="text-2xl">▶</span>
              <span className="text-[9px] text-white bg-black/50 px-1.5 py-0.5 rounded mt-1">Hover to play</span>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-2xl">
          {TYPE_ICON[file.file_type] || '📁'}
        </div>
      )}

      {/* Processing status badge */}
      <div className={`absolute top-1 right-1 text-[8px] px-1 py-0.5 rounded font-medium
        ${file.processing_status === 'completed' ? 'bg-green-500 text-white'
        : file.processing_status === 'failed'    ? 'bg-red-500 text-white'
        : file.processing_status === 'processing'? 'bg-blue-500 text-white'
        : 'bg-gray-400 text-white'}`}>
        {file.processing_status}
      </div>
    </div>
  )
}

// ── Single editable row ───────────────────────────────────────
function RenameRow({ file, mainCategories, subCategories, onSaved }) {
  const [name, setName]       = useState(file.display_name || file.original_filename)
  const [mainCat, setMainCat] = useState(file.main_category_id || '')
  const [subCat, setSubCat]   = useState(file.sub_category_id  || '')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  const filteredSubs = subCategories.filter(s => s.main_category_id === mainCat)
  const aiName       = file.ai_game_name

  function applyAiName() {
    if (aiName) setName(aiName)
  }

  async function save() {
    setSaving(true)
    await supabase.from('uploads').update({
      display_name:    name.trim() || null,
      main_category_id: mainCat || null,
      sub_category_id:  subCat  || null,
    }).eq('id', file.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    if (onSaved) onSaved(file.id, { display_name: name, main_category_id: mainCat, sub_category_id: subCat })
  }

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
      {/* Thumbnail */}
      <td className="px-3 py-2">
        <MediaThumb file={file} />
      </td>

      {/* Original / AI hint */}
      <td className="px-3 py-2 min-w-0 max-w-44">
        <p className="text-[10px] text-gray-400 truncate" title={file.original_filename}>
          {file.original_filename}
        </p>
        {aiName && (
          <button onClick={applyAiName}
            className="mt-1 text-[10px] bg-purple-50 text-purple-700 hover:bg-purple-100 px-1.5 py-0.5 rounded truncate max-w-full text-left transition-colors"
            title={`AI detected: ${aiName} — click to apply`}>
            AI: {aiName} ↑
          </button>
        )}
        <p className="text-[9px] text-gray-300 mt-0.5 font-mono">{file.suppliers?.supplier_code}</p>
      </td>

      {/* Display name input */}
      <td className="px-3 py-2 min-w-0">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && save()}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-red-400 outline-none min-w-48"
          placeholder="Enter display name…"
        />
      </td>

      {/* Main category */}
      <td className="px-3 py-2">
        <select
          value={mainCat}
          onChange={e => { setMainCat(e.target.value); setSubCat('') }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-red-400 outline-none w-36"
        >
          <option value="">— Category —</option>
          {mainCategories.map(c => (
            <option key={c.id} value={c.id}>{c.name_en}</option>
          ))}
        </select>
      </td>

      {/* Sub category */}
      <td className="px-3 py-2">
        <select
          value={subCat}
          onChange={e => setSubCat(e.target.value)}
          disabled={!mainCat || filteredSubs.length === 0}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-red-400 outline-none w-36 disabled:opacity-40"
        >
          <option value="">— Sub-cat —</option>
          {filteredSubs.map(s => (
            <option key={s.id} value={s.id}>{s.name_en}</option>
          ))}
        </select>
      </td>

      {/* Save */}
      <td className="px-3 py-2 shrink-0">
        <button onClick={save} disabled={saving}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
            ${saved ? 'bg-green-500 text-white' : 'bg-red-600 text-white hover:bg-red-700'} disabled:opacity-50`}>
          {saving ? '…' : saved ? '✓' : 'Save'}
        </button>
      </td>
    </tr>
  )
}

// ── Main tab ──────────────────────────────────────────────────
export default function RenameTab() {
  const [uploads, setUploads]         = useState([])
  const [mainCategories, setMainCats] = useState([])
  const [subCategories, setSubCats]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilter]     = useState('all')

  useEffect(() => {
    loadMeta()
    loadUploads()
  }, [])

  async function loadMeta() {
    const [{ data: main }, { data: sub }] = await Promise.all([
      supabase.from('main_categories').select('id, name_en').eq('status', 'active').order('display_order'),
      supabase.from('sub_categories').select('id, main_category_id, name_en').eq('status', 'active').order('display_order'),
    ])
    setMainCats(main || [])
    setSubCats(sub || [])
  }

  async function loadUploads() {
    setLoading(true)
    const { data } = await supabase
      .from('uploads')
      .select(`
        id, original_filename, display_name, file_type, file_size,
        processing_status, sales_path, storage_path, created_at,
        ai_game_name, main_category_id, sub_category_id,
        suppliers(company_name_en, supplier_code),
        main_categories!main_category_id(id, name_en),
        sub_categories!sub_category_id(id, name_en)
      `)
      .order('created_at', { ascending: false })
      .limit(300)
    setUploads(data || [])
    setLoading(false)
  }

  function handleSaved(id, updates) {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u))
  }

  const visible = uploads.filter(u => {
    if (filterStatus !== 'all' && u.processing_status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      const name = (u.display_name || u.original_filename || '').toLowerCase()
      const supp = (u.suppliers?.company_name_en || '').toLowerCase()
      if (!name.includes(q) && !supp.includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by filename or supplier…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none flex-1 min-w-52"
        />
        <select value={filterStatus} onChange={e => setFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none">
          {['all','pending','processing','completed','failed'].map(s => (
            <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</option>
          ))}
        </select>
        <button onClick={loadUploads}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          ↻ Refresh
        </button>
        <span className="text-xs text-gray-400">{visible.length} file{visible.length !== 1 ? 's' : ''}</span>
      </div>

      <p className="text-xs text-gray-400">
        Hover a video thumbnail to preview it. Click <strong>AI: …</strong> to apply the detected game name. Press Enter in a name field to save.
      </p>

      {loading ? (
        <div className="py-16 text-center text-gray-400">Loading uploads…</div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center text-gray-400">No uploads found.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Preview</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Original / AI Name</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Display Name</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Sub-Category</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(file => (
                  <RenameRow
                    key={file.id}
                    file={file}
                    mainCategories={mainCategories}
                    subCategories={subCategories}
                    onSaved={handleSaved}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
