import { useEffect, useState } from 'react'
import { Plus, CheckCircle2, RotateCcw, Phone, Mail, X, Save, Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { advanceProject } from '@/lib/projectActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ProjectDetailContext } from './types'

interface BOQ {
  id: string
  project_id: string
  kind: 'internal' | 'external'
  version: number
  total_amount: number
  is_active: boolean
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
  vendor_id: string | null
  vendor_confirmed_at: string | null
  vendor_confirmed_by: string | null
  vendor_notes: string | null
}

interface Vendor {
  id: string
  name: string
  phone: string | null
  email: string | null
}

export function Stage8VendorConfirmation({ ctx }: { ctx: ProjectDetailContext }) {
  const [internalBoq, setInternalBoq] = useState<BOQ | null>(null)
  const [lines, setLines] = useState<LineItem[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)

  const isInternal = ctx.isAssignedMember || ctx.isTeamHead || ctx.isFounder
  // Designers do the work, but TH/founder can step in if needed.
  const canConfirm = isInternal

  useEffect(() => { void load() }, [ctx.project.id])

  async function load() {
    const { data: boqRow } = await supabase
      .from('design_boqs')
      .select('*')
      .eq('project_id', ctx.project.id)
      .eq('kind', 'internal')
      .eq('is_active', true)
      .maybeSingle()

    const boq = (boqRow ?? null) as BOQ | null
    setInternalBoq(boq)

    const [linesPromise, vendorsPromise] = [
      boq ? supabase.from('design_boq_line_items').select('*').eq('boq_id', boq.id).order('item_name') : Promise.resolve({ data: [] as LineItem[] }),
      supabase.from('design_vendors').select('id, name, phone, email').order('name'),
    ]
    const [{ data: lineRows }, { data: vendorRows }] = await Promise.all([
      linesPromise as Promise<{ data: LineItem[] | null }>,
      vendorsPromise as Promise<{ data: Vendor[] | null }>,
    ])
    setLines((lineRows ?? []) as LineItem[])
    setVendors((vendorRows ?? []) as Vendor[])
    setLoading(false)
  }

  async function tryAutoAdvance() {
    const { data } = await supabase
      .from('design_boq_line_items')
      .select('id, vendor_id, vendor_confirmed_at')
      .eq('boq_id', internalBoq?.id ?? '')
    const fresh = (data ?? []) as Pick<LineItem, 'id' | 'vendor_id' | 'vendor_confirmed_at'>[]
    if (fresh.length === 0) return
    const allConfirmed = fresh.every(l => l.vendor_id && l.vendor_confirmed_at)
    if (!allConfirmed) return

    setAdvancing(true)
    const result = await advanceProject({
      project: ctx.project,
      members: ctx.members,
      actorId: ctx.currentUserId,
      to: 9,
      reason: `All ${fresh.length} BOQ lines have a vendor + confirmed rate.`,
    })
    setAdvancing(false)
    if (result.ok) await ctx.refresh()
    else setError(`Auto-advance failed: ${result.error}`)
  }

  if (loading) return <div className="h-24 rounded bg-surface animate-pulse" />

  if (!internalBoq) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
        <p className="text-sm text-foreground">Internal BOQ missing.</p>
        <p className="text-xs text-muted-foreground mt-1">Stage 5 should have produced one.</p>
      </div>
    )
  }

  const confirmedCount = lines.filter(l => l.vendor_id && l.vendor_confirmed_at).length
  const totalCount = lines.length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Vendor Confirmation</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Confirm the rate for every line item with a vendor — call, email, or use a known rate. Each line needs a vendor and a confirmation timestamp before the project advances to Stage 9.
          </p>
        </div>
        <Badge variant={confirmedCount === totalCount && totalCount > 0 ? 'success' : 'secondary'} className="text-[10px] flex-shrink-0">
          {confirmedCount}/{totalCount} confirmed
        </Badge>
      </div>

      <AddVendorBar onCreated={async v => {
        setVendors(prev => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)))
      }} />

      {error && <p className="text-xs text-destructive">{error}</p>}
      {advancing && <p className="text-xs text-muted-foreground">Advancing to Stage 9…</p>}

      {/* Line items */}
      <div className="space-y-2">
        {lines.map(line => (
          <LineRow
            key={line.id}
            line={line}
            vendors={vendors}
            canConfirm={canConfirm}
            currentUserId={ctx.currentUserId}
            onChange={async () => { await load(); await tryAutoAdvance() }}
            onError={msg => { setError(msg); setBusy(false) }}
            busy={busy}
            setBusy={setBusy}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Add Vendor inline form ─────────────────────────────────────────────────
function AddVendorBar({ onCreated }: { onCreated: (v: Vendor) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (!name.trim()) { setError('Vendor name required.'); return }
    setBusy(true)
    const { data, error: insErr } = await supabase
      .from('design_vendors')
      .insert({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
      })
      .select('id, name, phone, email')
      .single()
    setBusy(false)
    if (insErr || !data) { setError(insErr?.message ?? 'Failed to add vendor.'); return }
    await onCreated(data as Vendor)
    setName(''); setPhone(''); setEmail('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        <Store className="h-3.5 w-3.5 mr-1" />
        Add vendor
      </Button>
    )
  }

  return (
    <div className="rounded-md border border-border bg-surface/40 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="v-name" className="text-xs">Name *</Label>
          <Input id="v-name" value={name} onChange={e => setName(e.target.value)} placeholder="Acme Plywood Co." />
        </div>
        <div className="space-y-1">
          <Label htmlFor="v-phone" className="text-xs">Phone</Label>
          <Input id="v-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 …" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="v-email" className="text-xs">Email</Label>
          <Input id="v-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="sales@acme.in" />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save vendor'}</Button>
        <Button size="sm" variant="secondary" onClick={() => { setOpen(false); setError(null) }}>Cancel</Button>
      </div>
    </div>
  )
}

// ─── Single line row ─────────────────────────────────────────────────────────
function LineRow({
  line, vendors, canConfirm, currentUserId, onChange, onError, busy, setBusy,
}: {
  line: LineItem
  vendors: Vendor[]
  canConfirm: boolean
  currentUserId: string
  onChange: () => Promise<void>
  onError: (msg: string) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [vendorId, setVendorId] = useState(line.vendor_id ?? '')
  const [notes, setNotes] = useState(line.vendor_notes ?? '')

  const confirmed = !!(line.vendor_id && line.vendor_confirmed_at)
  const currentVendor = vendors.find(v => v.id === line.vendor_id)

  async function confirm() {
    if (!vendorId) { onError('Pick a vendor before confirming.'); return }
    setBusy(true)
    const { error: upErr } = await supabase
      .from('design_boq_line_items')
      .update({
        vendor_id: vendorId,
        vendor_confirmed_at: new Date().toISOString(),
        vendor_confirmed_by: currentUserId,
        vendor_notes: notes.trim() || null,
      })
      .eq('id', line.id)
    setBusy(false)
    if (upErr) { onError(upErr.message); return }
    setEditing(false)
    await onChange()
  }

  async function unconfirm() {
    if (!confirm) return
    setBusy(true)
    const { error: upErr } = await supabase
      .from('design_boq_line_items')
      .update({
        vendor_confirmed_at: null,
        vendor_confirmed_by: null,
      })
      .eq('id', line.id)
    setBusy(false)
    if (upErr) { onError(upErr.message); return }
    await onChange()
  }

  return (
    <div className={
      'rounded-md border bg-background/30 p-3 transition-colors '
      + (confirmed ? 'border-success/30' : 'border-border')
    }>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-foreground font-medium">{line.item_name}</span>
            {line.material_spec && <span className="text-xs text-muted-foreground">· {line.material_spec}</span>}
            {confirmed && <Badge variant="success" className="text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />confirmed</Badge>}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {line.quantity != null && <span>{line.quantity} {line.unit ?? ''}</span>}
            {line.unit_price != null && <span>@ ₹{Number(line.unit_price).toLocaleString('en-IN')}</span>}
            {line.total_price != null && <span className="text-foreground-secondary">= ₹{Number(line.total_price).toLocaleString('en-IN')}</span>}
          </div>
          {confirmed && currentVendor && !editing && (
            <div className="mt-2 text-xs text-foreground-secondary flex items-center gap-2 flex-wrap">
              <span><span className="text-muted-foreground">Vendor: </span>{currentVendor.name}</span>
              {currentVendor.phone && (
                <a href={`tel:${currentVendor.phone}`} className="flex items-center gap-1 text-accent-400 hover:text-accent-300">
                  <Phone className="h-3 w-3" />{currentVendor.phone}
                </a>
              )}
              {currentVendor.email && (
                <a href={`mailto:${currentVendor.email}`} className="flex items-center gap-1 text-accent-400 hover:text-accent-300">
                  <Mail className="h-3 w-3" />{currentVendor.email}
                </a>
              )}
              <span className="text-muted-foreground">
                · {new Date(line.vendor_confirmed_at!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          )}
          {confirmed && line.vendor_notes && !editing && (
            <p className="mt-1 text-xs text-foreground-secondary italic">"{line.vendor_notes}"</p>
          )}
        </div>

        {canConfirm && !editing && (
          <div className="flex gap-1.5 flex-shrink-0">
            {confirmed ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => { setVendorId(line.vendor_id ?? ''); setNotes(line.vendor_notes ?? ''); setEditing(true) }}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={unconfirm} disabled={busy}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reopen
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => { setVendorId(line.vendor_id ?? ''); setNotes(line.vendor_notes ?? ''); setEditing(true) }}>
                Confirm rate
              </Button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Vendor *</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a vendor…" />
              </SelectTrigger>
              <SelectContent>
                {vendors.length === 0 && <SelectItem value="__none__" disabled>No vendors yet — add one above</SelectItem>}
                {vendors.map(v => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}{v.phone ? ` · ${v.phone}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes from the conversation (optional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Confirmed on call 12 May, agreed delivery by week 3, GST extra…"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={confirm} disabled={busy || !vendorId}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {busy ? 'Saving…' : 'Confirm'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
