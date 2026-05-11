import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, Users, Building2, GitBranch, UserPlus, Trash2, Shield } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Layout } from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { STAGE_LABELS, STAGE_EXIT_CONDITIONS, stageVariant, checkStageTransition } from '@/lib/stages'
import type { DesignProject, DesignStageLog, ProjectStage } from '@/lib/types'

interface MemberRow {
  id: string
  user_id: string
  role: 'lead' | 'support'
  added_by: string
  created_at: string
  email: string
}

interface AvailableDesigner {
  id: string
  email: string
  full_name: string | null
}

interface ProjectDetail extends DesignProject {
  members: MemberRow[]
  stage_log: DesignStageLog[]
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, roles, isFounder, isTeamHead } = useAuth()

  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)

  // Member management state
  const [addOpen, setAddOpen] = useState(false)
  const [available, setAvailable] = useState<AvailableDesigner[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState<'lead' | 'support'>('support')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const canManageTeam = isFounder || isTeamHead

  useEffect(() => {
    if (id) loadProject(id)
  }, [id])

  async function loadProject(projectId: string) {
    const [{ data: proj }, { data: rawMembers }, { data: log }] = await Promise.all([
      supabase.from('design_projects').select('*').eq('id', projectId).single(),
      supabase.from('design_project_members').select('*').eq('project_id', projectId),
      supabase
        .from('design_stage_log')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    if (!proj) { navigate('/projects'); return }

    // Enrich members with emails
    const memberIds = (rawMembers ?? []).map((m: { user_id: string }) => m.user_id)
    let emailMap: Record<string, string> = {}
    if (memberIds.length > 0) {
      const { data: profiles } = await supabase
        .from('design_user_profiles_view')
        .select('id, email')
        .in('id', memberIds)
      ;(profiles ?? []).forEach((p: { id: string; email: string }) => { emailMap[p.id] = p.email })
    }

    const members: MemberRow[] = (rawMembers ?? []).map((m: {
      id: string; user_id: string; role: 'lead' | 'support'; added_by: string; created_at: string
    }) => ({
      ...m,
      email: emailMap[m.user_id] ?? m.user_id.slice(0, 8) + '…',
    }))

    setProject({ ...proj, members, stage_log: log ?? [] })
    setLoading(false)
  }

  async function loadAvailableDesigners(_projectId: string, currentMembers: MemberRow[]) {
    const currentIds = currentMembers.map(m => m.user_id)

    const { data: allDesigners } = await supabase
      .from('design_user_roles')
      .select('user_id')
      .eq('role', 'designer')

    const designerIds = (allDesigners ?? [])
      .map((r: { user_id: string }) => r.user_id)
      .filter((uid: string) => !currentIds.includes(uid))

    if (designerIds.length === 0) { setAvailable([]); return }

    const { data: profiles } = await supabase
      .from('design_user_profiles_view')
      .select('id, email, full_name')
      .in('id', designerIds)

    setAvailable(profiles ?? [])
  }

  async function openAddDialog() {
    if (!project) return
    await loadAvailableDesigners(project.id, project.members)
    setSelectedUserId('')
    setSelectedRole('support')
    setAddOpen(true)
  }

  async function addMember() {
    if (!project || !user || !selectedUserId) return
    setAdding(true)

    const { error } = await supabase.from('design_project_members').insert({
      project_id: project.id,
      user_id: selectedUserId,
      role: selectedRole,
      added_by: user.id,
    })

    if (error) { alert(error.message); setAdding(false); return }

    // Alert the new member
    await supabase.from('design_alerts').insert({
      project_id: project.id,
      alert_type: 'member_added',
      recipient_role: 'designer',
      recipient_id: selectedUserId,
      payload: {
        project_name: project.project_name,
        role: selectedRole,
        added_by_email: user.email,
      },
    })

    // Refresh project
    await loadProject(project.id)
    setAddOpen(false)
    setAdding(false)
  }

  async function removeMember(memberId: string, memberUserId: string) {
    if (!project || !user) return
    if (!confirm('Remove this designer from the project?')) return
    setRemoving(memberId)

    await supabase.from('design_project_members').delete().eq('id', memberId)

    // Alert the removed member
    await supabase.from('design_alerts').insert({
      project_id: project.id,
      alert_type: 'member_removed',
      recipient_role: 'designer',
      recipient_id: memberUserId,
      payload: { project_name: project.project_name },
    })

    await loadProject(project.id)
    setRemoving(null)
  }

  async function changeRole(memberId: string, memberUserId: string, newRole: 'lead' | 'support') {
    if (!project || !user) return
    await supabase.from('design_project_members').update({ role: newRole }).eq('id', memberId)

    await supabase.from('design_alerts').insert({
      project_id: project.id,
      alert_type: 'member_role_changed',
      recipient_role: 'designer',
      recipient_id: memberUserId,
      payload: { project_name: project.project_name, new_role: newRole },
    })

    setProject(prev => prev
      ? { ...prev, members: prev.members.map(m => m.id === memberId ? { ...m, role: newRole } : m) }
      : prev
    )
  }

  async function advanceStage() {
    if (!project || !user) return
    const currentRole = roles[0]
    const isAssigned = project.members.some(m => m.user_id === user.id)
    const targetStage = (project.current_stage + 1) as ProjectStage

    const check = checkStageTransition({
      currentStage: project.current_stage as ProjectStage,
      targetStage,
      actorRole: currentRole,
      isAssignedMember: isAssigned,
    })
    if (!check.ok) { alert(`Cannot advance: ${JSON.stringify(check.error)}`); return }

    setAdvancing(true)
    await supabase.from('design_stage_log').insert({
      project_id: project.id,
      from_stage: project.current_stage,
      to_stage: targetStage,
      actor_id: user.id,
    })
    await supabase.from('design_projects').update({ current_stage: targetStage }).eq('id', project.id)

    // Notify all project members of stage change
    const alerts = project.members.map(m => ({
      project_id: project.id,
      alert_type: 'stage_advanced',
      recipient_role: m.role === 'lead' ? 'designer' : 'designer',
      recipient_id: m.user_id,
      payload: {
        project_name: project.project_name,
        from_stage: project.current_stage,
        to_stage: targetStage,
        stage_label: STAGE_LABELS[targetStage],
      },
    }))
    if (alerts.length > 0) await supabase.from('design_alerts').insert(alerts)

    setProject(prev => prev ? { ...prev, current_stage: targetStage } : prev)
    setAdvancing(false)
  }

  if (loading) {
    return (
      <Layout>
        <div className="p-8 space-y-4">
          <div className="h-8 w-48 rounded bg-surface animate-pulse" />
          <div className="h-40 rounded-lg bg-surface animate-pulse" />
        </div>
      </Layout>
    )
  }

  if (!project) return null

  const stage = project.current_stage as ProjectStage
  const variant = stageVariant(stage)
  const isAssignedMember = project.members.some(m => m.user_id === user?.id)
  const canAdvance = stage < 11 && (isFounder || isTeamHead || isAssignedMember)
  const leadCount = project.members.filter(m => m.role === 'lead').length

  return (
    <Layout>
      <div className="p-8 max-w-3xl">
        {/* Back */}
        <button
          onClick={() => navigate('/projects')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All Projects
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{project.project_name}</h1>
            <div className="flex items-center gap-2 mt-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{project.client_name}</span>
              {project.client_contact && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-sm text-muted-foreground">{project.client_contact}</span>
                </>
              )}
            </div>
          </div>
          <Badge variant={variant} className="flex-shrink-0">
            Stage {stage} — {STAGE_LABELS[stage]}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
          {/* Stage card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                Current Stage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium text-foreground">{stage}. {STAGE_LABELS[stage]}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{STAGE_EXIT_CONDITIONS[stage]}</p>
              {canAdvance && (
                <Button size="sm" className="mt-3" onClick={advanceStage} disabled={advancing}>
                  {advancing ? 'Advancing…' : `→ Stage ${stage + 1}`}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Team card */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  Team ({project.members.length})
                </CardTitle>
                {canManageTeam && (
                  <button
                    onClick={openAddDialog}
                    className="flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300 transition-colors"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Add
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {project.members.length === 0 && (
                <p className="text-xs text-muted-foreground">No designers assigned yet.</p>
              )}
              {project.members.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {m.role === 'lead' && <Shield className="h-3 w-3 text-accent-400 flex-shrink-0" />}
                    <span className="text-sm text-foreground-secondary truncate">{m.email}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {canManageTeam ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => changeRole(m.id, m.user_id, v as 'lead' | 'support')}
                      >
                        <SelectTrigger className="h-6 text-xs px-2 w-20 border-border/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="lead">Lead</SelectItem>
                          <SelectItem value="support">Support</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary" className="text-xs capitalize">{m.role}</Badge>
                    )}
                    {canManageTeam && (
                      <button
                        onClick={() => removeMember(m.id, m.user_id)}
                        disabled={removing === m.id}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Stage log */}
        {project.stage_log.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {project.stage_log.map((log, i) => (
                  <div key={log.id}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground-secondary">
                        {log.from_stage == null ? 'Project created' : `Stage ${log.from_stage} → Stage ${log.to_stage}: ${STAGE_LABELS[log.to_stage as ProjectStage]}`}
                      </span>
                      <time className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </time>
                    </div>
                    {log.reason && <p className="text-xs text-muted-foreground mt-0.5">Reason: {log.reason}</p>}
                    {i < project.stage_log.length - 1 && <Separator className="mt-3" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Assign a designer to this project. They'll receive an in-app notification.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground-secondary">Designer</label>
              {available.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  All available designers are already on this project.
                </p>
              ) : (
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a designer…" />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map(d => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.full_name ?? d.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground-secondary">Role</label>
              <Select value={selectedRole} onValueChange={v => setSelectedRole(v as 'lead' | 'support')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">
                    <div>
                      <p className="font-medium">Lead Designer</p>
                      <p className="text-xs text-muted-foreground">Primary designer — can advance stages</p>
                    </div>
                  </SelectItem>
                  <SelectItem value="support">
                    <div>
                      <p className="font-medium">Support Designer</p>
                      <p className="text-xs text-muted-foreground">Assists lead — read access</p>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {selectedRole === 'lead' && leadCount > 0 && (
                <p className="text-xs text-warning">
                  ⚠ This project already has a lead designer. Adding another will create dual-leads.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addMember} disabled={adding || !selectedUserId}>
              {adding ? 'Adding…' : 'Add to Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  )
}
