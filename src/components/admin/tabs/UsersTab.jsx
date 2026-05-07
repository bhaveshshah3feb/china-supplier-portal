import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

const MODULES = [
  { key: 'overview',   label: 'Overview',       icon: '📊' },
  { key: 'library',    label: 'Sales Library',  icon: '✅' },
  { key: 'whatsapp',   label: 'WhatsApp',        icon: '💬' },
  { key: 'rename',     label: 'Rename / Edit',  icon: '✏️'  },
  { key: 'suppliers',  label: 'Suppliers',       icon: '🏭' },
  { key: 'uploads',    label: 'Uploads',         icon: '📁' },
  { key: 'processing', label: 'Processing',      icon: '⚙️'  },
  { key: 'categories', label: 'Categories',      icon: '🗂️'  },
  { key: 'logs',       label: 'Logs',            icon: '📋' },
  { key: 'settings',   label: 'Settings',        icon: '⚙'  },
]

const PRESETS = {
  sales:      { library: true, whatsapp: true },
  operations: { uploads: true, processing: true, logs: true, categories: true },
  manager:    { overview: true, library: true, whatsapp: true, rename: true, suppliers: true, uploads: true, processing: true, logs: true },
  full:       Object.fromEntries(MODULES.map(m => [m.key, true])),
}

const DEFAULT_PERMS = Object.fromEntries(MODULES.map(m => [m.key, false]))

const STATUS_BADGE = {
  invited:  'bg-amber-100 text-amber-700',
  active:   'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
}

function permCount(p) { return Object.values(p || {}).filter(Boolean).length }

// ── Permissions Editor ────────────────────────────────────
function PermissionsEditor({ permissions, onChange }) {
  const perms = { ...DEFAULT_PERMS, ...permissions }

  function applyPreset(name) {
    onChange({ ...DEFAULT_PERMS, ...PRESETS[name] })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1.5">Quick Presets</label>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'sales',      label: 'Sales (Library + WhatsApp)' },
            { key: 'operations', label: 'Operations (Uploads + Processing)' },
            { key: 'manager',    label: 'Manager (Most tabs)' },
            { key: 'full',       label: 'Full Access' },
          ].map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className="text-xs bg-gray-100 hover:bg-blue-100 hover:text-blue-700 text-gray-600 px-3 py-1 rounded-lg transition-colors">
              {p.label}
            </button>
          ))}
          <button onClick={() => onChange(DEFAULT_PERMS)}
            className="text-xs bg-gray-100 hover:bg-red-100 hover:text-red-600 text-gray-500 px-3 py-1 rounded-lg transition-colors">
            Clear All
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {MODULES.map(m => (
          <label key={m.key}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors text-sm
              ${perms[m.key] ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
            <input type="checkbox" checked={!!perms[m.key]}
              onChange={e => onChange({ ...perms, [m.key]: e.target.checked })}
              className="accent-blue-600" />
            <span>{m.icon}</span>
            <span className="text-xs font-medium">{m.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Invite Modal ──────────────────────────────────────────
function InviteModal({ onClose, onInvited }) {
  const [form, setForm]       = useState({ name: '', email: '', role: 'staff' })
  const [perms, setPerms]     = useState(DEFAULT_PERMS)
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState('')

  async function submit(e) {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ ...form, permissions: perms }),
      })
      const body = await res.json()
      if (!body.ok) { setError(body.error || 'Failed to send invite'); return }
      onInvited()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="font-semibold text-gray-800">Invite New User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto p-6 space-y-5">

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Full Name</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="John Smith"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Email Address</label>
              <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="john@example.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Role</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'staff',    label: 'Staff',    desc: 'Internal team member with customisable module access', icon: '👤' },
                { value: 'supplier', label: 'Supplier', desc: 'Supplier company — gets access to upload portal', icon: '🏭' },
              ].map(r => (
                <label key={r.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors
                    ${form.role === r.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-200'}`}>
                  <input type="radio" name="role" value={r.value} checked={form.role === r.value}
                    onChange={() => setForm(f => ({ ...f, role: r.value }))} className="mt-0.5 accent-blue-600" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{r.icon} {r.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{r.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {form.role === 'staff' && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Module Access <span className="text-xs text-gray-400 font-normal">({permCount(perms)} modules selected)</span>
              </label>
              <PermissionsEditor permissions={perms} onChange={setPerms} />
            </div>
          )}

          {form.role === 'supplier' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
              The supplier will receive an email invite and get access to the upload portal.
              Their account will be <strong>activated immediately</strong> (no admin approval needed).
            </div>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={sending}
              className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {sending ? 'Sending Invite…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Permissions Edit Modal ────────────────────────────────
function EditPermissionsModal({ user, onClose, onSaved }) {
  const [perms, setPerms]     = useState({ ...DEFAULT_PERMS, ...(user.permissions || {}) })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/invite-user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ id: user.id, permissions: perms }),
      })
      const body = await res.json()
      if (!body.ok) { setError(body.error || 'Failed to save'); return }
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-800">Edit Permissions — {user.name}</h2>
            <p className="text-xs text-gray-400">{user.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <PermissionsEditor permissions={perms} onChange={setPerms} />
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Tab ──────────────────────────────────────────────
export default function UsersTab() {
  const [users, setUsers]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('all')
  const [showInvite, setShowInvite] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [actionLoading, setActionLoading] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('staff_users')
      .select('*')
      .order('created_at', { ascending: false })
    setUsers(data || [])
    setLoading(false)
  }

  async function toggleStatus(user) {
    const newStatus = user.status === 'inactive' ? 'active' : 'inactive'
    setActionLoading(user.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/invite-user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ id: user.id, status: newStatus }),
      })
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: newStatus } : u))
    } finally {
      setActionLoading(null)
    }
  }

  async function resendInvite(user) {
    setActionLoading(user.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ name: user.name, email: user.email, role: user.role, permissions: user.permissions }),
      })
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = users.filter(u => {
    if (filter === 'all')      return true
    if (filter === 'staff')    return u.role === 'staff'
    if (filter === 'supplier') return u.role === 'supplier'
    if (filter === 'active')   return u.status === 'active'
    if (filter === 'invited')  return u.status === 'invited'
    return true
  })

  const counts = {
    all:      users.length,
    staff:    users.filter(u => u.role === 'staff').length,
    supplier: users.filter(u => u.role === 'supplier').length,
    active:   users.filter(u => u.status === 'active').length,
    invited:  users.filter(u => u.status === 'invited').length,
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Team Members</h2>
          <p className="text-sm text-gray-500 mt-0.5">{counts.all} users · {counts.active} active · {counts.invited} pending</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2">
          + Invite User
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'all',      label: `All (${counts.all})` },
          { key: 'staff',    label: `Staff (${counts.staff})` },
          { key: 'supplier', label: `Suppliers (${counts.supplier})` },
          { key: 'active',   label: `Active (${counts.active})` },
          { key: 'invited',  label: `Pending (${counts.invited})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors
              ${filter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* User list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-4xl mb-3">👥</p>
            <p className="font-medium text-gray-500">No users yet</p>
            <p className="text-sm mt-1">Click "Invite User" to add your first team member</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(user => (
              <div key={user.id} className={`p-4 flex items-start gap-4 ${user.status === 'inactive' ? 'opacity-60' : ''}`}>

                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0
                  ${user.role === 'staff' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                  {user.name.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-800 text-sm">{user.name}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium
                      ${user.role === 'staff' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {user.role === 'staff' ? '👤 Staff' : '🏭 Supplier'}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[user.status]}`}>
                      {user.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>

                  {/* Permissions (staff only) */}
                  {user.role === 'staff' && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {MODULES.filter(m => user.permissions?.[m.key]).map(m => (
                        <span key={m.key} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {m.icon} {m.label}
                        </span>
                      ))}
                      {permCount(user.permissions) === 0 && (
                        <span className="text-[10px] text-gray-400 italic">No modules assigned</span>
                      )}
                    </div>
                  )}

                  {user.last_login && (
                    <p className="text-[10px] text-gray-300 mt-1">
                      Last login: {new Date(user.last_login).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                  {user.role === 'staff' && (
                    <button onClick={() => setEditingUser(user)}
                      disabled={actionLoading === user.id}
                      className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors">
                      Edit Access
                    </button>
                  )}
                  {user.status === 'invited' && (
                    <button onClick={() => resendInvite(user)}
                      disabled={actionLoading === user.id}
                      className="text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-colors">
                      Resend Invite
                    </button>
                  )}
                  <button onClick={() => toggleStatus(user)}
                    disabled={actionLoading === user.id}
                    className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors
                      ${user.status === 'inactive'
                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                        : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                    {actionLoading === user.id ? '…' : user.status === 'inactive' ? 'Activate' : 'Deactivate'}
                  </button>
                </div>

              </div>
            ))}
          </div>
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onInvited={load} />}
      {editingUser && <EditPermissionsModal user={editingUser} onClose={() => setEditingUser(null)} onSaved={load} />}

    </div>
  )
}
