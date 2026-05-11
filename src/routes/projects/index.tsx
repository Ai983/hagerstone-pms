import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, FolderOpen, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Layout } from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { STAGE_LABELS, stageVariant } from '@/lib/stages'
import type { DesignProject, ProjectStage } from '@/lib/types'

interface ProjectRow extends DesignProject {
  lead_designer_name: string | null
  open_tasks: number
}

export default function ProjectsPage() {
  const { isFounder, isTeamHead, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    const { data, error } = await supabase
      .from('design_projects')
      .select(`
        *,
        design_project_members!inner(user_id, role)
      `)
      .is('archived_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to load projects', error)
      setLoading(false)
      return
    }

    setProjects((data ?? []).map((p: DesignProject & { design_project_members: Array<{user_id: string; role: string}> }) => ({
      ...p,
      lead_designer_name: null,   // enriched lazily below
      open_tasks: 0,
    })))
    setLoading(false)
  }

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="p-8">
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-lg bg-surface animate-pulse" />
            ))}
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Projects</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {projects.length === 0
                ? 'No active projects'
                : `${projects.length} active project${projects.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          {(isFounder || isTeamHead) && (
            <Button onClick={() => navigate('/projects/new')}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Project
            </Button>
          )}
        </div>

        {projects.length === 0 ? (
          <EmptyState canCreate={isFounder || isTeamHead} />
        ) : (
          <div className="space-y-2">
            {projects.map(project => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const stage = project.current_stage as ProjectStage
  const label = STAGE_LABELS[stage]
  const variant = stageVariant(stage)

  return (
    <Link to={`/projects/${project.id}`}>
      <Card className="p-4 hover:border-accent-500/40 transition-colors cursor-pointer group">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-8 w-8 rounded-md bg-accent-500/10 flex items-center justify-center flex-shrink-0">
              <FolderOpen className="h-4 w-4 text-accent-400" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm truncate group-hover:text-accent-400 transition-colors">
                {project.project_name}
              </p>
              <p className="text-xs text-muted-foreground truncate">{project.client_name}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <Badge variant={variant} className="text-xs">
              {stage}. {label}
            </Badge>
            <StageIcon stage={stage} />
            <time className="text-xs text-muted-foreground hidden sm:block">
              {new Date(project.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </time>
          </div>
        </div>
      </Card>
    </Link>
  )
}

function StageIcon({ stage }: { stage: ProjectStage }) {
  if (stage === 11) return <CheckCircle2 className="h-4 w-4 text-success" />
  if (stage === 4 || stage === 10) return <AlertCircle className="h-4 w-4 text-warning" />
  return <Clock className="h-4 w-4 text-muted-foreground" />
}

function EmptyState({ canCreate }: { canCreate: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-12 w-12 rounded-full bg-surface border border-border flex items-center justify-center mb-4">
        <FolderOpen className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">No projects yet</p>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        {canCreate ? 'Create your first design project to get started.' : 'You have not been assigned to any projects yet.'}
      </p>
      {canCreate && (
        <Button size="sm" onClick={() => navigate('/projects/new')}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Project
        </Button>
      )}
    </div>
  )
}
