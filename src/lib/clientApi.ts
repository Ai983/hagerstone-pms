// Thin client for the public client-portal edge functions.
// No supabase auth involved — the token alone authorises access.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const baseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
}

export interface ClientPortalProfile {
  id: string
  email: string | null
  full_name: string | null
}

export interface ClientPortalTeam {
  team_head: ClientPortalProfile | null
  designers: Array<ClientPortalProfile & { user_id: string; role: 'lead' | 'support' }>
}

export interface ClientPortalDesign {
  id: string
  kind: 'layout' | 'ppt'
  version: number
  file_name: string | null
  file_url: string | null
  notes: string | null
  founder_comment: string | null
  status: string
  created_at: string
}

export interface ClientPortalBOQLine {
  id: string
  item_name: string
  material_spec: string | null
  unit: string | null
  quantity: number | null
  unit_price: number | null
  total_price: number | null
}

export interface ClientPortalBOQ {
  id: string
  version: number
  total_amount: number
  margin_mode: string | null
  created_at: string
  line_items: ClientPortalBOQLine[]
}

export interface ClientPortalResponse {
  id: string
  target_type: 'external_boq' | 'layout' | 'ppt' | 'general'
  target_id: string | null
  decision: 'approved' | 'rejected' | 'commented'
  comment: string | null
  client_name: string | null
  created_at: string
}

export interface ClientPortalPayload {
  project: {
    id: string
    project_name: string
    client_name: string
    client_contact: string | null
    current_stage: number
    current_stage_label: string
    boq_shared: boolean
  }
  team: ClientPortalTeam
  designs: ClientPortalDesign[]
  external_boq: ClientPortalBOQ | null
  responses: ClientPortalResponse[]
}

export async function fetchClientView(token: string): Promise<ClientPortalPayload> {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/client-view?token=${encodeURIComponent(token)}`,
    { headers: baseHeaders }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to load (${res.status})`)
  }
  return res.json()
}

export async function submitClientAction(args: {
  token: string
  target_type: ClientPortalResponse['target_type']
  target_id?: string | null
  decision: ClientPortalResponse['decision']
  comment?: string | null
  client_name?: string | null
}): Promise<{ ok: true; id: string; created_at: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/client-action`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to submit (${res.status})`)
  }
  return res.json()
}
