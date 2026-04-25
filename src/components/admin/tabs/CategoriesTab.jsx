import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../../lib/supabase'

export default function CategoriesTab() {
  const { t } = useTranslation()
  const [mainCats, setMainCats] = useState([])
  const [subCats,  setSubCats]  = useState([])
  const [selected, setSelected] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [newMain,  setNewMain]  = useState({ name_en: '', name_zh: '' })
  const [newSub,   setNewSub]   = useState({ name_en: '', name_zh: '' })
  const [saving,   setSaving]   = useState(false)

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (selected) {
      supabase.from('sub_categories').select('*').eq('main_category_id', selected).order('display_order')
        .then(({ data }) => setSubCats(data || []))
    }
  }, [selected])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('main_categories').select('*').order('display_order')
    setMainCats(data || [])
    setLoading(false)
  }

  async function approveMain(id) {
    await supabase.from('main_categories').update({ status: 'active' }).eq('id', id)
    setMainCats(prev => prev.map(c => c.id === id ? { ...c, status: 'active' } : c))
  }
  async function rejectMain(id) {
    await supabase.from('main_categories').update({ status: 'rejected' }).eq('id', id)
    setMainCats(prev => prev.map(c => c.id === id ? { ...c, status: 'rejected' } : c))
  }
  async function approveSub(id) {
    await supabase.from('sub_categories').update({ status: 'active' }).eq('id', id)
    setSubCats(prev => prev.map(c => c.id === id ? { ...c, status: 'active' } : c))
  }
  async function rejectSub(id) {
    await supabase.from('sub_categories').update({ status: 'rejected' }).eq('id', id)
    setSubCats(prev => prev.map(c => c.id === id ? { ...c, status: 'rejected' } : c))
  }

  async function addMain() {
    if (!newMain.name_en.trim()) return
    setSaving(true)
    const slug = newMain.name_en.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now()
    const { data } = await supabase.from('main_categories').insert({
      ...newMain, name_zh: newMain.name_zh || newMain.name_en, slug, status: 'active', display_order: mainCats.length + 1,
    }).select().single()
    if (data) setMainCats(prev => [...prev, data])
    setNewMain({ name_en: '', name_zh: '' })
    setSaving(false)
  }

  async function addSub() {
    if (!newSub.name_en.trim() || !selected) return
    setSaving(true)
    const slug = newSub.name_en.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now()
    const { data } = await supabase.from('sub_categories').insert({
      ...newSub, name_zh: newSub.name_zh || newSub.name_en, slug, status: 'active',
      main_category_id: selected, display_order: subCats.length + 1,
    }).select().single()
    if (data) setSubCats(prev => [...prev, data])
    setNewSub({ name_en: '', name_zh: '' })
    setSaving(false)
  }

  const pending = mainCats.filter(c => c.status === 'pending')

  return (
    <div className="space-y-6">
      {/* Pending suggestions banner */}
      {pending.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="font-medium text-yellow-800 mb-3">{t('admin.pendingCategories')} ({pending.length})</p>
          <div className="space-y-2">
            {pending.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-yellow-100">
                <span className="text-sm text-gray-700">{c.name_en} / {c.name_zh}</span>
                <div className="flex gap-2">
                  <button onClick={() => approveMain(c.id)} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-lg">{t('admin.approveCategory')}</button>
                  <button onClick={() => rejectMain(c.id)} className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-lg">{t('admin.rejectCategory')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Main categories */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800">Main Categories</div>
          {loading ? <div className="py-8 text-center text-gray-400">{t('common.loading')}</div> : (
            <div>
              <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                {mainCats.filter(c => c.status !== 'rejected').map(c => (
                  <div key={c.id}
                    onClick={() => setSelected(c.id)}
                    className={`px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors ${selected === c.id ? 'bg-brand-50' : ''}`}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{c.name_en}</p>
                      <p className="text-xs text-gray-400">{c.name_zh}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.status === 'pending' && (
                        <>
                          <button onClick={e => { e.stopPropagation(); approveMain(c.id) }} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">{t('admin.approveCategory')}</button>
                          <button onClick={e => { e.stopPropagation(); rejectMain(c.id) }} className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">{t('admin.rejectCategory')}</button>
                        </>
                      )}
                      {selected === c.id && <span className="text-brand-500 text-xs">→</span>}
                    </div>
                  </div>
                ))}
              </div>
              {/* Add new main */}
              <div className="px-4 py-3 border-t border-gray-100 space-y-2">
                <input value={newMain.name_en} onChange={e => setNewMain(f=>({...f,name_en:e.target.value}))} placeholder="Name (English) *" className="w-full border rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500 outline-none" />
                <input value={newMain.name_zh} onChange={e => setNewMain(f=>({...f,name_zh:e.target.value}))} placeholder="名称（中文）" className="w-full border rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500 outline-none" />
                <button onClick={addMain} disabled={saving||!newMain.name_en.trim()} className="w-full text-sm bg-brand-600 text-white py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-50">+ Add Category</button>
              </div>
            </div>
          )}
        </div>

        {/* Sub categories */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800">
            Sub-Categories {selected && <span className="text-gray-400 font-normal text-sm ml-1">of "{mainCats.find(c=>c.id===selected)?.name_en}"</span>}
          </div>
          {!selected ? (
            <div className="py-8 text-center text-gray-400 text-sm">← Select a main category</div>
          ) : (
            <div>
              <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                {subCats.filter(c => c.status !== 'rejected').map(c => (
                  <div key={c.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                    <div>
                      <p className="text-sm text-gray-800">{c.name_en}</p>
                      <p className="text-xs text-gray-400">{c.name_zh}</p>
                    </div>
                    {c.status === 'pending' && (
                      <div className="flex gap-2">
                        <button onClick={() => approveSub(c.id)} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">{t('admin.approveCategory')}</button>
                        <button onClick={() => rejectSub(c.id)} className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">{t('admin.rejectCategory')}</button>
                      </div>
                    )}
                  </div>
                ))}
                {subCats.length === 0 && <div className="py-6 text-center text-gray-400 text-sm">No sub-categories yet</div>}
              </div>
              <div className="px-4 py-3 border-t border-gray-100 space-y-2">
                <input value={newSub.name_en} onChange={e => setNewSub(f=>({...f,name_en:e.target.value}))} placeholder="Name (English) *" className="w-full border rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500 outline-none" />
                <input value={newSub.name_zh} onChange={e => setNewSub(f=>({...f,name_zh:e.target.value}))} placeholder="名称（中文）" className="w-full border rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500 outline-none" />
                <button onClick={addSub} disabled={saving||!newSub.name_en.trim()} className="w-full text-sm bg-brand-600 text-white py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-50">+ Add Sub-Category</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
