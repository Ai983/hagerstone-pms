import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Session, User } from './supabase'
import type { InternalRole } from './types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  roles: InternalRole[]
  isFounder: boolean
  isTeamHead: boolean
  isDesigner: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [roles, setRoles] = useState<InternalRole[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) fetchRoles(data.session.user.id)
      else setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s) fetchRoles(s.user.id)
      else { setRoles([]); setLoading(false) }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function fetchRoles(userId: string) {
    const { data } = await supabase
      .from('design_user_roles')
      .select('role')
      .eq('user_id', userId)
    setRoles((data ?? []).map((r: { role: InternalRole }) => r.role))
    setLoading(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const user = session?.user ?? null

  return (
    <AuthContext.Provider value={{
      session,
      user,
      roles,
      isFounder: roles.includes('founder'),
      isTeamHead: roles.includes('team_head'),
      isDesigner: roles.includes('designer'),
      loading,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
