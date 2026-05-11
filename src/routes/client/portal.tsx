import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  Building2, User, Users, CheckCircle2, XCircle, MessageSquare, Download,
  Clock, FileText, Presentation, AlertCircle, Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  fetchClientView, submitClientAction,
  type ClientPortalPayload, type ClientPortalResponse,
} from '@/lib/clientApi'

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ClientPortalPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Remember the client's name across actions (kept locally only)
  const [clientName, setClientName] = useState<string>(() => localStorage.getItem('client-portal-name') ?? '')

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const payload = await fetchClientView(token)
      setData(payload)
      // Prefer the name on file if the user hasn't already typed one
      if (!clientName && payload.project.client_name) setClientName(payload.project.client_name)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token, clientName])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (clientName) localStorage.setItem('client-portal-name', clientName)
  }, [clientName])

  if (loading) {
    return (
      <PortalShell>
        <div className="h-40 rounded-lg bg-surface animate-pulse" />
      </PortalShell>
    )
  }

  if (error || !data) {
    return (
      <PortalShell>
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <AlertCircle className="h-6 w-6 text-warning mx-auto" />
            <p className="text-sm text-foreground">We couldn't open this project.</p>
            <p className="text-xs text-muted-foreground">{error ?? 'Unknown error'}</p>
            <p className="text-xs text-muted-foreground">
              Please ask your designer to re-share the project link.
            </p>
          </CardContent>
        </Card>
      </PortalShell>
    )
  }

  const { project, team, designs, external_boq, responses } = data
  const layouts = designs.filter(d => d.kind === 'layout')
  const ppts = designs.filter(d => d.kind === 'ppt')

  return (
    <PortalShell>
      {/* Header */}
      <Card>
        <CardContent className="py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold text-foreground">{project.project_name}</h1>
              <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                <span>{project.client_name}</span>
                {project.client_contact && <>
                  <span>·</span><span>{project.client_contact}</span>
                </>}
              </div>
            </div>
            <Badge variant="secondary" className="flex-shrink-0">
              {project.current_stage_label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* "Your name" capture — used to attribute approvals */}
      <Card>
        <CardContent className="py-4">
          <Label htmlFor="client-name" className="text-xs">Your name (so we know who's signing off)</Label>
          <Input
            id="client-name"
            placeholder="Enter your name"
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            className="mt-1.5 max-w-sm"
          />
        </CardContent>
      </Card>

      {/* Team */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Team Working on Your Project
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {team.team_head && (
            <TeamRow profile={team.team_head} role="Team Head" />
          )}
          {team.designers.length === 0 && (
            <p className="text-xs text-muted-foreground">Designer assignment pending.</p>
          )}
          {team.designers.map(d => (
            <TeamRow key={d.user_id} profile={d} role={d.role === 'lead' ? 'Lead Designer' : 'Designer'} />
          ))}
        </CardContent>
      </Card>

      {/* Design files */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Designs Shared With You
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {designs.length === 0 ? (
            <WorkInProgress>
              Your design files will appear here once they're approved by the founder.
            </WorkInProgress>
          ) : (
            <>
              {layouts.length > 0 && (
                <DesignSection title="Layout" icon={<FileText className="h-4 w-4 text-accent-400" />} items={layouts} token={token!} clientName={clientName} responses={responses} onAction={refresh} />
              )}
              {ppts.length > 0 && (
                <DesignSection title="Presentation" icon={<Presentation className="h-4 w-4 text-accent-400" />} items={ppts} token={token!} clientName={clientName} responses={responses} onAction={refresh} />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* External BOQ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Bill of Quantities (BOQ)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!project.boq_shared || !external_boq ? (
            <WorkInProgress>
              The BOQ is being prepared and reviewed internally. We'll share it here once the founder signs it off.
            </WorkInProgress>
          ) : (
            <BOQView
              boq={external_boq}
              token={token!}
              clientName={clientName}
              responses={responses}
              onAction={refresh}
            />
          )}
        </CardContent>
      </Card>

      {/* General comment box */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> Leave a Message for the Team
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GeneralComment token={token!} clientName={clientName} onAction={refresh} />
        </CardContent>
      </Card>

      {/* Your past responses */}
      {responses.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Your Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {responses.map(r => (
                <li key={r.id} className="text-xs text-foreground-secondary border-l-2 border-border pl-3 py-1">
                  <span className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {' · '}
                  <span className="text-foreground">{decisionLabel(r.decision)}</span>
                  {' on '}
                  <span className="text-foreground-secondary">{r.target_type.replace('_', ' ')}</span>
                  {r.comment && <p className="text-muted-foreground mt-0.5 italic">"{r.comment}"</p>}
                  {r.client_name && <p className="text-[10px] text-muted-foreground/70 mt-0.5">— {r.client_name}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PortalShell>
  )
}

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-accent-500 flex items-center justify-center">
            <Building2 className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-foreground text-sm tracking-tight">Hagerstone Design — Client Portal</span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-6 space-y-4">{children}</main>
    </div>
  )
}

function TeamRow({ profile, role }: { profile: { email: string | null; full_name: string | null }; role: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-accent-500/20 flex items-center justify-center flex-shrink-0">
        <User className="h-4 w-4 text-accent-400" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-foreground truncate">{profile.full_name ?? profile.email ?? '—'}</p>
        <p className="text-xs text-muted-foreground">
          {role}{profile.email && <span> · {profile.email}</span>}
        </p>
      </div>
    </div>
  )
}

function WorkInProgress({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-accent-500/5 border border-accent-500/20 px-4 py-4 flex items-start gap-2">
      <Clock className="h-4 w-4 text-accent-400 mt-0.5 flex-shrink-0" />
      <p className="text-xs text-foreground-secondary leading-relaxed">{children}</p>
    </div>
  )
}

function decisionLabel(d: 'approved' | 'rejected' | 'commented'): string {
  if (d === 'approved') return 'Approved'
  if (d === 'rejected') return 'Requested revision'
  return 'Commented'
}

// ─── Design section: list each version with download + decision buttons ──────
function DesignSection({
  title, icon, items, token, clientName, responses, onAction,
}: {
  title: string
  icon: React.ReactNode
  items: Array<{ id: string; kind: 'layout' | 'ppt'; version: number; file_name: string | null; file_url: string | null; notes: string | null; founder_comment: string | null }>
  token: string
  clientName: string
  responses: ClientPortalResponse[]
  onAction: () => Promise<void>
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </div>
      {items.map(item => {
        const myResponses = responses.filter(r => r.target_type === item.kind && r.target_id === item.id)
        return (
          <div key={item.id} className="rounded-md border border-border bg-background/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="secondary" className="text-[10px]">v{item.version}</Badge>
                {item.file_url ? (
                  <a
                    href={item.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-sm text-accent-400 hover:text-accent-300 truncate"
                  >
                    <Download className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{item.file_name ?? `${title} v${item.version}`}</span>
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">{item.file_name ?? '—'}</span>
                )}
              </div>
            </div>
            {item.notes && <p className="text-xs text-foreground-secondary"><span className="text-muted-foreground">Designer notes: </span>{item.notes}</p>}
            {item.founder_comment && <p className="text-xs text-foreground-secondary"><span className="text-muted-foreground">Founder note: </span>{item.founder_comment}</p>}

            <DecisionBar
              token={token}
              clientName={clientName}
              targetType={item.kind}
              targetId={item.id}
              onAction={onAction}
              existing={myResponses}
            />
          </div>
        )
      })}
    </div>
  )
}

// ─── BOQ table + decision bar ────────────────────────────────────────────────
function BOQView({
  boq, token, clientName, responses, onAction,
}: {
  boq: NonNullable<ClientPortalPayload['external_boq']>
  token: string
  clientName: string
  responses: ClientPortalResponse[]
  onAction: () => Promise<void>
}) {
  const myResponses = responses.filter(r => r.target_type === 'external_boq' && r.target_id === boq.id)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Version {boq.version} · Total ₹ {Number(boq.total_amount).toLocaleString('en-IN')}</span>
      </div>
      <div className="rounded-md border border-border bg-background/30 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface/60 text-muted-foreground">
            <tr className="text-left">
              <th className="px-2 py-2 font-medium">Item</th>
              <th className="px-2 py-2 font-medium">Spec</th>
              <th className="px-2 py-2 font-medium">Unit</th>
              <th className="px-2 py-2 font-medium text-right">Qty</th>
              <th className="px-2 py-2 font-medium text-right">Unit ₹</th>
              <th className="px-2 py-2 font-medium text-right">Total ₹</th>
            </tr>
          </thead>
          <tbody>
            {boq.line_items.map(l => (
              <tr key={l.id} className="border-t border-border/60">
                <td className="px-2 py-1.5 text-foreground">{l.item_name}</td>
                <td className="px-2 py-1.5 text-foreground-secondary">{l.material_spec ?? '—'}</td>
                <td className="px-2 py-1.5 text-foreground-secondary">{l.unit ?? '—'}</td>
                <td className="px-2 py-1.5 text-right text-foreground-secondary">{l.quantity ?? '—'}</td>
                <td className="px-2 py-1.5 text-right text-foreground-secondary">{l.unit_price != null ? Number(l.unit_price).toLocaleString('en-IN') : '—'}</td>
                <td className="px-2 py-1.5 text-right text-foreground">{l.total_price != null ? Number(l.total_price).toLocaleString('en-IN') : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-surface/40">
              <td colSpan={5} className="px-2 py-2 text-right font-medium text-muted-foreground">Total</td>
              <td className="px-2 py-2 text-right font-medium text-foreground">₹ {Number(boq.total_amount).toLocaleString('en-IN')}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <DecisionBar
        token={token}
        clientName={clientName}
        targetType="external_boq"
        targetId={boq.id}
        onAction={onAction}
        existing={myResponses}
      />
    </div>
  )
}

// ─── Decision bar (approve / reject / comment) ───────────────────────────────
function DecisionBar({
  token, clientName, targetType, targetId, onAction, existing,
}: {
  token: string
  clientName: string
  targetType: 'external_boq' | 'layout' | 'ppt'
  targetId: string
  onAction: () => Promise<void>
  existing: ClientPortalResponse[]
}) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'approve' | 'revise' | 'comment' | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const latest = existing[0]  // responses arrive newest-first
  const alreadyApproved = latest?.decision === 'approved'

  async function submit(decision: 'approved' | 'rejected' | 'commented') {
    setError(null)
    if (!clientName.trim()) { setError('Please add your name above before responding.'); return }
    if ((decision === 'rejected' || decision === 'commented') && !comment.trim()) {
      setError('A short note is required.')
      return
    }
    setBusy(true)
    try {
      await submitClientAction({
        token,
        target_type: targetType,
        target_id: targetId,
        decision,
        comment: comment.trim() || null,
        client_name: clientName.trim() || null,
      })
      setMode(null)
      setComment('')
      await onAction()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (alreadyApproved) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approved by {latest.client_name ?? 'you'} on {new Date(latest.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {!mode && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode('approve')}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode('revise')}>
            <XCircle className="h-3.5 w-3.5 mr-1" /> Request changes
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode('comment')}>
            <MessageSquare className="h-3.5 w-3.5 mr-1" /> Comment
          </Button>
        </div>
      )}

      {mode && (
        <div className="space-y-2 rounded-md border border-border bg-surface/40 p-3">
          {(mode === 'revise' || mode === 'comment') && (
            <>
              <Label className="text-xs">
                {mode === 'revise' ? 'What would you like changed?' : 'Your comment'}
              </Label>
              <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder={mode === 'revise' ? 'Switch the kitchen flooring to wooden, reduce living-room lighting…' : 'Looks good overall, just one thought…'} />
            </>
          )}
          {mode === 'approve' && (
            <p className="text-xs text-foreground-secondary">
              Approving as <span className="text-foreground">{clientName || '(your name)'}</span>. This will tell the team you're happy with this version.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => submit(mode === 'approve' ? 'approved' : mode === 'revise' ? 'rejected' : 'commented')}
              disabled={busy}
            >
              {busy ? 'Sending…' : 'Send'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setMode(null); setComment(''); setError(null) }} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── General comment composer ────────────────────────────────────────────────
function GeneralComment({ token, clientName, onAction }: { token: string; clientName: string; onAction: () => Promise<void> }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function send() {
    setError(null); setSent(false)
    if (!comment.trim()) { setError('Type a message first.'); return }
    if (!clientName.trim()) { setError('Please add your name above.'); return }
    setBusy(true)
    try {
      await submitClientAction({
        token,
        target_type: 'general',
        target_id: null,
        decision: 'commented',
        comment: comment.trim(),
        client_name: clientName.trim(),
      })
      setComment('')
      setSent(true)
      await onAction()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Anything you want the team to know…" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {sent && <p className="text-xs text-success">Sent. The team will see this in their notifications.</p>}
      <Button size="sm" onClick={send} disabled={busy}>
        <Send className="h-3.5 w-3.5 mr-1" /> {busy ? 'Sending…' : 'Send'}
      </Button>
    </div>
  )
}
