import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { UserProfile } from '@/lib/types'

export function Stage1ProjectCreation() {
  const { user, isFounder, isTeamHead } = useAuth()
  const navigate = useNavigate()

  const [projectName, setProjectName] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientContact, setClientContact] = useState('')
  const [teamHeadId, setTeamHeadId] = useState('')
  const [leadDesignerId, setLeadDesignerId] = useState('')
  const [supportDesignerIds, setSupportDesignerIds] = useState<string[]>([])

  const [teamHeads, setTeamHeads] = useState<UserProfile[]>([])
  const [designers, setDesigners] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    // Load team heads
    const { data: thData } = await supabase
      .from('design_user_roles')
      .select('user_id, role')
      .eq('role', 'team_head')

    // Load designers
    const { data: dData } = await supabase
      .from('design_user_roles')
      .select('user_id, role')
      .eq('role', 'designer')

    // Fetch user emails via auth admin (using RPC or stored profile if available)
    const allUserIds = [
      ...(thData ?? []).map((r: { user_id: string }) => r.user_id),
      ...(dData ?? []).map((r: { user_id: string }) => r.user_id),
    ]

    if (allUserIds.length > 0) {
      let profiles: Array<{ id: string; email: string; full_name: string | null }> | null = null
      try {
        // design_user_profiles_view is a future migration; falls back gracefully
        const { data } = await supabase
          .from('design_user_profiles_view')
          .select('id, email, full_name')
          .in('id', allUserIds)
        profiles = data
      } catch {
        profiles = null
      }

      const makeProfile = (userId: string): UserProfile => {
        const p = profiles?.find(p => p.id === userId)
        return { id: userId, email: p?.email ?? userId.slice(0, 8) + '…', full_name: p?.full_name ?? null, roles: [] }
      }

      setTeamHeads((thData ?? []).map((r: { user_id: string }) => makeProfile(r.user_id)))
      setDesigners((dData ?? []).map((r: { user_id: string }) => makeProfile(r.user_id)))
    }

    // Default team_head to current user if they are one
    if (isTeamHead && user) setTeamHeadId(user.id)
    if (isFounder && user && !isTeamHead) setTeamHeadId(user.id)
  }

  function addSupportDesigner(id: string) {
    if (!id || id === leadDesignerId || supportDesignerIds.includes(id)) return
    setSupportDesignerIds(prev => [...prev, id])
  }

  function removeSupportDesigner(id: string) {
    setSupportDesignerIds(prev => prev.filter(d => d !== id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!leadDesignerId) { setError('A lead designer is required'); return }
    if (!teamHeadId) { setError('A team head is required'); return }

    setLoading(true)
    setError(null)

    // 1. Create the project
    const { data: project, error: projectError } = await supabase
      .from('design_projects')
      .insert({
        project_name: projectName.trim(),
        client_name: clientName.trim(),
        client_contact: clientContact.trim() || null,
        team_head_id: teamHeadId,
        created_by: user!.id,
        current_stage: 1,
      })
      .select('id')
      .single()

    if (projectError || !project) {
      setError(projectError?.message ?? 'Failed to create project')
      setLoading(false)
      return
    }

    // 2. Add lead designer member
    const members = [
      { project_id: project.id, user_id: leadDesignerId, role: 'lead', added_by: user!.id },
      ...supportDesignerIds.map(uid => ({
        project_id: project.id, user_id: uid, role: 'support', added_by: user!.id,
      })),
    ]

    const { error: membersError } = await supabase
      .from('design_project_members')
      .insert(members)

    if (membersError) {
      setError('Project created but failed to assign members: ' + membersError.message)
      setLoading(false)
      return
    }

    // 3. Log stage 1 (creation) and immediately auto-advance to Stage 2
    //    since Stage 1's exit condition (name + client + designer) is met on submit.
    await supabase.from('design_stage_log').insert([
      {
        project_id: project.id,
        from_stage: null,
        to_stage: 1,
        actor_id: user!.id,
        payload: { action: 'project_created' },
      },
      {
        project_id: project.id,
        from_stage: 1,
        to_stage: 2,
        actor_id: user!.id,
        reason: 'Stage 1 exit condition met on creation.',
      },
    ])
    await supabase
      .from('design_projects')
      .update({ current_stage: 2 })
      .eq('id', project.id)

    navigate(`/projects/${project.id}`)
  }

  const availableSupportDesigners = designers.filter(
    d => d.id !== leadDesignerId && !supportDesignerIds.includes(d.id)
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Project Name <span className="text-destructive">*</span></Label>
            <Input
              id="project-name"
              placeholder="e.g. The Sharma Residence — 3BHK Redesign"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Client Name <span className="text-destructive">*</span></Label>
            <Input
              id="client-name"
              placeholder="e.g. Rajesh Sharma"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-contact">Client Contact (phone / email)</Label>
            <Input
              id="client-contact"
              placeholder="e.g. +91 98765 43210"
              value={clientContact}
              onChange={e => setClientContact(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team Assignment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(isFounder || isTeamHead) && teamHeads.length > 0 && (
            <div className="space-y-1.5">
              <Label>Team Head <span className="text-destructive">*</span></Label>
              <Select value={teamHeadId} onValueChange={setTeamHeadId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select team head" />
                </SelectTrigger>
                <SelectContent>
                  {teamHeads.map(th => (
                    <SelectItem key={th.id} value={th.id}>
                      {th.full_name ?? th.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Lead Designer <span className="text-destructive">*</span></Label>
            <Select value={leadDesignerId} onValueChange={id => {
              setLeadDesignerId(id)
              setSupportDesignerIds(prev => prev.filter(d => d !== id))
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Select lead designer" />
              </SelectTrigger>
              <SelectContent>
                {designers.map(d => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name ?? d.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {availableSupportDesigners.length > 0 && (
            <div className="space-y-2">
              <Label>Additional Designers (optional)</Label>
              {supportDesignerIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {supportDesignerIds.map(id => {
                    const d = designers.find(d => d.id === id)
                    return (
                      <span key={id} className="flex items-center gap-1 text-xs bg-surface border border-border rounded-md px-2 py-1 text-foreground-secondary">
                        {d?.full_name ?? d?.email ?? id.slice(0, 8)}
                        <button type="button" onClick={() => removeSupportDesigner(id)} className="hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
              <Select onValueChange={addSupportDesigner}>
                <SelectTrigger>
                  <SelectValue placeholder="Add support designer…" />
                </SelectTrigger>
                <SelectContent>
                  {availableSupportDesigners.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name ?? d.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          <Plus className="h-4 w-4 mr-1" />
          {loading ? 'Creating…' : 'Create Project'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigate('/projects')}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
