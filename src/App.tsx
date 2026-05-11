import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import Login from '@/routes/Login'
import ProjectsPage from '@/routes/projects/index'
import NewProjectPage from '@/routes/projects/new'
import ProjectDetailPage from '@/routes/projects/detail'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-background" />
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/projects"
            element={<ProtectedRoute><ProjectsPage /></ProtectedRoute>}
          />
          <Route
            path="/projects/new"
            element={<ProtectedRoute><NewProjectPage /></ProtectedRoute>}
          />
          <Route
            path="/projects/:id"
            element={<ProtectedRoute><ProjectDetailPage /></ProtectedRoute>}
          />
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
