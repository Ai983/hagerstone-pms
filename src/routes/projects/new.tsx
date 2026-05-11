import { useAuth } from '@/lib/auth'
import { Layout } from '@/components/Layout'
import { Stage1ProjectCreation } from '@/components/stages/Stage1ProjectCreation'
import { Navigate } from 'react-router-dom'

export default function NewProjectPage() {
  const { isFounder, isTeamHead, loading } = useAuth()

  if (loading) return null

  // Only founders and team heads can create projects
  if (!isFounder && !isTeamHead) {
    return <Navigate to="/projects" replace />
  }

  return (
    <Layout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">New Project</h1>
          <p className="text-sm text-muted-foreground mt-1">Stage 1 — Project Creation</p>
        </div>
        <Stage1ProjectCreation />
      </div>
    </Layout>
  )
}
