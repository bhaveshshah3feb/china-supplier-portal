import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login            from './components/auth/Login'
import Register         from './components/auth/Register'
import Verify           from './components/auth/Verify'
import SupplierDashboard from './components/dashboard/SupplierDashboard'
import AdminLogin       from './components/admin/AdminLogin'
import AdminDashboard   from './components/admin/AdminDashboard'
import ProtectedRoute   from './components/common/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/"              element={<Navigate to="/login" replace />} />
        <Route path="/login"         element={<Login />} />
        <Route path="/register"      element={<Register />} />
        <Route path="/verify"        element={<Verify />} />
        <Route path="/admin/login"   element={<AdminLogin />} />

        {/* Supplier protected */}
        <Route path="/dashboard" element={
          <ProtectedRoute requireRole="supplier"><SupplierDashboard /></ProtectedRoute>
        } />
        <Route path="/uploads" element={
          <ProtectedRoute requireRole="supplier"><SupplierDashboard /></ProtectedRoute>
        } />

        {/* Admin protected */}
        <Route path="/admin/dashboard" element={
          <ProtectedRoute requireRole="admin"><AdminDashboard /></ProtectedRoute>
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
