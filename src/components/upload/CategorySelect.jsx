import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'

export default function CategorySelect({ value, onChange }) {
  const { t } = useTranslation()
  const [mainCats, setMainCats]   = useState([])
  const [subCats, setSubCats]     = useState([])
  const [suggestMain, setSuggestMain] = useState(false)
  const [suggestSub,  setSuggestSub]  = useState(false)
  const [newMainEn, setNewMainEn] = useState('')
  const [newMainZh, setNewMainZh] = useState('')
  const [newSubEn,  setNewSubEn]  = useState('')
  const [newSubZh,  setNewSubZh]  = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('main_categories').select('*').eq('status', 'active').order('display_order')
      .then(({ data }) => setMainCats(data || []))
  }, [])

  useEffect(() => {
    if (!value.mainCategoryId) { setSubCats([]); return }
    supabase.from('sub_categories')
      .select('*').eq('main_category_id', value.mainCategoryId).eq('status', 'active').order('display_order')
      .then(({ data }) => setSubCats(data || []))
  }, [value.mainCategoryId])

  async function suggestMainCategory() {
    if (!newMainEn.trim()) return
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const slug = newMainEn.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now()
    const { data, error } = await supabase.from('main_categories').insert({
      name_en: newMainEn, name_zh: newMainZh || newMainEn,
      slug, status: 'pending', suggested_by: user.id,
    }).select().single()
    if (!error && data) {
      onChange({ mainCategoryId: data.id, subCategoryId: null })
      setSuggestMain(false); setNewMainEn(''); setNewMainZh('')
    }
    setSubmitting(false)
  }

  async function suggestSubCategory() {
    if (!newSubEn.trim() || !value.mainCategoryId) return
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const slug = newSubEn.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now()
    const { data, error } = await supabase.from('sub_categories').insert({
      name_en: newSubEn, name_zh: newSubZh || newSubEn,
      slug, status: 'pending', suggested_by: user.id,
      main_category_id: value.mainCategoryId,
    }).select().single()
    if (!error && data) {
      onChange({ ...value, subCategoryId: data.id })
      setSuggestSub(false); setNewSubEn(''); setNewSubZh('')
    }
    setSubmitting(false)
  }

  const lang = document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en'
  const nameKey = lang === 'zh' ? 'name_zh' : 'name_en'

  return (
    <div className="space-y-3">
      {/* Main Category */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('upload.selectCategory')} <span className="text-red-500">*</span>
        </label>
        {!suggestMain ? (
          <select
            value={value.mainCategoryId || ''}
            onChange={e => {
              const v = e.target.value
              if (v === '__suggest__') { setSuggestMain(true); return }
              onChange({ mainCategoryId: v || null, subCategoryId: null })
            }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          >
            <option value="">{t('upload.selectCategory')}</option>
            {mainCats.map(c => (
              <option key={c.id} value={c.id}>{c[nameKey]}</option>
            ))}
            <option value="__suggest__">➕ {t('upload.suggestCategory')}</option>
          </select>
        ) : (
          <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 space-y-2">
            <input className="w-full border rounded px-2 py-1 text-sm" placeholder="Category name (English) *" value={newMainEn} onChange={e => setNewMainEn(e.target.value)} />
            <input className="w-full border rounded px-2 py-1 text-sm" placeholder="类别名称（中文）" value={newMainZh} onChange={e => setNewMainZh(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={suggestMainCategory} disabled={submitting || !newMainEn.trim()} className="text-xs bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50">Submit</button>
              <button onClick={() => setSuggestMain(false)} className="text-xs text-gray-600 px-3 py-1 rounded border">Cancel</button>
            </div>
            <p className="text-xs text-blue-700">Your suggestion will be reviewed by admin before appearing.</p>
          </div>
        )}
      </div>

      {/* Sub Category */}
      {value.mainCategoryId && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('upload.selectSubCategory')}
          </label>
          {!suggestSub ? (
            <select
              value={value.subCategoryId || ''}
              onChange={e => {
                const v = e.target.value
                if (v === '__suggest__') { setSuggestSub(true); return }
                onChange({ ...value, subCategoryId: v || null })
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            >
              <option value="">— {t('upload.selectSubCategory')} —</option>
              {subCats.map(c => (
                <option key={c.id} value={c.id}>{c[nameKey]}</option>
              ))}
              <option value="__suggest__">➕ {t('upload.suggestSubCategory')}</option>
            </select>
          ) : (
            <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 space-y-2">
              <input className="w-full border rounded px-2 py-1 text-sm" placeholder="Sub-category name (English) *" value={newSubEn} onChange={e => setNewSubEn(e.target.value)} />
              <input className="w-full border rounded px-2 py-1 text-sm" placeholder="子类别名称（中文）" value={newSubZh} onChange={e => setNewSubZh(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={suggestSubCategory} disabled={submitting || !newSubEn.trim()} className="text-xs bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50">Submit</button>
                <button onClick={() => setSuggestSub(false)} className="text-xs text-gray-600 px-3 py-1 rounded border">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
