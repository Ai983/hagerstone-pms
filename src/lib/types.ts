// ─── Roles ───────────────────────────────────────────────────────────────────
export type InternalRole = 'founder' | 'team_head' | 'designer'
export type ClientRole = 'client'
export type AppRole = InternalRole | ClientRole

// ─── Project ──────────────────────────────────────────────────────────────────
export type ProjectStage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11

export interface DesignProject {
  id: string
  project_name: string
  client_name: string
  client_contact: string | null
  current_stage: ProjectStage
  budget_amount: number | null
  margin_mode: 'flat_pct' | 'per_line_pct' | 'per_line_abs' | null
  cps_project_id: string | null
  team_head_id: string
  created_by: string
  created_at: string
  archived_at: string | null
}

export interface DesignProjectMember {
  id: string
  project_id: string
  user_id: string
  role: 'lead' | 'support'
  added_by: string
  created_at: string
}

// ─── Stage Log ────────────────────────────────────────────────────────────────
export interface DesignStageLog {
  id: string
  project_id: string
  from_stage: ProjectStage | null
  to_stage: ProjectStage
  actor_id: string
  reason: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

// ─── Meetings ─────────────────────────────────────────────────────────────────
export interface DesignMeeting {
  id: string
  project_id: string
  mode: 'online' | 'offline'
  meeting_at: string
  attendees: string[] | null
  mom_notes: string | null
  mom_file_url: string | null
  created_by: string
  created_at: string
}

// ─── BOQ ──────────────────────────────────────────────────────────────────────
export type BOQKind = 'internal' | 'external'
export type MarginMode = 'flat_pct' | 'per_line_pct' | 'per_line_abs'

export interface DesignBOQ {
  id: string
  project_id: string
  kind: BOQKind
  version: number
  total_amount: number
  margin_mode: MarginMode | null
  is_active: boolean
  created_by: string
  created_at: string
}

export interface DesignBOQLineItem {
  id: string
  boq_id: string
  item_name: string
  material_spec: string | null
  unit: string | null
  quantity: number | null
  unit_price: number | null
  total_price: number | null
  vendor_id: string | null
  notes: string | null
}

// ─── Vendors ──────────────────────────────────────────────────────────────────
export interface DesignVendor {
  id: string
  name: string
  phone: string | null
  email: string | null
  portal_token: string | null
  created_at: string
}

// ─── Client Users ─────────────────────────────────────────────────────────────
export interface DesignClientUser {
  id: string
  project_id: string
  name: string
  email: string
  phone: string | null
  auth_user_id: string | null
  created_at: string
  archived_at: string | null
}

// ─── Founder Reviews ──────────────────────────────────────────────────────────
export interface DesignFounderReview {
  id: string
  project_id: string
  boq_id: string | null
  decision: 'approved' | 'revise' | 'rejected'
  budget_amount: number | null
  comments: string | null
  created_by: string
  created_at: string
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
export interface DesignTask {
  id: string
  project_id: string
  title: string
  description: string | null
  assigned_to: string | null
  due_at: string | null
  status: 'open' | 'in_progress' | 'done' | 'blocked'
  created_by: string
  created_at: string
}

// ─── Cash Ledger ──────────────────────────────────────────────────────────────
export interface DesignCashLedger {
  id: string
  project_id: string
  direction: 'in' | 'out'
  amount: number
  source_system: 'cps' | 'finance' | 'manual'
  source_ref: string | null
  description: string | null
  occurred_at: string
  created_at: string
}

// ─── User profile (from auth.users + design_user_roles) ──────────────────────
export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  roles: InternalRole[]
}
