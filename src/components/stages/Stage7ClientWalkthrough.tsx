import { useEffect, useState } from 'react'
import { Copy, Check, ExternalLink, CheckCircle2, XCircle, MessageSquare, Clock, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { advanceProject } from '@/lib/projectActions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ProjectDetailContext } from './types'

interface ClientResponse {
  id: string
  target_type: 'external_boq' | 'layout' | 'ppt' | 'general'
  target_id: string | null
  decision: 'approved' | 'rejected' | 'commented'
  comment: string | null
  client_name: string | null
  created_at: string
}

interface ExternalBoqRef {
  id: string
  total_amount: number
  version: number
}

export function Stage7ClientWalkthrough({ ctx }: { ctx: ProjectDetailContext }) {
  const [responses, setResponses] = useState<ClientResponse[]>([])
  const [externalBoq, setExternalBoq] = useState<ExternalBoqRef | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const portalUrl = ctx.project.client_portal_token
    ? `${window.location.origin}/c/${ctx.project.client_portal_token}`
    : ''

  useEffect(() => { void load() }, [ctx.project.id])

  async function load() {
    const [{ data: respData }, { data: boqData }] = await Promise.all([
      supabase
        .from('design_client_responses')
        .select('*')
        .eq('project_id', ctx.project.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('design_boqs')
        .select('id, total_amount, version')
        .eq('project_id', ctx.project.id)
        .eq('kind', 'external')
        .eq('is_active', true)
        .maybeSingle(),
    ])
    setResponses((respData ?? []) as ClientResponse[])
    setExternalBoq((boqData ?? null) as ExternalBoqRef | null)
    setLoading(false)

    // Auto-advance check: client has approved the current external BOQ
    if (boqData) {
      const boqApproval = (respData ?? []).find(
        (r: ClientResponse) => r.target_type === 'external_boq' && r.target_id === boqData.id && r.decision === 'approved'
      )
      if (boqApproval && ctx.project.current_stage === 7) {
        setAdvancing(true)
        const result = await advanceProject({
          project: ctx.project,
          members: ctx.members,
          actorId: ctx.currentUserId,
          to: 8,
          reason: `Client approved External BOQ (${boqApproval.client_name ?? 'anonymous'}).`,
          payload: { response_id: boqApproval.id },
        })
        setAdvancing(false)
        if (result.ok) await ctx.refresh()
        else setError(`Auto-advance failed: ${result.error}`)
      }
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(portalUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked — let user select manually
    }
  }

  if (loading) return <div className="h-24 rounded bg-surface animate-pulse" />

  const boqApproved = externalBoq && responses.some(r =>
    r.target_type === 'external_boq' && r.target_id === externalBoq.id && r.decision === 'approved'
  )

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Client Walkthrough</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Share the portal link with the client. They can review the founder-approved designs and External BOQ, then approve, request changes, or comment. The project advances to Stage 8 when the client approves the External BOQ.
        </p>
      </div>

      {/* Portal link */}
      <div className="rounded-md border border-border bg-background/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <ExternalLink className="h-4 w-4 text-accent-400 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">Client portal</p>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <code className="text-xs text-foreground bg-surface/60 rounded px-2 py-1 flex-1 truncate select-all">
            {portalUrl}
          </code>
          <Button size="sm" variant="secondary" onClick={copyLink}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <a href={portalUrl} target="_blank" rel="noreferrer">
            <Button size="sm" variant="secondary">
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </Button>
          </a>
        </div>
      </div>

      {/* BOQ approval status */}
      {externalBoq && (
        <div className="rounded-md border border-border bg-background/30 px-3 py-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">External BOQ v{externalBoq.version}</p>
            <p className="text-sm text-foreground">₹ {Number(externalBoq.total_amount).toLocaleString('en-IN')}</p>
          </div>
          {boqApproved ? (
            <Badge variant="success" className="text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" /> Client approved</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]"><Clock className="h-3 w-3 mr-1" /> Awaiting client</Badge>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {advancing && <p className="text-xs text-muted-foreground">Advancing to Stage 8…</p>}

      {/* Client responses inbox */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Client activity</h4>
          <button onClick={() => void load()} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        {responses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No client responses yet.</p>
        ) : (
          <ul className="space-y-2">
            {responses.map(r => (
              <li key={r.id} className="rounded-md border border-border/60 bg-background/20 px-3 py-2 text-xs">
                <div className="flex items-start gap-2">
                  <DecisionIcon decision={r.decision} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-foreground">{r.client_name ?? 'Client'}</span>
                      <span className="text-muted-foreground">{decisionVerb(r.decision)}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {targetLabel(r.target_type)}
                      </Badge>
                      <span className="text-muted-foreground ml-auto">
                        {new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {r.comment && <p className="mt-1 text-foreground-secondary italic">"{r.comment}"</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function DecisionIcon({ decision }: { decision: 'approved' | 'rejected' | 'commented' }) {
  if (decision === 'approved') return <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0 mt-0.5" />
  if (decision === 'rejected') return <XCircle className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
  return <MessageSquare className="h-3.5 w-3.5 text-accent-400 flex-shrink-0 mt-0.5" />
}

function decisionVerb(d: 'approved' | 'rejected' | 'commented'): string {
  if (d === 'approved') return 'approved'
  if (d === 'rejected') return 'requested changes on'
  return 'commented on'
}

function targetLabel(t: 'external_boq' | 'layout' | 'ppt' | 'general'): string {
  if (t === 'external_boq') return 'BOQ'
  if (t === 'layout') return 'Layout'
  if (t === 'ppt') return 'Presentation'
  return 'General message'
}
