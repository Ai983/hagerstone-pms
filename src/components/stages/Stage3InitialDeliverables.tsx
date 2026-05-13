import { useEffect, useState } from 'react'
import { Upload, FileText, FileSpreadsheet, Presentation, CheckCircle2, RotateCcw, History, Download, MessageSquare } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { advanceProject } from '@/lib/projectActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { BoqGeneratorPanel } from './BoqGeneratorPanel'
import type { ProjectDetailContext } from './types'

type DeliverableKind = 'boq' | 'layout' | 'ppt'
type DeliverableStatus =
  | 'pending_th'
  | 'th_revise'
  | 'th_approved'
  | 'founder_revise'
  | 'founder_approved'

interface Deliverable {
  id: string
  project_id: string
  kind: DeliverableKind
  version: number
  file_path: string
  file_name: string | null
  file_size: number | null
  notes: string | null
  uploaded_by: string
  status: DeliverableStatus
  th_reviewed_by: string | null
  th_reviewed_at: string | null
  th_comment: string | null
  founder_reviewed_by: string | null
  founder_reviewed_at: string | null
  founder_comment: string | null
  budget_amount: number | null
  is_current: boolean
  created_at: string
}

const KIND_META: Record<DeliverableKind, { label: string; icon: React.ComponentType<{ className?: string }>; accept: string }> = {
  boq:    { label: 'BOQ',    icon: FileSpreadsheet, accept: '.xlsx,.xls,.csv,.pdf' },
  layout: { label: 'Layout', icon: FileText,        accept: '.pdf,.dwg,.png,.jpg,.jpeg' },
  ppt:    { label: 'PPT',    icon: Presentation,    accept: '.pptx,.ppt,.pdf' },
}

const STATUS_META: Record<DeliverableStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  pending_th:        { label: 'Awaiting Team Head', variant: 'secondary' },
  th_revise:         { label: 'TH: revise',         variant: 'warning'   },
  th_approved:       { label: 'TH approved',        variant: 'success'   },
  founder_revise:    { label: 'Founder: revise',    variant: 'warning'   },
  founder_approved:  { label: 'Founder approved',   variant: 'success'   },
}

export function Stage3InitialDeliverables({ ctx }: { ctx: ProjectDetailContext }) {
  const [items, setItems] = useState<Deliverable[]>([])
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [advError, setAdvError] = useState<string | null>(null)

  useEffect(() => { void load() }, [ctx.project.id])

  async function load() {
    const { data } = await supabase
      .from('design_deliverables')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('kind', { ascending: true })
      .order('version', { ascending: false })
    setItems((data ?? []) as Deliverable[])
    setLoading(false)
  }

  async function tryAutoAdvance(fresh: Deliverable[]) {
    const current = (k: DeliverableKind) => fresh.find(i => i.kind === k && i.is_current)
    const boq = current('boq'), layout = current('layout'), ppt = current('ppt')
    if (!boq || !layout || !ppt) return

    const stage = ctx.project.current_stage

    // Stage 3 → 4 when all three are TH-approved
    if (stage === 3) {
      if (boq.status !== 'th_approved' || layout.status !== 'th_approved' || ppt.status !== 'th_approved') return
      setAdvancing(true)
      setAdvError(null)
      const result = await advanceProject({
        project: ctx.project,
        members: ctx.members,
        actorId: ctx.currentUserId,
        to: 4,
        reason: 'All Stage 3 artifacts team-head approved.',
      })
      if (result.ok) await ctx.refresh()
      else setAdvError(result.error)
      setAdvancing(false)
      return
    }

    // Stage 4 → 5 when all three are Founder-approved
    if (stage === 4) {
      if (boq.status !== 'founder_approved' || layout.status !== 'founder_approved' || ppt.status !== 'founder_approved') return
      setAdvancing(true)
      setAdvError(null)
      const result = await advanceProject({
        project: ctx.project,
        members: ctx.members,
        actorId: ctx.currentUserId,
        to: 5,
        reason: 'All Stage 4 artifacts founder-approved.',
      })
      if (result.ok) await ctx.refresh()
      else setAdvError(result.error)
      setAdvancing(false)
    }
  }

  async function reload() {
    const { data } = await supabase
      .from('design_deliverables')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('kind', { ascending: true })
      .order('version', { ascending: false })
    const fresh = (data ?? []) as Deliverable[]
    setItems(fresh)
    await tryAutoAdvance(fresh)
  }

  if (loading) return <div className="h-24 rounded bg-surface animate-pulse" />

  const groups: Record<DeliverableKind, Deliverable[]> = {
    boq: items.filter(i => i.kind === 'boq'),
    layout: items.filter(i => i.kind === 'layout'),
    ppt: items.filter(i => i.kind === 'ppt'),
  }

  const stage = ctx.project.current_stage
  const headerCopy = stage === 4
    ? {
        title: 'Founder Review',
        body: 'Founder reviews each TH-approved artifact and sets the project budget on the BOQ. Revisions stay at Stage 4 — designer re-uploads, TH re-approves, then founder reviews again. Project advances to Stage 5 once all three are Founder-approved.',
      }
    : {
        title: 'Initial Deliverables',
        body: 'Designer uploads BOQ, Layout, and PPT. Team Head approves each one. Project advances to Stage 4 once all three are TH-approved.',
      }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">{headerCopy.title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{headerCopy.body}</p>
      </div>

      {advError && (
        <p className="text-xs text-destructive">Auto-advance failed: {advError}</p>
      )}
      {advancing && (
        <p className="text-xs text-muted-foreground">Advancing to Stage 4…</p>
      )}

      {/* AI BOQ Generator — uses the current Layout PDF as input.
          Renders only while the BOQ is still being assembled (Stage 3). */}
      {stage === 3 && (
        <BoqGeneratorPanel
          ctx={ctx}
          currentLayout={
            (() => {
              const cur = groups.layout.find(d => d.is_current)
              return cur ? { id: cur.id, file_path: cur.file_path, file_name: cur.file_name, version: cur.version } : null
            })()
          }
        />
      )}

      {(['boq', 'layout', 'ppt'] as DeliverableKind[]).map(kind => (
        <DeliverablePanel
          key={kind}
          kind={kind}
          versions={groups[kind]}
          ctx={ctx}
          onChange={reload}
        />
      ))}
    </div>
  )
}

interface PanelProps {
  kind: DeliverableKind
  versions: Deliverable[]
  ctx: ProjectDetailContext
  onChange: () => Promise<void>
}

function DeliverablePanel({ kind, versions, ctx, onChange }: PanelProps) {
  const meta = KIND_META[kind]
  const Icon = meta.icon
  const current = versions.find(v => v.is_current) ?? null
  const history = versions.filter(v => !v.is_current)

  const [showUpload, setShowUpload] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const canDesignerUpload = ctx.isAssignedMember || ctx.isTeamHead || ctx.isFounder
  const designerShouldUpload =
    !current
    || current.status === 'th_revise'
    || current.status === 'founder_revise'

  return (
    <div className="rounded-md border border-border bg-background/30">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-accent-400" />
          <span className="text-sm font-medium text-foreground">{meta.label}</span>
          {current && (
            <>
              <span className="text-xs text-muted-foreground">v{current.version}</span>
              <Badge variant={STATUS_META[current.status].variant} className="text-[10px]">
                {STATUS_META[current.status].label}
              </Badge>
            </>
          )}
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory(s => !s)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <History className="h-3 w-3" />
            {history.length} previous
          </button>
        )}
      </div>

      <div className="px-4 py-3">
        {!current ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">No {meta.label} uploaded yet.</p>
            {canDesignerUpload && !showUpload && (
              <Button size="sm" variant="secondary" onClick={() => setShowUpload(true)}>
                <Upload className="h-3.5 w-3.5 mr-1" />
                Upload {meta.label}
              </Button>
            )}
          </div>
        ) : (
          <CurrentVersionView
            item={current}
            kind={kind}
            ctx={ctx}
            onChange={onChange}
            onAskUpload={() => setShowUpload(true)}
            designerShouldUpload={designerShouldUpload}
            canDesignerUpload={canDesignerUpload}
          />
        )}

        {showUpload && (
          <UploadForm
            kind={kind}
            existingVersionCount={versions.length}
            ctx={ctx}
            onCancel={() => setShowUpload(false)}
            onDone={async () => { setShowUpload(false); await onChange() }}
          />
        )}

        {showHistory && history.length > 0 && (
          <div className="mt-3 border-t border-border/40 pt-3 space-y-2">
            {history.map(h => (
              <HistoryRow key={h.id} item={h} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CurrentVersionView({
  item, kind, ctx, onChange, onAskUpload, designerShouldUpload, canDesignerUpload,
}: {
  item: Deliverable
  kind: DeliverableKind
  ctx: ProjectDetailContext
  onChange: () => Promise<void>
  onAskUpload: () => void
  designerShouldUpload: boolean
  canDesignerUpload: boolean
}) {
  const [reviewing, setReviewing] = useState<'approve' | 'revise' | null>(null)
  const [comment, setComment] = useState('')
  const [budgetInput, setBudgetInput] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stage = ctx.project.current_stage

  // TH can approve a pending_th version while the project is at Stage 3 or 4
  // (Stage 4 revisions go back through TH on each round).
  const canTHReview =
    ctx.isTeamHead
    && (stage === 3 || stage === 4)
    && item.status === 'pending_th'

  // Founder reviews a TH-approved version at Stage 4.
  const canFounderReview =
    ctx.isFounder
    && stage === 4
    && item.status === 'th_approved'

  async function submitTHReview(decision: 'approved' | 'revise') {
    setError(null)
    if (decision === 'revise' && !comment.trim()) {
      setError('Add a brief comment explaining the revision needed.')
      return
    }
    setSubmitting(true)
    const { error: upErr } = await supabase
      .from('design_deliverables')
      .update({
        status: decision === 'approved' ? 'th_approved' : 'th_revise',
        th_reviewed_by: ctx.currentUserId,
        th_reviewed_at: new Date().toISOString(),
        th_comment: comment.trim() || null,
      })
      .eq('id', item.id)

    if (upErr) { setError(upErr.message); setSubmitting(false); return }

    await supabase.from('design_alerts').insert({
      project_id: item.project_id,
      alert_type: decision === 'approved' ? 'deliverable_th_approved' : 'deliverable_th_revise',
      recipient_role: 'designer',
      recipient_id: item.uploaded_by,
      payload: {
        project_name: ctx.project.project_name,
        kind,
        version: item.version,
        comment: comment.trim() || null,
      },
    })

    setReviewing(null); setComment(''); setSubmitting(false)
    await onChange()
  }

  async function submitFounderReview(decision: 'approved' | 'revise') {
    setError(null)
    if (decision === 'revise' && !comment.trim()) {
      setError('Add a brief comment explaining the revision needed.')
      return
    }
    // BOQ approval requires a budget number
    let parsedBudget: number | null = null
    if (decision === 'approved' && kind === 'boq') {
      const n = Number(budgetInput)
      if (!Number.isFinite(n) || n <= 0) {
        setError('Enter a valid project budget before approving the BOQ.')
        return
      }
      parsedBudget = n
    }

    setSubmitting(true)
    const { error: upErr } = await supabase
      .from('design_deliverables')
      .update({
        status: decision === 'approved' ? 'founder_approved' : 'founder_revise',
        founder_reviewed_by: ctx.currentUserId,
        founder_reviewed_at: new Date().toISOString(),
        founder_comment: comment.trim() || null,
        ...(parsedBudget !== null ? { budget_amount: parsedBudget } : {}),
      })
      .eq('id', item.id)

    if (upErr) { setError(upErr.message); setSubmitting(false); return }

    // On BOQ approval, mirror the budget to design_projects.budget_amount.
    if (decision === 'approved' && kind === 'boq' && parsedBudget !== null) {
      await supabase
        .from('design_projects')
        .update({ budget_amount: parsedBudget })
        .eq('id', ctx.project.id)
    }

    await supabase.from('design_alerts').insert({
      project_id: item.project_id,
      alert_type: decision === 'approved' ? 'deliverable_founder_approved' : 'deliverable_founder_revise',
      recipient_role: 'designer',
      recipient_id: item.uploaded_by,
      payload: {
        project_name: ctx.project.project_name,
        kind,
        version: item.version,
        comment: comment.trim() || null,
        budget_amount: parsedBudget,
      },
    })

    setReviewing(null); setComment(''); setBudgetInput(''); setSubmitting(false)
    await onChange()
  }

  const submit = canFounderReview ? submitFounderReview : submitTHReview
  const canAnyReview = canTHReview || canFounderReview
  const reviewerLabel = canFounderReview ? 'Founder' : 'Team Head'

  return (
    <div className="space-y-3">
      <FileLine item={item} />

      {item.notes && (
        <div className="text-xs text-foreground-secondary whitespace-pre-wrap">
          <span className="text-muted-foreground">Designer notes: </span>{item.notes}
        </div>
      )}

      {item.th_comment && (
        <div className="flex items-start gap-1.5 text-xs">
          <MessageSquare className="h-3 w-3 text-warning mt-0.5 flex-shrink-0" />
          <span><span className="text-muted-foreground">Team Head: </span>{item.th_comment}</span>
        </div>
      )}

      {item.founder_comment && (
        <div className="flex items-start gap-1.5 text-xs">
          <MessageSquare className="h-3 w-3 text-accent-400 mt-0.5 flex-shrink-0" />
          <span><span className="text-muted-foreground">Founder: </span>{item.founder_comment}</span>
        </div>
      )}

      {kind === 'boq' && item.budget_amount != null && (
        <div className="text-xs">
          <span className="text-muted-foreground">Founder-set budget: </span>
          <span className="text-foreground font-medium">
            ₹ {Number(item.budget_amount).toLocaleString('en-IN')}
          </span>
        </div>
      )}

      {/* Designer: upload new revision if requested */}
      {canDesignerUpload && designerShouldUpload && (
        <Button size="sm" variant="secondary" onClick={onAskUpload}>
          <Upload className="h-3.5 w-3.5 mr-1" />
          Upload new revision
        </Button>
      )}

      {/* Review buttons (TH or Founder, depending on stage + status) */}
      {canAnyReview && !reviewing && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => setReviewing('approve')}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            {reviewerLabel}: Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setReviewing('revise')}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Request revision
          </Button>
        </div>
      )}

      {canAnyReview && reviewing && (
        <div className="space-y-2 pt-1">
          {/* Budget input — only when founder is approving a BOQ */}
          {canFounderReview && kind === 'boq' && reviewing === 'approve' && (
            <div className="space-y-1">
              <Label htmlFor={`budget-${item.id}`} className="text-xs">
                Project budget (₹) *
              </Label>
              <Input
                id={`budget-${item.id}`}
                type="number"
                min="0"
                step="1"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                placeholder="e.g. 1500000"
              />
            </div>
          )}
          <Label htmlFor={`comment-${item.id}`} className="text-xs">
            {reviewing === 'approve' ? 'Approval note (optional)' : 'What needs to change?'}
          </Label>
          <Textarea
            id={`comment-${item.id}`}
            rows={2}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={reviewing === 'approve' ? 'Looks good…' : 'Update line 12, revise totals…'}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => submit(reviewing === 'approve' ? 'approved' : 'revise')}
              disabled={submitting}
            >
              {submitting
                ? 'Saving…'
                : reviewing === 'approve'
                  ? `Confirm ${reviewerLabel} approval`
                  : 'Send back for revision'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setReviewing(null); setComment(''); setBudgetInput(''); setError(null) }}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function FileLine({ item }: { item: Deliverable }) {
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    const { data } = await supabase.storage
      .from('design-deliverables')
      .createSignedUrl(item.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    setBusy(false)
  }
  return (
    <button
      onClick={download}
      disabled={busy}
      className="flex items-center gap-2 text-sm text-accent-400 hover:text-accent-300 transition-colors"
    >
      <Download className="h-3.5 w-3.5" />
      <span className="truncate">{item.file_name ?? item.file_path.split('/').pop()}</span>
      {item.file_size && (
        <span className="text-[10px] text-muted-foreground">
          ({(item.file_size / 1024 / 1024).toFixed(2)} MB)
        </span>
      )}
    </button>
  )
}

function HistoryRow({ item }: { item: Deliverable }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-muted-foreground">v{item.version}</span>
        <Badge variant={STATUS_META[item.status].variant} className="text-[10px]">
          {STATUS_META[item.status].label}
        </Badge>
        <FileLine item={item} />
      </div>
      <time className="text-muted-foreground flex-shrink-0">
        {new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
      </time>
    </div>
  )
}

function UploadForm({
  kind, existingVersionCount, ctx, onCancel, onDone,
}: {
  kind: DeliverableKind
  existingVersionCount: number
  ctx: ProjectDetailContext
  onCancel: () => void
  onDone: () => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meta = KIND_META[kind]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file) { setError('Pick a file to upload.'); return }
    setSubmitting(true)

    const nextVersion = existingVersionCount + 1
    const safeName = file.name.replace(/[^\w.\-]/g, '_')
    const path = `${ctx.project.id}/${kind}/${nextVersion}-${Date.now()}-${safeName}`

    // 1. Upload to storage
    const { error: upErr } = await supabase.storage
      .from('design-deliverables')
      .upload(path, file, { cacheControl: '3600', upsert: false })

    if (upErr) { setError(`Upload failed: ${upErr.message}`); setSubmitting(false); return }

    // 2. Flip previous current to false (if any exist)
    if (existingVersionCount > 0) {
      await supabase
        .from('design_deliverables')
        .update({ is_current: false })
        .eq('project_id', ctx.project.id)
        .eq('kind', kind)
        .eq('is_current', true)
    }

    // 3. Insert new row
    const { error: insErr } = await supabase.from('design_deliverables').insert({
      project_id: ctx.project.id,
      kind,
      version: nextVersion,
      file_path: path,
      file_name: file.name,
      file_size: file.size,
      notes: notes.trim() || null,
      uploaded_by: ctx.currentUserId,
      status: 'pending_th',
      is_current: true,
    })

    if (insErr) { setError(insErr.message); setSubmitting(false); return }

    // 4. Notify TH of pending review
    await supabase.from('design_alerts').insert({
      project_id: ctx.project.id,
      alert_type: 'deliverable_uploaded',
      recipient_role: 'team_head',
      recipient_id: ctx.project.team_head_id,
      payload: {
        project_name: ctx.project.project_name,
        kind,
        version: nextVersion,
      },
    })

    setSubmitting(false)
    setFile(null)
    setNotes('')
    await onDone()
  }

  return (
    <form onSubmit={handleSubmit} className={cn('mt-3 space-y-3 rounded-md border border-border bg-surface/50 p-3')}>
      <div className="space-y-1">
        <Label htmlFor={`file-${kind}`} className="text-xs">File *</Label>
        <Input
          id={`file-${kind}`}
          type="file"
          accept={meta.accept}
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-[10px] text-muted-foreground">Accepted: {meta.accept}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`notes-${kind}`} className="text-xs">Notes (optional)</Label>
        <Textarea
          id={`notes-${kind}`}
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="What's new in this version?"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting || !file}>
          {submitting ? 'Uploading…' : `Submit v${existingVersionCount + 1}`}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
