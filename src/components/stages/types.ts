import type { DesignProject, InternalRole } from '@/lib/types'

export interface MemberLite {
  id: string
  user_id: string
  role: 'lead' | 'support'
  email: string
}

export interface ProjectDetailContext {
  project: DesignProject
  members: MemberLite[]
  currentUserId: string
  roles: InternalRole[]
  isFounder: boolean
  isTeamHead: boolean
  isDesigner: boolean
  isAssignedMember: boolean
  refresh: () => Promise<void>
}
