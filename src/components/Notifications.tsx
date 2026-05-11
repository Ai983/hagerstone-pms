import { useEffect, useState, useRef } from 'react'
import { Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

interface Alert {
  id: string
  alert_type: string
  payload: Record<string, unknown> | null
  sent_at: string | null
  created_at: string
}

function alertMessage(alert: Alert): string {
  const p = alert.payload ?? {}
  switch (alert.alert_type) {
    case 'member_added':
      return `You were added to project "${p.project_name}" as ${p.role}.`
    case 'member_removed':
      return `You were removed from project "${p.project_name}".`
    case 'member_role_changed':
      return `Your role in "${p.project_name}" was changed to ${p.new_role}.`
    case 'stage_advanced':
      return `Project "${p.project_name}" moved to Stage ${p.to_stage}.`
    default:
      return String(p.message ?? alert.alert_type)
  }
}

export function Notifications() {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const unread = alerts.filter(a => !a.sent_at).length

  useEffect(() => {
    if (!user) return
    loadAlerts()

    // Realtime subscription for new alerts
    const channel = supabase
      .channel('alerts')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'design_alerts',
        filter: `recipient_id=eq.${user.id}`,
      }, payload => {
        setAlerts(prev => [payload.new as Alert, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function loadAlerts() {
    const { data } = await supabase
      .from('design_alerts')
      .select('id, alert_type, payload, sent_at, created_at')
      .eq('recipient_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setAlerts(data ?? [])
  }

  async function markAllRead() {
    const unreadIds = alerts.filter(a => !a.sent_at).map(a => a.id)
    if (!unreadIds.length) return
    await supabase
      .from('design_alerts')
      .update({ sent_at: new Date().toISOString() })
      .in('id', unreadIds)
    setAlerts(prev => prev.map(a => unreadIds.includes(a.id) ? { ...a, sent_at: new Date().toISOString() } : a))
  }

  async function markRead(alertId: string) {
    await supabase
      .from('design_alerts')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', alertId)
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, sent_at: new Date().toISOString() } : a))
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(o => !o); if (!open && unread > 0) markAllRead() }}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-accent-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium text-foreground">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-accent-400 hover:text-accent-300">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              alerts.map(alert => (
                <button
                  key={alert.id}
                  onClick={() => markRead(alert.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-border/50 last:border-0 transition-colors',
                    !alert.sent_at ? 'bg-accent-500/5 hover:bg-accent-500/10' : 'hover:bg-background'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!alert.sent_at && (
                      <div className="h-1.5 w-1.5 rounded-full bg-accent-500 mt-1.5 flex-shrink-0" />
                    )}
                    <div className={!alert.sent_at ? '' : 'ml-3.5'}>
                      <p className="text-xs text-foreground-secondary leading-relaxed">
                        {alertMessage(alert)}
                      </p>
                      <time className="text-[10px] text-muted-foreground mt-0.5 block">
                        {new Date(alert.created_at).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </time>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
