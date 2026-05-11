import { supabase } from './supabase'
import { STAGE_LABELS } from './stages'
import type { ProjectStage, DesignProject } from './types'

interface MemberRef {
  user_id: string
}

/**
 * Advance a project to a target stage. Writes the stage_log entry,
 * updates the project, and fires in-app alerts to every member.
 * Caller is responsible for refreshing local state afterwards.
 */
export async function advanceProject(args: {
  project: Pick<DesignProject, 'id' | 'project_name' | 'current_stage'>
  members: MemberRef[]
  actorId: string
  to: ProjectStage
  reason?: string
  payload?: Record<string, unknown>
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { project, members, actorId, to, reason, payload } = args

  // The dual write (stage_log insert + project update) is wrapped in a
  // SECURITY DEFINER RPC so designer-triggered advances pass the auth check
  // that the design_projects UPDATE policy enforces.
  const { error: rpcErr } = await supabase.rpc('advance_project_stage', {
    p_project_id: project.id,
    p_to_stage: to,
    p_reason: reason ?? null,
    p_payload: payload ?? null,
  })
  if (rpcErr) return { ok: false, error: rpcErr.message }

  if (members.length > 0) {
    await supabase.from('design_alerts').insert(
      members.map(m => ({
        project_id: project.id,
        alert_type: 'stage_advanced',
        recipient_role: 'designer',
        recipient_id: m.user_id,
        payload: {
          project_name: project.project_name,
          from_stage: project.current_stage,
          to_stage: to,
          stage_label: STAGE_LABELS[to],
        },
      }))
    )
  }

  return { ok: true }
}
