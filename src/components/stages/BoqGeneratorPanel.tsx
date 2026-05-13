import { useEffect, useRef, useState } from 'react'
import { Sparkles, Download, AlertCircle, RotateCcw, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PROJECT_TYPES, type ProjectType } from '@/lib/boqRateCard'
import type { ProjectDetailContext } from './types'

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface BoqGenJob {
  id: string
  project_id: string
  status: JobStatus
  input_pdf_path: string | null
  total_area_sqft: number | null
  project_type: string | null
  ceiling_height_ft: number | null
  notes: string | null
  output_excel_path: string | null
  output_excel_signed_url: string | null
  boq_summary: { grandTotal?: number; gst18Pct?: number; totalWithGst?: number; totalSpaces?: number } | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

interface LayoutDeliverable {
  id: string
  file_path: string
  file_name: string | null
  version: number
}

export function BoqGeneratorPanel({
  ctx,
  currentLayout,
}: {
  ctx: ProjectDetailContext
  currentLayout: LayoutDeliverable | null
}) {
  const [job, setJob] = useState<BoqGenJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [areaInput, setAreaInput] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('office')
  const [ceilingHeight, setCeilingHeight] = useState('9')
  const [notes, setNotes] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const webhookUrl = import.meta.env.VITE_N8N_BOQ_WEBHOOK_URL as string | undefined
  const canTrigger = ctx.isAssignedMember || ctx.isTeamHead || ctx.isFounder
  const layoutReady = currentLayout != null

  useEffect(() => {
    void loadLatest()
  }, [ctx.project.id])

  // Poll while a job is processing so the UI updates without a hard refresh
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (job?.status === 'pending' || job?.status === 'processing') {
      pollRef.current = setInterval(() => { void loadLatest() }, 5000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [job?.status])

  async function loadLatest() {
    const { data } = await supabase
      .from('design_boq_generation_jobs')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setJob((data ?? null) as BoqGenJob | null)
    setLoading(false)
  }

  async function startGeneration() {
    setError(null)
    if (!webhookUrl) {
      setError('VITE_N8N_BOQ_WEBHOOK_URL is not configured. Add it to .env.local and rebuild.')
      return
    }
    if (!currentLayout) {
      setError('Upload the layout PDF in the Layout panel below first.')
      return
    }
    const area = Number(areaInput)
    if (!Number.isFinite(area) || area <= 0) {
      setError('Enter a positive total floor area in sqft.')
      return
    }
    const ceiling = Number(ceilingHeight)
    if (!Number.isFinite(ceiling) || ceiling <= 0) {
      setError('Ceiling height must be a positive number.')
      return
    }

    setSubmitting(true)
    try {
      // 1. Signed URL for the layout PDF — n8n downloads it from here.
      const { data: signed, error: signedErr } = await supabase.storage
        .from('design-deliverables')
        .createSignedUrl(currentLayout.file_path, 600)
      if (signedErr || !signed?.signedUrl) {
        throw new Error(signedErr?.message ?? 'Could not create signed URL for layout PDF')
      }

      // 2. Insert job row first so n8n can write back to it by id.
      const { data: row, error: insErr } = await supabase
        .from('design_boq_generation_jobs')
        .insert({
          project_id: ctx.project.id,
          created_by: ctx.currentUserId,
          status: 'pending',
          input_pdf_path: currentLayout.file_path,
          total_area_sqft: area,
          project_type: projectType,
          ceiling_height_ft: ceiling,
          notes: notes.trim() || null,
        })
        .select('*')
        .single()
      if (insErr || !row) throw new Error(insErr?.message ?? 'Failed to create generation job')
      setJob(row as BoqGenJob)

      // 3. Fire-and-forget webhook to n8n. n8n responds 200 immediately and
      //    writes status updates back via the Supabase service-role key.
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: row.id,
          project_id: ctx.project.id,
          project_name: ctx.project.project_name,
          pdf_signed_url: signed.signedUrl,
          total_area_sqft: area,
          project_type: projectType,
          ceiling_height_ft: ceiling,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        // Mark the job failed so the UI doesn't sit on "pending" forever.
        await supabase
          .from('design_boq_generation_jobs')
          .update({ status: 'failed', error_message: `Webhook responded ${res.status}` })
          .eq('id', row.id)
        throw new Error(`Webhook responded ${res.status}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function resetForRetry() {
    setJob(null)
    setError(null)
  }

  if (loading) {
    return <div className="h-20 rounded bg-surface animate-pulse" />
  }

  // ─── No webhook configured: passive copy ────────────────────────────────────
  if (!webhookUrl) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background/30 px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 mb-1 text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent-400" />
          <span className="font-medium">AI BOQ Generator</span>
          <Badge variant="secondary" className="text-[10px]">not configured</Badge>
        </div>
        Set <code className="text-accent-400">VITE_N8N_BOQ_WEBHOOK_URL</code> in <code>.env.local</code> and restart the dev server to enable.
      </div>
    )
  }

  // ─── Active job summary ────────────────────────────────────────────────────
  const jobActive = job && (job.status === 'pending' || job.status === 'processing')
  const jobDone = job && job.status === 'completed'
  const jobFailed = job && job.status === 'failed'

  return (
    <div className="rounded-md border border-accent-500/30 bg-accent-500/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent-400" />
            AI BOQ Generator
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload the layout PDF first, then generate a costed draft BOQ in 2–4 minutes. Review the Excel, edit if needed, and upload as the final BOQ below.
          </p>
        </div>
        {job && (
          <StatusBadge status={job.status} />
        )}
      </div>

      {!layoutReady && (
        <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          Upload the Layout file in the Layout panel below before triggering generation.
        </div>
      )}

      {/* Active job — show progress, hide form */}
      {jobActive && (
        <div className="flex items-center gap-2 text-xs text-foreground-secondary rounded-md border border-border bg-background/40 px-3 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-400" />
          <span>
            {job?.status === 'pending'
              ? 'Queued — n8n picking up the job…'
              : 'Analysing layout (Claude Vision + rate card). This usually takes 2–4 minutes.'}
          </span>
        </div>
      )}

      {/* Completed — download + retry */}
      {jobDone && job && (
        <div className="space-y-2">
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-3 space-y-2">
            <div className="text-sm text-success font-medium">Draft BOQ ready</div>
            {job.boq_summary && (
              <div className="text-xs text-foreground-secondary flex flex-wrap gap-x-4 gap-y-1">
                {job.boq_summary.totalSpaces != null && <span>{job.boq_summary.totalSpaces} spaces</span>}
                {job.boq_summary.grandTotal != null && (
                  <span>Total ₹ {Number(job.boq_summary.grandTotal).toLocaleString('en-IN')}</span>
                )}
                {job.boq_summary.gst18Pct != null && (
                  <span>+ GST ₹ {Number(job.boq_summary.gst18Pct).toLocaleString('en-IN')}</span>
                )}
                {job.boq_summary.totalWithGst != null && (
                  <span className="text-foreground">= ₹ {Number(job.boq_summary.totalWithGst).toLocaleString('en-IN')}</span>
                )}
              </div>
            )}
            {job.output_excel_signed_url ? (
              <a
                href={job.output_excel_signed_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-success/20 hover:bg-success/30 text-success px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download generated BOQ (.xlsx)
              </a>
            ) : (
              <p className="text-xs text-warning">Signed URL missing — try regenerating.</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Review and edit the Excel, then upload your final version through the BOQ panel below — it enters the standard TH → Founder review pipeline.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={resetForRetry}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Generate again with different inputs
          </Button>
        </div>
      )}

      {/* Failed — show error + retry */}
      {jobFailed && job && (
        <div className="space-y-2">
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Generation failed: {job.error_message ?? 'Unknown error'}
          </div>
          <Button size="sm" variant="secondary" onClick={resetForRetry}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Try again
          </Button>
        </div>
      )}

      {/* No active job — show input form */}
      {!jobActive && !jobDone && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="boq-area" className="text-xs">Total floor area (sqft) *</Label>
              <Input
                id="boq-area"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 2765"
                value={areaInput}
                onChange={e => setAreaInput(e.target.value)}
                disabled={!canTrigger || submitting}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Project type</Label>
              <Select value={projectType} onValueChange={v => setProjectType(v as ProjectType)} disabled={!canTrigger || submitting}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{labelFor(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="boq-ceiling" className="text-xs">Ceiling height (ft)</Label>
              <Input
                id="boq-ceiling"
                type="number"
                min="0"
                step="0.5"
                value={ceilingHeight}
                onChange={e => setCeilingHeight(e.target.value)}
                disabled={!canTrigger || submitting}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="boq-notes" className="text-xs">Notes (optional)</Label>
              <Input
                id="boq-notes"
                placeholder="Premium finishes, specific brand preferences…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={!canTrigger || submitting}
              />
            </div>
          </div>

          {notes.length > 80 && (
            <div className="space-y-1">
              <Label htmlFor="boq-notes-long" className="text-xs">Notes (long form)</Label>
              <Textarea
                id="boq-notes-long"
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={!canTrigger || submitting}
              />
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          {canTrigger ? (
            <Button size="sm" onClick={startGeneration} disabled={submitting || !layoutReady}>
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              {submitting ? 'Starting…' : 'Generate BOQ from layout'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Only the assigned designer / TH / Founder can trigger generation.</p>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: JobStatus }) {
  switch (status) {
    case 'pending':    return <Badge variant="secondary" className="text-[10px]">Queued</Badge>
    case 'processing': return <Badge variant="secondary" className="text-[10px]">Processing…</Badge>
    case 'completed':  return <Badge variant="success"   className="text-[10px]">Ready</Badge>
    case 'failed':     return <Badge variant="destructive" className="text-[10px]">Failed</Badge>
  }
}

function labelFor(t: ProjectType): string {
  switch (t) {
    case 'office':       return 'Office fit-out'
    case 'gym':          return 'Gym / sports facility'
    case 'hospitality':  return 'Restaurant / cafe / hospitality'
    case 'retail':       return 'Retail / showroom'
    case 'residential':  return 'Residential'
    case 'clubhouse':    return 'Club house / society'
    case 'other':        return 'Other'
  }
}
