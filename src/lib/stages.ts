import type { ProjectStage, InternalRole } from './types'

// ─── Stage metadata ───────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<ProjectStage, string> = {
  1: 'Project Creation',
  2: 'Client Meeting',
  3: 'Initial Deliverables',
  4: 'Founder Budget Review',
  5: 'BOQ Revision',
  6: 'Two-BOQ Split',
  7: 'Client Material Walkthrough',
  8: 'Vendor Confirmation Loop',
  9: 'Final BOQ Revision',
  10: 'Founder Final Approval',
  11: 'Handoff to CPS',
}

export const STAGE_OWNERS: Record<ProjectStage, Array<InternalRole | 'system'>> = {
  1: ['team_head', 'founder'],
  2: ['designer'],
  3: ['designer'],
  4: ['founder'],
  5: ['designer'],
  6: ['founder'],
  7: ['designer'],
  8: ['designer'],
  9: ['designer'],
  10: ['founder'],
  11: ['system'],
}

// Human-readable exit condition for each stage (for UI hints)
export const STAGE_EXIT_CONDITIONS: Record<ProjectStage, string> = {
  1: 'Project name, client name, and at least one lead designer assigned',
  2: 'Meeting marked complete; online meetings require MOM notes or file',
  3: 'BOQ v1, Layout, and PPT all uploaded',
  4: 'Founder sets budget and approves or requests revision',
  5: 'Revised BOQ uploaded',
  6: 'Internal and External BOQs split with margin mode set',
  7: 'Client confirms or requests changes',
  8: 'Every BOQ line item has a vendor and confirmed price',
  9: 'Designer marks client confirmed with timestamp',
  10: 'Founder signs final BOQ and budget (irreversible)',
  11: 'Handoff complete — project enters CPS procurement',
}

// ─── Transition guard ─────────────────────────────────────────────────────────

export type StageTransitionError =
  | { code: 'WRONG_STAGE'; current: ProjectStage; expected: ProjectStage }
  | { code: 'INSUFFICIENT_ROLE'; role: string; allowedRoles: string[] }
  | { code: 'BACKWARD_MISSING_REASON' }

export interface TransitionResult {
  ok: boolean
  error?: StageTransitionError
}

/**
 * Pure client-side gate. Mirrors the Express requireStage middleware.
 * Returns ok=false + error if the transition is not allowed.
 */
export function checkStageTransition(params: {
  currentStage: ProjectStage
  targetStage: ProjectStage
  actorRole: InternalRole
  isAssignedMember: boolean
  reason?: string
}): TransitionResult {
  const { currentStage, targetStage, actorRole, isAssignedMember, reason } = params

  // Forward move: target must be current + 1
  if (targetStage > currentStage) {
    if (targetStage !== currentStage + 1) {
      return { ok: false, error: { code: 'WRONG_STAGE', current: currentStage, expected: (currentStage + 1) as ProjectStage } }
    }

    // Team head and founder can advance any stage forward (per permission matrix).
    // Designer can only advance on a designer-owned stage and only on their own project.
    if (actorRole === 'founder' || actorRole === 'team_head') {
      return { ok: true }
    }

    const allowed = STAGE_OWNERS[currentStage]
    if (actorRole === 'designer') {
      if (!allowed.includes('designer') || !isAssignedMember) {
        return { ok: false, error: { code: 'INSUFFICIENT_ROLE', role: actorRole, allowedRoles: allowed } }
      }
      return { ok: true }
    }

    return { ok: false, error: { code: 'INSUFFICIENT_ROLE', role: actorRole, allowedRoles: allowed } }
  }

  // Backward move: only founder or team_head, must provide reason
  if (targetStage < currentStage) {
    if (actorRole !== 'founder' && actorRole !== 'team_head') {
      return { ok: false, error: { code: 'INSUFFICIENT_ROLE', role: actorRole, allowedRoles: ['founder', 'team_head'] } }
    }
    if (!reason || reason.trim().length === 0) {
      return { ok: false, error: { code: 'BACKWARD_MISSING_REASON' } }
    }
  }

  return { ok: true }
}

// ─── Stage colour helpers (for UI badges) ────────────────────────────────────

export function stageVariant(stage: ProjectStage): 'default' | 'secondary' | 'warning' | 'success' | 'destructive' {
  if (stage === 11) return 'success'
  if (stage === 10) return 'warning'
  if (stage <= 3) return 'secondary'
  return 'default'
}
