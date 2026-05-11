import { useEffect, useMemo, useState } from 'react'
import { Save, ArrowRight, AlertCircle, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { advanceProject } from '@/lib/projectActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { ProjectDetailContext } from './types'

type MarginMode = 'flat_pct' | 'per_line_pct' | 'per_line_abs'

interface BOQ {
  id: string
  project_id: string
  kind: 'internal' | 'external'
  version: number
  total_amount: number
  margin_mode: MarginMode | null
  is_active: boolean
  status: string
  created_by: string
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

interface MarginRow {
  id: string
  boq_id: string
  line_item_id: string | null
  mode: MarginMode
  value: number
}

const MODE_LABEL: Record<MarginMode, string> = {
  flat_pct:     'Flat % across all lines',
  per_line_pct: 'Percentage per line',
  per_line_abs: 'Absolute external price per line',
}

export function Stage6TwoBOQSplit({ ctx }: { ctx: ProjectDetailContext }) {
  const [internalBoq, setInternalBoq] = useState<BOQ | null>(null)
  const [externalBoq, setExternalBoq] = useState<BOQ | null>(null)
  const [internalLines, setInternalLines] = useState<LineItem[]>([])
  const [externalLines, setExternalLines] = useState<LineItem[]>([])
  const [existingMargins, setExistingMargins] = useState<MarginRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Editor state (only used while no external BOQ has been saved)
  const [mode, setMode] = useState<MarginMode>('flat_pct')
  const [flatPct, setFlatPct] = useState<string>('25')
  const [perLineValues, setPerLineValues] = useState<Record<string, string>>({})

  const canSplit = ctx.isFounder
  const alreadySplit = externalBoq != null

  useEffect(() => { void load() }, [ctx.project.id])

  async function load() {
    const { data: boqs } = await supabase
      .from('design_boqs')
      .select('*')
      .eq('project_id', ctx.project.id)
      .eq('is_active', true)
      .order('kind')
    const all = (boqs ?? []) as BOQ[]
    const internal = all.find(b => b.kind === 'internal') ?? null
    const external = all.find(b => b.kind === 'external') ?? null
    setInternalBoq(internal)
    setExternalBoq(external)

    if (internal) {
      const { data } = await supabase
        .from('design_boq_line_items')
        .select('*')
        .eq('boq_id', internal.id)
        .order('item_name')
      setInternalLines((data ?? []) as LineItem[])
    }
    if (external) {
      const [{ data: extLines }, { data: extMargins }] = await Promise.all([
        supabase.from('design_boq_line_items').select('*').eq('boq_id', external.id).order('item_name'),
        supabase.from('design_boq_margins').select('*').eq('boq_id', external.id),
      ])
      setExternalLines((extLines ?? []) as LineItem[])
      setExistingMargins((extMargins ?? []) as MarginRow[])
    }
    setLoading(false)
  }

  // ─── Live preview of external prices ────────────────────────────────────────
  const previewLines = useMemo(() => {
    if (alreadySplit) return null
    const pct = Number(flatPct)
    return internalLines.map(l => {
      const internalUnit = Number(l.unit_price ?? 0)
      const qty = Number(l.quantity ?? 0)
      let externalUnit: number | null = null
      let marginValue: number | null = null
      if (mode === 'flat_pct') {
        if (Number.isFinite(pct)) {
          externalUnit = +(internalUnit * (1 + pct / 100)).toFixed(2)
          marginValue = pct
        }
      } else if (mode === 'per_line_pct') {
        const v = perLineValues[l.id]
        if (v != null && v !== '') {
          const p = Number(v)
          if (Number.isFinite(p)) {
            externalUnit = +(internalUnit * (1 + p / 100)).toFixed(2)
            marginValue = p
          }
        }
      } else {
        const v = perLineValues[l.id]
        if (v != null && v !== '') {
          const a = Number(v)
          if (Number.isFinite(a)) {
            externalUnit = +a
            marginValue = a
          }
        }
      }
      const externalTotal = externalUnit != null ? +(externalUnit * qty).toFixed(2) : null
      return { line: l, externalUnit, externalTotal, marginValue }
    })
  }, [alreadySplit, internalLines, mode, flatPct, perLineValues])

  const internalTotal = useMemo(
    () => internalLines.reduce((s, l) => s + Number(l.total_price ?? 0), 0),
    [internalLines]
  )

  const previewExternalTotal = useMemo(() => {
    if (!previewLines) return null
    return previewLines.reduce((s, p) => s + Number(p.externalTotal ?? 0), 0)
  }, [previewLines])

  const projectBudget = ctx.project.budget_amount ?? 0
  const allPreviewFilled = previewLines != null && previewLines.every(p => p.externalUnit != null && Number.isFinite(p.externalUnit))

  // ─── Save (create external BOQ + line items + margins, then advance) ───────
  async function saveSplit() {
    if (!canSplit || !internalBoq) return
    if (internalLines.length === 0) { setError('Internal BOQ has no line items.'); return }
    if (!allPreviewFilled) { setError('Every line needs a margin / external price before saving.'); return }

    setBusy(true); setError(null)

    // 1. Create the external BOQ row
    const externalTotal = previewExternalTotal ?? 0
    const { data: newBoq, error: boqErr } = await supabase
      .from('design_boqs')
      .insert({
        project_id: ctx.project.id,
        kind: 'external',
        version: 1,
        total_amount: externalTotal,
        margin_mode: mode,
        is_active: true,
        status: 'th_approved',
        created_by: ctx.currentUserId,
      })
      .select('*')
      .single()

    if (boqErr || !newBoq) { setError(boqErr?.message ?? 'Failed to create external BOQ.'); setBusy(false); return }

    // 2. Create external line items, mirroring the internal ones with new unit_price
    const linePayload = previewLines!.map(p => ({
      boq_id: newBoq.id,
      item_name: p.line.item_name,
      material_spec: p.line.material_spec,
      unit: p.line.unit,
      quantity: p.line.quantity,
      unit_price: p.externalUnit,
      notes: p.line.notes,
    }))
    const { data: extLines, error: lineErr } = await supabase
      .from('design_boq_line_items')
      .insert(linePayload)
      .select('id, item_name')

    if (lineErr || !extLines) { setError(lineErr?.message ?? 'Failed to create external line items.'); setBusy(false); return }

    // 3. Create margin rows
    let marginPayload: { boq_id: string; line_item_id: string | null; mode: MarginMode; value: number }[] = []
    if (mode === 'flat_pct') {
      marginPayload = [{ boq_id: newBoq.id, line_item_id: null, mode, value: Number(flatPct) }]
    } else {
      // map external line items back by item_name to find their id
      const idByName: Record<string, string> = {}
      ;(extLines as { id: string; item_name: string }[]).forEach(l => { idByName[l.item_name] = l.id })
      marginPayload = previewLines!
        .filter(p => p.marginValue != null && idByName[p.line.item_name])
        .map(p => ({
          boq_id: newBoq.id,
          line_item_id: idByName[p.line.item_name],
          mode,
          value: p.marginValue!,
        }))
    }

    if (marginPayload.length > 0) {
      const { error: marErr } = await supabase.from('design_boq_margins').insert(marginPayload)
      if (marErr) { setError(`External BOQ saved but margins failed: ${marErr.message}`); setBusy(false); return }
    }

    // 4. Stamp the project's margin_mode for downstream consumers
    await supabase
      .from('design_projects')
      .update({ margin_mode: mode })
      .eq('id', ctx.project.id)

    // 5. Auto-advance to Stage 7
    const adv = await advanceProject({
      project: ctx.project,
      members: ctx.members,
      actorId: ctx.currentUserId,
      to: 7,
      reason: `External BOQ created (${mode}); total ₹${externalTotal.toLocaleString('en-IN')}.`,
      payload: { external_boq_id: newBoq.id, margin_mode: mode },
    })
    setBusy(false)
    if (!adv.ok) { setError(`Saved but auto-advance failed: ${adv.error}`); await load(); return }
    await ctx.refresh()
  }

  if (loading) return <div className="h-24 rounded bg-surface animate-pulse" />

  if (!internalBoq) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
        <AlertCircle className="h-5 w-5 text-warning mx-auto mb-2" />
        <p className="text-sm text-foreground">Internal BOQ missing.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Stage 5 should have produced a TH-approved Internal BOQ before reaching Stage 6.
        </p>
      </div>
    )
  }

  // ─── Read-only view if split has already happened ───────────────────────────
  if (alreadySplit) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Two-BOQ Split</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            External BOQ has been generated. The split is locked at Stage 7+; revisions would require Founder action.
          </p>
        </div>

        <SummaryRow internal={internalTotal} external={Number(externalBoq.total_amount)} budget={projectBudget} mode={externalBoq.margin_mode} />

        <SideBySideTable internal={internalLines} external={externalLines} marginMode={externalBoq.margin_mode} margins={existingMargins} />
      </div>
    )
  }

  // ─── Editor view (founder only) ─────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Two-BOQ Split</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick a margin mode and review per-line external prices. Saving creates the External BOQ + margin records and advances the project to Stage 7.
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px]">Internal v{internalBoq.version}</Badge>
      </div>

      {!canSplit && (
        <div className="flex items-center gap-2 rounded-md bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
          <Lock className="h-3.5 w-3.5" />
          Only the Founder can split the BOQ.
        </div>
      )}

      {/* Margin mode picker */}
      <fieldset className="space-y-2" disabled={!canSplit || busy}>
        <Label className="text-xs">Margin mode</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(['flat_pct', 'per_line_pct', 'per_line_abs'] as MarginMode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                'rounded-md border px-3 py-2 text-left text-xs transition-colors '
                + (mode === m
                  ? 'border-accent-500 bg-accent-500/10 text-foreground'
                  : 'border-border bg-background/30 text-foreground-secondary hover:bg-surface')
              }
            >
              <div className="font-medium text-foreground">{m.replace('_', ' ')}</div>
              <div className="text-muted-foreground">{MODE_LABEL[m]}</div>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Mode-specific inputs */}
      {mode === 'flat_pct' && (
        <div className="space-y-1 max-w-xs">
          <Label htmlFor="flat-pct" className="text-xs">Flat margin (%)</Label>
          <Input
            id="flat-pct"
            type="number"
            min="0"
            step="0.1"
            value={flatPct}
            onChange={e => setFlatPct(e.target.value)}
            disabled={!canSplit || busy}
          />
        </div>
      )}

      {/* Editable preview table */}
      <div className="rounded-md border border-border bg-background/30 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface/60 text-muted-foreground">
            <tr className="text-left">
              <th className="px-2 py-2 font-medium">Item</th>
              <th className="px-2 py-2 font-medium">Unit</th>
              <th className="px-2 py-2 font-medium text-right">Qty</th>
              <th className="px-2 py-2 font-medium text-right">Internal unit ₹</th>
              <th className="px-2 py-2 font-medium text-right">Internal total ₹</th>
              {mode === 'per_line_pct' && <th className="px-2 py-2 font-medium text-right">Margin %</th>}
              {mode === 'per_line_abs' && <th className="px-2 py-2 font-medium text-right">External unit ₹</th>}
              <th className="px-2 py-2 font-medium text-right">External total ₹</th>
            </tr>
          </thead>
          <tbody>
            {previewLines!.map(p => (
              <tr key={p.line.id} className="border-t border-border/60">
                <td className="px-2 py-1.5 text-foreground">{p.line.item_name}</td>
                <td className="px-2 py-1.5 text-foreground-secondary">{p.line.unit ?? '—'}</td>
                <td className="px-2 py-1.5 text-right text-foreground-secondary">{p.line.quantity ?? '—'}</td>
                <td className="px-2 py-1.5 text-right text-foreground-secondary">
                  {p.line.unit_price != null ? Number(p.line.unit_price).toLocaleString('en-IN') : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-foreground-secondary">
                  {p.line.total_price != null ? Number(p.line.total_price).toLocaleString('en-IN') : '—'}
                </td>
                {mode === 'per_line_pct' && (
                  <td className="px-2 py-1.5 text-right">
                    <Input
                      type="number"
                      step="0.1"
                      className="h-7 w-20 text-xs text-right"
                      value={perLineValues[p.line.id] ?? ''}
                      onChange={e => setPerLineValues(prev => ({ ...prev, [p.line.id]: e.target.value }))}
                      disabled={!canSplit || busy}
                      placeholder="%"
                    />
                  </td>
                )}
                {mode === 'per_line_abs' && (
                  <td className="px-2 py-1.5 text-right">
                    <Input
                      type="number"
                      step="0.01"
                      className="h-7 w-28 text-xs text-right"
                      value={perLineValues[p.line.id] ?? ''}
                      onChange={e => setPerLineValues(prev => ({ ...prev, [p.line.id]: e.target.value }))}
                      disabled={!canSplit || busy}
                      placeholder="₹"
                    />
                  </td>
                )}
                <td className="px-2 py-1.5 text-right text-foreground">
                  {p.externalTotal != null ? Number(p.externalTotal).toLocaleString('en-IN') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-surface/40 text-foreground">
              <td colSpan={4} className="px-2 py-2 text-right font-medium text-muted-foreground">Totals</td>
              <td className="px-2 py-2 text-right font-medium">
                ₹ {Number(internalTotal).toLocaleString('en-IN')}
              </td>
              {(mode === 'per_line_pct' || mode === 'per_line_abs') && <td />}
              <td className="px-2 py-2 text-right font-medium">
                {previewExternalTotal != null ? `₹ ${Number(previewExternalTotal).toLocaleString('en-IN')}` : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <SummaryRow internal={internalTotal} external={previewExternalTotal ?? 0} budget={projectBudget} mode={mode} />

      {error && <p className="text-xs text-destructive">{error}</p>}

      {canSplit && (
        <div className="flex gap-2">
          <Button size="sm" onClick={saveSplit} disabled={busy || !allPreviewFilled}>
            <Save className="h-3.5 w-3.5 mr-1" />
            {busy ? 'Saving…' : 'Save External BOQ'}
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
            Stage 7
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Summary block ────────────────────────────────────────────────────────────
function SummaryRow({ internal, external, budget, mode }: {
  internal: number
  external: number
  budget: number
  mode: MarginMode | null
}) {
  const margin = external - internal
  const marginPct = internal > 0 ? (margin / internal) * 100 : 0
  const budgetVariance = external - budget
  const overBudget = budgetVariance > 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-md border border-border bg-background/30 px-3 py-3">
      <Stat label="Internal total" value={`₹ ${Number(internal).toLocaleString('en-IN')}`} />
      <Stat label="External total" value={`₹ ${Number(external).toLocaleString('en-IN')}`} />
      <Stat
        label="Margin"
        value={`₹ ${Number(margin).toLocaleString('en-IN')} (${marginPct.toFixed(1)}%)`}
        tone={margin > 0 ? 'success' : 'warning'}
      />
      <Stat
        label="vs Budget"
        value={budget > 0 ? `${overBudget ? '+' : ''}₹ ${Number(budgetVariance).toLocaleString('en-IN')}` : '—'}
        tone={overBudget ? 'destructive' : 'success'}
      />
      {mode && (
        <div className="col-span-2 sm:col-span-4 text-[10px] text-muted-foreground pt-1 border-t border-border/40">
          Margin mode: <span className="text-foreground-secondary">{mode}</span>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' | 'destructive' }) {
  const colour = tone === 'success' ? 'text-success'
    : tone === 'warning' ? 'text-warning'
    : tone === 'destructive' ? 'text-destructive'
    : 'text-foreground'
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={'text-sm font-medium ' + colour}>{value}</div>
    </div>
  )
}

function SideBySideTable({
  internal, external, marginMode, margins,
}: {
  internal: LineItem[]
  external: LineItem[]
  marginMode: MarginMode | null
  margins: MarginRow[]
}) {
  const extByName: Record<string, LineItem> = {}
  external.forEach(l => { extByName[l.item_name] = l })
  const marginByLine: Record<string, number> = {}
  margins.forEach(m => { if (m.line_item_id) marginByLine[m.line_item_id] = m.value })
  const flatMargin = margins.find(m => m.line_item_id === null && m.mode === 'flat_pct')?.value

  return (
    <div className="rounded-md border border-border bg-background/30 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-surface/60 text-muted-foreground">
          <tr className="text-left">
            <th className="px-2 py-2 font-medium">Item</th>
            <th className="px-2 py-2 font-medium">Unit</th>
            <th className="px-2 py-2 font-medium text-right">Qty</th>
            <th className="px-2 py-2 font-medium text-right">Internal unit ₹</th>
            <th className="px-2 py-2 font-medium text-right">External unit ₹</th>
            <th className="px-2 py-2 font-medium text-right">Margin</th>
            <th className="px-2 py-2 font-medium text-right">Internal ₹</th>
            <th className="px-2 py-2 font-medium text-right">External ₹</th>
          </tr>
        </thead>
        <tbody>
          {internal.map(l => {
            const ext = extByName[l.item_name]
            const marginVal = ext ? marginByLine[ext.id] ?? flatMargin : flatMargin
            return (
              <tr key={l.id} className="border-t border-border/60">
                <td className="px-2 py-1.5 text-foreground">{l.item_name}</td>
                <td className="px-2 py-1.5 text-foreground-secondary">{l.unit ?? '—'}</td>
                <td className="px-2 py-1.5 text-right text-foreground-secondary">{l.quantity ?? '—'}</td>
                <td className="px-2 py-1.5 text-right text-foreground-secondary">
                  {l.unit_price != null ? Number(l.unit_price).toLocaleString('en-IN') : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-foreground">
                  {ext?.unit_price != null ? Number(ext.unit_price).toLocaleString('en-IN') : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">
                  {marginVal != null
                    ? marginMode === 'per_line_abs'
                      ? `₹${Number(marginVal).toLocaleString('en-IN')}`
                      : `${Number(marginVal).toFixed(1)}%`
                    : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-foreground-secondary">
                  {l.total_price != null ? Number(l.total_price).toLocaleString('en-IN') : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-foreground">
                  {ext?.total_price != null ? Number(ext.total_price).toLocaleString('en-IN') : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

