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

export function getSalesUrl(path, { download = false, filename = '' } = {}) {
  if (!path) return null
  const { data } = supabase.storage.from('sales').getPublicUrl(path, {
    download: download ? (filename || true) : false,
  })
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
  const { data: { user } } = await supabase.auth.getUser()

  // Admin — from JWT metadata
  if (user?.user_metadata?.role === 'admin') {
    return { role: 'admin' }
  }

  // Staff — from staff_users table (supports both invited and active)
  if (user?.user_metadata?.role === 'staff') {
    const { data: staff } = await supabase
      .from('staff_users')
      .select('permissions, name, email, status')
      .eq('auth_user_id', userId)
      .in('status', ['active', 'invited'])
      .maybeSingle()
    if (staff) {
      // Activate on first real login
      if (staff.status === 'invited') {
        supabase.from('staff_users')
          .update({ status: 'active', last_login: new Date().toISOString() })
          .eq('auth_user_id', userId)
          .then(() => {})
      } else {
        supabase.from('staff_users')
          .update({ last_login: new Date().toISOString() })
          .eq('auth_user_id', userId)
          .then(() => {})
      }
      return { role: 'staff', permissions: staff.permissions || {}, name: staff.name }
    }
  }

  // Supplier — from suppliers table
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('status, supplier_code')
    .eq('id', userId)
    .maybeSingle()
  if (supplier) return { role: 'supplier', ...supplier }

  return null
}
