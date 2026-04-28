import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// ── Storage helpers ───────────────────────────────────────────

export function getUploadPath(supplierId, fileType, filename) {
  const folder = fileType === 'video' ? 'videos'
               : fileType === 'image' ? 'images'
               : fileType === 'pricelist' ? 'pricelists'
               : 'documents'
  const ext   = filename.split('.').pop()
  const ts    = Date.now()
  const rand  = Math.random().toString(36).slice(2, 7)
  return `${supplierId}/${folder}/${ts}_${rand}.${ext}`
}

export function getSalesUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from('sales').getPublicUrl(path)
  return data.publicUrl
}

export async function getUploadSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from('uploads')
    .createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

// ── Role helpers ──────────────────────────────────────────────

export async function getSessionRole(userId) {
  // Primary check: role in Auth user metadata (set via SQL, embedded in JWT)
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.user_metadata?.role === 'admin') {
    return { role: 'admin' }
  }

  // Fallback: check suppliers table
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('status, supplier_code')
    .eq('id', userId)
    .maybeSingle()
  if (supplier) return { role: 'supplier', ...supplier }

  return null
}
