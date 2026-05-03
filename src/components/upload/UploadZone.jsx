import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { enqueue, detectFileType } from '../../lib/uploadManager'
import { getUploadPath } from '../../lib/supabase'
import CategorySelect from './CategorySelect'

const ACCEPT = [
  'video/mp4','video/quicktime','video/x-msvideo','video/x-matroska',
  'video/x-flv','video/x-ms-wmv','video/webm',
  'image/jpeg','image/png','image/gif','image/webp','image/bmp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel','text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]
// accept string for the file input — tells mobile pickers what to show
const ACCEPT_ATTR = 'video/*,image/*,application/pdf,.xlsx,.xls,.csv,.docx,.doc'

export default function UploadZone({ onUploadsStarted }) {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const [files, setFiles]       = useState([])
  const [category, setCategory] = useState({ mainCategoryId: null, subCategoryId: null })
  const [error, setError]       = useState('')

  const addFiles = useCallback((incoming) => {
    const valid = Array.from(incoming).filter(f => ACCEPT.includes(f.type))
    setFiles(prev => [...prev, ...valid.map(f => ({ file: f, id: `${f.name}-${f.size}-${Date.now()}` }))])
  }, [])

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  async function startUploads() {
    if (!category.mainCategoryId) { setError(t('upload.categoryRequired')); return }
    if (files.length === 0) return
    setError('')

    const { data: { session } } = await supabase.auth.getSession()
    const { data: { user } }    = await supabase.auth.getUser()
    const accessToken = session?.access_token

    for (const { file, id } of files) {
      const fileType    = detectFileType(file)
      const storagePath = getUploadPath(user.id, fileType, file.name)

      const { data: record } = await supabase.from('uploads').insert({
        supplier_id:       user.id,
        original_filename: file.name,
        file_type:         fileType,
        mime_type:         file.type,
        file_size:         file.size,
        storage_path:      storagePath,
        upload_status:     'uploading',
        processing_status: 'pending',
        main_category_id:  category.mainCategoryId,
        sub_category_id:   category.subCategoryId,
      }).select().single()

      enqueue({ uploadId: id, file, storagePath, accessToken, dbId: record?.id, supplierId: user.id, category })
    }

    if (onUploadsStarted) onUploadsStarted(files.length)
    setFiles([])
    setCategory({ mainCategoryId: null, subCategoryId: null })
  }

  return (
    <div className="space-y-5">
      {/* Drop Zone — drag handles drop, label handles tap on mobile */}
      <label
        htmlFor="file-upload-input"
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
          ${dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'}`}
      >
        <div className="text-5xl mb-3">📁</div>
        <p className="text-lg font-medium text-gray-700">{t('upload.dragDrop')}</p>
        <p className="text-sm text-gray-500 mt-1">{t('upload.dragDropSub')}</p>
        <span className="mt-4 inline-block px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
          {t('upload.selectFiles')}
        </span>
        {/* Hidden input — label click triggers it natively on mobile */}
        <input
          id="file-upload-input"
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="sr-only"
          onChange={e => { addFiles(e.target.files); e.target.value = '' }}
        />
      </label>

      {/* Staged files */}
      {files.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium text-gray-700">{t('upload.totalFiles', { count: files.length })}</h3>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {files.map(({ file, id }) => (
              <div key={id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg">{detectFileType(file) === 'video' ? '🎬' : detectFileType(file) === 'image' ? '🖼️' : '📄'}</span>
                  <span className="text-sm text-gray-700 truncate">{file.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
                <button onClick={() => removeFile(id)} className="text-gray-400 hover:text-red-500 ml-2 text-lg leading-none">×</button>
              </div>
            ))}
          </div>

          <CategorySelect value={category} onChange={setCategory} />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={startUploads}
            className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors"
          >
            {t('upload.startUpload')} ({files.length} {files.length === 1 ? 'file' : 'files'})
          </button>
        </div>
      )}
    </div>
  )
}
