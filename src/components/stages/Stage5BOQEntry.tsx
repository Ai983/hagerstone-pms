import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, Send, CheckCircle2, RotateCcw, MessageSquare, FileSpreadsheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { advanceProject } from '@/lib/projectActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import type { ProjectDetailContext } from './types'

type BOQStatus = 'draft' | 'pending_th' | 'th_revise' | 'th_approved'

interface BOQ {
  id: string
  project_id: string
  kind: 'internal' | 'external'
  version: number
  total_amount: number
  status: BOQStatus
  is_active: boolean
  created_by: string
  th_comment: string | null
  submitted_at: string | null
  th_reviewed_at: string | null
}

interface LineItem {
  id: string
  boq_id: string
  item_name: string
  material_spec: string | null
  unit: string | null
  quantity: number | null
  unit_price: number | null
  total_price: number | null
  notes: string | null
}

interface DraftLine {
  // Local-only draft row (no DB id yet)
  draftKey: string
  item_name: string
  material_spec: string
  unit: string
  quantity: string
  unit_price: string
}

const STATUS_META: Record<BOQStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' }> = {
  draft:        { label: 'Draft',                 variant: 'secondary' },
  pending_th:   { label: 'Awaiting Team Head',    variant: 'secondary' },
  th_revise:    { label: 'TH: revise',            variant: 'warning'   },
  th_approved:  { label: 'TH approved',           variant: 'success'   },
}

export function Stage5BOQEntry({ ctx }: { ctx: ProjectDetailContext }) {
  const [boq, setBoq] = useState<BOQ | null>(null)
  const [lines, setLines] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local edits keyed by line item id (or draft key for new rows)
  const [editing, setEditing] = useState<Record<string, Partial<LineItem>>>({})
  const [drafts, setDrafts] = useState<DraftLine[]>([])

  // TH review state
  const [reviewing, setReviewing] = useState<'approve' | 'revise' | null>(null)
  const [reviewComment, setReviewComment] = useState('')

  const isDesigner = ctx.isAssignedMember || ctx.isTeamHead || ctx.isFounder
  const canEdit = boq != null && (boq.status === 'draft' || boq.status === 'th_revise') && isDesigner
  const canTHReview = ctx.isTeamHead && boq?.status === 'pending_th'

  useEffect(() => { void load() }, [ctx.project.id])

  async function load() {
    // Fetch active internal BOQ for this project (created at Stage 5)
    const { data: boqRows } = await supabase
      .from('design_boqs')
      .select('*')
      .eq('project_id', ctx.project.id)
      .eq('kind', 'internal')
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)

    const activeBoq = (boqRows?.[0] ?? null) as BOQ | null
    setBoq(activeBoq)

    if (activeBoq) {
      const { data: lineRows } = await supabase
        .from('design_boq_line_items')
        .select('*')
        .eq('boq_id', activeBoq.id)
        .order('item_name')
      setLines((lineRows ?? []) as LineItem[])
    } else {
      setLines([])
    }
    setLoading(false)
  }

  // ─── BOQ creation ───────────────────────────────────────────────────────────
  async function createBOQ() {
    setError(null); setBusy(true)
    const { data, error: insErr } = await supabase
      .from('design_boqs')
      .insert({
        project_id: ctx.project.id,
        kind: 'internal',
        version: 1,
        total_amount: 0,
        is_active: true,
        status: 'draft',
        created_by: ctx.currentUserId,
      })
      .select('*')
      .single()
    setBusy(false)
    if (insErr || !data) { setError(insErr?.message ?? 'Failed to create BOQ'); return }
    setBoq(data as BOQ)
  }

  // ─── Drafts (new rows not yet persisted) ────────────────────────────────────
  function addDraft() {
    setDrafts(prev => [...prev, {
      draftKey: crypto.randomUUID(),
      item_name: '',
      material_spec: '',
      unit: '',
      quantity: '',
      unit_price: '',
    }])
  }

  function updateDraft(key: string, patch: Partial<DraftLine>) {
    setDrafts(prev => prev.map(d => d.draftKey === key ? { ...d, ...patch } : d))
  }

  function removeDraft(key: string) {
    setDrafts(prev => prev.filter(d => d.draftKey !== key))
  }

  async function saveDraft(key: string) {
    const d = drafts.find(d => d.draftKey === key)
    if (!d || !boq) return
    if (!d.item_name.trim()) { setError('Item name is required.'); return }
    const qty = d.quantity === '' ? null : Number(d.quantity)
    const price = d.unit_price === '' ? null : Number(d.unit_price)
    if (qty !== null && !Number.isFinite(qty)) { setError('Quantity must be a number.'); return }
    if (price !== null && !Number.isFinite(price)) { setError('Unit price must be a number.'); return }

    setBusy(true); setError(null)
    const { error: insErr } = await supabase.from('design_boq_line_items').insert({
      boq_id: boq.id,
      item_name: d.item_name.trim(),
      material_spec: d.material_spec.trim() || null,
      unit: d.unit.trim() || null,
      quantity: qty,
      unit_price: price,
    })
    setBusy(false)
    if (insErr) { setError(insErr.message); return }
    removeDraft(key)
    await reloadAndSyncTotal()
  }

  // ─── Existing line item edits ───────────────────────────────────────────────
  function patchLine(id: string, patch: Partial<LineItem>) {
    setEditing(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function saveLine(id: string) {
    const patch = editing[id]
    if (!patch) return
    setBusy(true); setError(null)

    const payload: Record<string, unknown> = {}
    if ('item_name' in patch) payload.item_name = patch.item_name
    if ('material_spec' in patch) payload.material_spec = patch.material_spec || null
    if ('unit' in patch) payload.unit = patch.unit || null
    if ('quantity' in patch) {
      const q = patch.quantity
      payload.quantity = (q === null || q === undefined || q === '' as unknown as number) ? null : Number(q)
    }
    if ('unit_price' in patch) {
      const p = patch.unit_price
      payload.unit_price = (p === null || p === undefined || p === '' as unknown as number) ? null : Number(p)
    }

    const { error: upErr } = await supabase
      .from('design_boq_line_items')
      .update(payload)
      .eq('id', id)
    setBusy(false)
    if (upErr) { setError(upErr.message); return }
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
    await reloadAndSyncTotal()
  }

  async function deleteLine(id: string) {
    if (!confirm('Remove this line item?')) return
    setBusy(true); setError(null)
    const { error: delErr } = await supabase.from('design_boq_line_items').delete().eq('id', id)
    setBusy(false)
    if (delErr) { setError(delErr.message); return }
    await reloadAndSyncTotal()
  }

  // ─── Reload + total sync ────────────────────────────────────────────────────
  async function reloadAndSyncTotal() {
    if (!boq) return
    const { data: lineRows } = await supabase
      .from('design_boq_line_items')
      .select('*')
      .eq('boq_id', boq.id)
      .order('item_name')
    const fresh = (lineRows ?? []) as LineItem[]
    setLines(fresh)
    const total = fresh.reduce((s, l) => s + Number(l.total_price ?? 0), 0)
    await supabase.from('design_boqs').update({ total_amount: total }).eq('id', boq.id)
    setBoq(prev => prev ? { ...prev, total_amount: total } : prev)
  }

  // ─── Submit / Review actions ────────────────────────────────────────────────
  async function submitForReview() {
    if (!boq) return
    if (lines.length === 0) { setError('Add at least one line item before submitting.'); return }
    if (drafts.length > 0) { setError('Save or remove unsaved draft rows first.'); return }
    setBusy(true); setError(null)

    const { error: upErr } = await supabase
      .from('design_boqs')
      .update({
        status: 'pending_th',
        submitted_at: new Date().toISOString(),
        th_comment: null,
      })
      .eq('id', boq.id)
    setBusy(false)
    if (upErr) { setError(upErr.message); return }

    await supabase.from('design_alerts').insert({
      project_id: ctx.project.id,
      alert_type: 'boq_submitted',
      recipient_role: 'team_head',
      recipient_id: ctx.project.team_head_id,
      payload: {
        project_name: ctx.project.project_name,
        boq_version: boq.version,
        line_count: lines.length,
        total_amount: boq.total_amount,
      },
    })

    setBoq(prev => prev ? { ...prev, status: 'pending_th', submitted_at: new Date().toISOString() } : prev)
  }

  async function submitTHReview(decision: 'approved' | 'revise') {
    if (!boq) return
    if (decision === 'revise' && !reviewComment.trim()) {
      setError('Add a comment explaining the revision needed.')
      return
    }
    setBusy(true); setError(null)

    const newStatus: BOQStatus = decision === 'approved' ? 'th_approved' : 'th_revise'
    const { error: upErr } = await supabase
      .from('design_boqs')
      .update({
        status: newStatus,
        th_reviewed_by: ctx.currentUserId,
        th_reviewed_at: new Date().toISOString(),
        th_comment: reviewComment.trim() || null,
      })
      .eq('id', boq.id)

    if (upErr) { setError(upErr.message); setBusy(false); return }

    await supabase.from('design_alerts').insert({
      project_id: ctx.project.id,
      alert_type: decision === 'approved' ? 'boq_th_approved' : 'boq_th_revise',
      recipient_role: 'designer',
      recipient_id: boq.created_by,
      payload: {
        project_name: ctx.project.project_name,
        boq_version: boq.version,
        comment: reviewComment.trim() || null,
      },
    })

    setReviewComment(''); setReviewing(null)
    setBoq(prev => prev ? {
      ...prev,
      status: newStatus,
      th_reviewed_at: new Date().toISOString(),
      th_comment: reviewComment.trim() || null,
    } : prev)
    setBusy(false)

    // Auto-advance to Stage 6 when TH approves
    if (decision === 'approved') {
      const result = await advanceProject({
        project: ctx.project,
        members: ctx.members,
        actorId: ctx.currentUserId,
        to: 6,
        reason: 'Stage 5 BOQ approved by Team Head.',
      })
      if (result.ok) await ctx.refresh()
      else setError(`Auto-advance failed: ${result.error}`)
    }
  }

  if (loading) return <div className="h-24 rounded bg-surface animate-pulse" />

  // ─── Render: no BOQ yet ────────────────────────────────────────────────────
  if (!boq) {
    return (
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Structured BOQ Entry</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Transcribe the founder-approved BOQ file into line items so the founder can split Internal vs External at Stage 6.
          </p>
        </div>
        {isDesigner ? (
          <Button size="sm" onClick={createBOQ} disabled={busy}>
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
            {busy ? 'Creating…' : 'Start Internal BOQ v1'}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Waiting for designer to start the structured BOQ.</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  // ─── Render: BOQ + line items ──────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Structured BOQ Entry</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Internal BOQ v{boq.version} · designer adds line items, TH approves, project advances to Stage 6.
          </p>
        </div>
        <Badge variant={STATUS_META[boq.status].variant} className="text-[10px] flex-shrink-0">
          {STATUS_META[boq.status].label}
        </Badge>
      </div>

      {boq.th_comment && (
        <div className="flex items-start gap-1.5 text-xs rounded-md bg-warning/10 border border-warning/20 px-3 py-2">
          <MessageSquare className="h-3 w-3 text-warning mt-0.5 flex-shrink-0" />
          <span><span className="text-muted-foreground">Team Head: </span>{boq.th_comment}</span>
        </div>
      )}

      {/* Line items table */}
      <div className="rounded-md border border-border bg-background/30 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface/60 text-muted-foreground">
            <tr className="text-left">
              <th className="px-2 py-2 font-medium">Item *</th>
              <th className="px-2 py-2 font-medium">Spec</th>
              <th className="px-2 py-2 font-medium">Unit</th>
              <th className="px-2 py-2 font-medium text-right">Qty</th>
              <th className="px-2 py-2 font-medium text-right">Unit ₹</th>
              <th className="px-2 py-2 font-medium text-right">Total ₹</th>
              {canEdit && <th className="px-2 py-2 w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && drafts.length === 0 && (
              <tr><td colSpan={canEdit ? 7 : 6} className="px-3 py-4 text-center text-muted-foreground">
                No line items yet.
              </td></tr>
            )}
            {lines.map(l => {
              const e = editing[l.id]
              const get = <K extends keyof LineItem>(k: K): LineItem[K] =>
                (e && k in e ? (e as Partial<LineItem>)[k] : l[k]) as LineItem[K]
              const dirty = !!e
              return (
                <tr key={l.id} className="border-t border-border/60">
                  <td className="px-2 py-1.5">
                    {canEdit
                      ? <Input className="h-7 text-xs" value={get('item_name') ?? ''} onChange={ev => patchLine(l.id, { item_name: ev.target.value })} />
                      : <span className="text-foreground">{l.item_name}</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    {canEdit
                      ? <Input className="h-7 text-xs" value={get('material_spec') ?? ''} onChange={ev => patchLine(l.id, { material_spec: ev.target.value })} />
                      : <span className="text-foreground-secondary">{l.material_spec ?? '—'}</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    {canEdit
                      ? <Input className="h-7 text-xs w-16" value={get('unit') ?? ''} onChange={ev => patchLine(l.id, { unit: ev.target.value })} />
                      : <span className="text-foreground-secondary">{l.unit ?? '—'}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {canEdit
                      ? <Input className="h-7 text-xs w-20 text-right" type="number" value={String(get('quantity') ?? '')} onChange={ev => patchLine(l.id, { quantity: ev.target.value === '' ? null : Number(ev.target.value) })} />
                      : <span className="text-foreground-secondary">{l.quantity ?? '—'}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {canEdit
                      ? <Input className="h-7 text-xs w-24 text-right" type="number" value={String(get('unit_price') ?? '')} onChange={ev => patchLine(l.id, { unit_price: ev.target.value === '' ? null : Number(ev.target.value) })} />
                      : <span className="text-foreground-secondary">{l.unit_price != null ? Number(l.unit_price).toLocaleString('en-IN') : '—'}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right text-foreground">
                    {l.total_price != null ? Number(l.total_price).toLocaleString('en-IN') : '—'}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1 justify-end">
                        {dirty && (
                          <button onClick={() => saveLine(l.id)} disabled={busy} className="text-accent-400 hover:text-accent-300" title="Save">
                            <Save className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => deleteLine(l.id)} disabled={busy} className="text-muted-foreground hover:text-destructive" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
            {drafts.map(d => {
              const qty = d.quantity === '' ? null : Number(d.quantity)
              const price = d.unit_price === '' ? null : Number(d.unit_price)
              const total = (qty != null && price != null && Number.isFinite(qty) && Number.isFinite(price)) ? qty * price : null
              return (
                <tr key={d.draftKey} className="border-t border-border/60 bg-accent-500/5">
                  <td className="px-2 py-1.5">
                    <Input className="h-7 text-xs" placeholder="Item name *" value={d.item_name} onChange={ev => updateDraft(d.draftKey, { item_name: ev.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="h-7 text-xs" placeholder="Spec" value={d.material_spec} onChange={ev => updateDraft(d.draftKey, { material_spec: ev.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="h-7 text-xs w-16" placeholder="sqft" value={d.unit} onChange={ev => updateDraft(d.draftKey, { unit: ev.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Input className="h-7 text-xs w-20 text-right" type="number" placeholder="0" value={d.quantity} onChange={ev => updateDraft(d.draftKey, { quantity: ev.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Input className="h-7 text-xs w-24 text-right" type="number" placeholder="0" value={d.unit_price} onChange={ev => updateDraft(d.draftKey, { unit_price: ev.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 text-right text-foreground">
                    {total != null ? total.toLocaleString('en-IN') : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => saveDraft(d.draftKey)} disabled={busy} className="text-accent-400 hover:text-accent-300" title="Save">
                        <Save className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => removeDraft(d.draftKey)} disabled={busy} className="text-muted-foreground hover:text-destructive" title="Discard">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-surface/40">
              <td colSpan={5} className="px-2 py-2 text-right font-medium text-muted-foreground">Total</td>
              <td className="px-2 py-2 text-right font-medium text-foreground">
                ₹ {Number(boq.total_amount).toLocaleString('en-IN')}
              </td>
              {canEdit && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Designer controls */}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={addDraft} disabled={busy}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add line
          </Button>
          <Button size="sm" onClick={submitForReview} disabled={busy || lines.length === 0 || drafts.length > 0}>
            <Send className="h-3.5 w-3.5 mr-1" />
            {busy ? 'Saving…' : 'Submit for TH review'}
          </Button>
        </div>
      )}

      {boq.status === 'pending_th' && !canTHReview && (
        <p className="text-xs text-muted-foreground">Awaiting Team Head review.</p>
      )}

      {/* Team Head review */}
      {canTHReview && !reviewing && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setReviewing('approve')}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            Team Head: Approve & advance to Stage 6
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setReviewing('revise')}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Request revision
          </Button>
        </div>
      )}

      {canTHReview && reviewing && (
        <div className="space-y-2 rounded-md border border-border bg-surface/40 p-3">
          <Label htmlFor="th-comment" className="text-xs">
            {reviewing === 'approve' ? 'Approval note (optional)' : 'What needs to change?'}
          </Label>
          <Textarea
            id="th-comment"
            rows={2}
            value={reviewComment}
            onChange={e => setReviewComment(e.target.value)}
            placeholder={reviewing === 'approve' ? 'Looks good…' : 'Add the missing plumbing items, revise unit prices on row 4…'}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submitTHReview(reviewing === 'approve' ? 'approved' : 'revise')} disabled={busy}>
              {busy ? 'Saving…' : reviewing === 'approve' ? 'Confirm approve' : 'Send back for revision'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setReviewing(null); setReviewComment(''); setError(null) }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {boq.status === 'th_approved' && (
        <p className="text-xs text-success">BOQ approved. Advancing to Stage 6…</p>
      )}
    </div>
  )
}
