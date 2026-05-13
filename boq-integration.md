# BOQ Automation — Design PMS Integration Spec
**Hagerstone Design PMS × n8n BOQ Generator**
*For execution in Claude Code using n8n MCP connector*

---

## 1. What This Builds

Adds an **AI BOQ Generator** panel inside Stage 3 (Initial Deliverables). When the designer uploads the 2D layout PDF, they can optionally trigger the AI to generate a draft BOQ. They review, download the Excel, edit if needed, then upload the final BOQ through the existing approval pipeline.

### Resulting Stage 3 workflow
```
Designer uploads Layout PDF
        ↓
"Generate BOQ from this layout" button appears
        ↓
Designer provides: total area (sqft) + project type + ceiling height
        ↓
n8n generates BOQ Excel (2–4 minutes)
        ↓
Designer downloads Excel, reviews, edits offline
        ↓
Designer uploads final BOQ (existing upload button — now labelled "Upload Final BOQ")
        ↓
Normal TH → Founder review pipeline continues (unchanged)
```

---

## 2. Architecture

```
PMS Stage 3 UI
    │
    │  POST {pdf_signed_url, project_id, total_area, project_type, ceiling_ht, user_id}
    ↓
n8n Webhook: /boq-generate-pms
    │
    ├─ HTTP: Download PDF from Supabase signed URL
    ├─ Code: Extract base64
    ├─ Code: Build Claude payload (proportional estimation prompt)
    ├─ HTTP: Claude Vision API
    ├─ Code: Parse + calculate all quantities (code node math, not Claude)
    ├─ Code: Apply Hagerstone rate card → full costed BOQ JSON
    ├─ HTTP: Railway Excel generator → .xlsx binary
    ├─ HTTP: Upload Excel to Supabase storage (design-deliverables bucket)
    └─ HTTP: Update design_boq_generation_jobs row → status='completed'

PMS Stage 3 UI (polls every 5 sec via useEffect)
    │
    └─ Shows "Download Generated BOQ" when status='completed'
```

**What Claude Code builds (n8n MCP):** The entire n8n workflow.
**What you build manually:** Supabase migration + Stage 3 React UI changes + Rate card values.

---

## 3. Manual Steps — Do These First

### 3.1 Supabase Migration (run in Supabase SQL editor)

```sql
-- Table to track BOQ generation jobs
create table design_boq_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references design_projects(id) on delete cascade not null,
  created_by uuid references auth.users(id) not null,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  input_pdf_path text,           -- storage path of the layout PDF
  total_area_sqft numeric,       -- provided by designer
  project_type text,             -- office | gym | hospitality | retail | residential | other
  ceiling_height_ft numeric default 9,
  notes text,
  output_excel_path text,        -- storage path of generated .xlsx (set on completion)
  output_excel_signed_url text,  -- temporary 1-hr signed URL (set on completion)
  extracted_spaces jsonb,        -- Claude's raw space extraction (for debugging)
  boq_summary jsonb,             -- totals per category
  error_message text,
  created_at timestamptz default now(),
  processing_started_at timestamptz,
  completed_at timestamptz
);

-- Index for PMS polling queries
create index on design_boq_generation_jobs(project_id, status);
create index on design_boq_generation_jobs(created_by);

-- RLS
alter table design_boq_generation_jobs enable row level security;

-- Project members can read jobs for their projects
create policy "members read"
  on design_boq_generation_jobs for select
  using (
    project_id in (
      select project_id from design_project_members
      where user_id = auth.uid()
    )
  );

-- Designers/TH/Founder can insert jobs
create policy "members insert"
  on design_boq_generation_jobs for insert
  with check (
    project_id in (
      select project_id from design_project_members
      where user_id = auth.uid()
    )
    and created_by = auth.uid()
  );

-- Only service role can update (n8n uses service role key to write back status)
-- The update policy below allows any member to update for simplicity;
-- if you want service-role-only, remove this and rely on n8n's service key bypassing RLS.
create policy "members update own"
  on design_boq_generation_jobs for update
  using (created_by = auth.uid() or
    project_id in (
      select project_id from design_project_members
      where user_id = auth.uid()
        and role in ('team_head','founder')
    )
  );
```

### 3.2 Stage 3 UI Changes — `Stage3InitialDeliverables.tsx`

Add the following **after the Layout upload panel and before the BOQ upload panel**. The AI generation is triggered once a Layout file has been uploaded.

```typescript
// ─── NEW: AI BOQ Generator panel ────────────────────────────────────────────
// Add this state at the top of the component:
const [boqGenJob, setBoqGenJob] = useState<BoqGenJob | null>(null);
const [boqGenForm, setBoqGenForm] = useState({
  total_area_sqft: '',
  project_type: 'office',
  ceiling_height_ft: '9',
  notes: '',
});
const [boqGenLoading, setBoqGenLoading] = useState(false);

// Types to add (or in a types file):
interface BoqGenJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  output_excel_signed_url?: string;
  boq_summary?: Record<string, number>;
  error_message?: string;
  created_at: string;
}

// Poll for latest job status (add inside useEffect watching project id)
useEffect(() => {
  if (!ctx.project.id) return;
  const fetchJob = async () => {
    const { data } = await supabase
      .from('design_boq_generation_jobs')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (data) setBoqGenJob(data);
  };
  fetchJob();
  // Poll every 5 seconds while a job is processing
  const interval = setInterval(() => {
    if (boqGenJob?.status === 'pending' || boqGenJob?.status === 'processing') {
      fetchJob();
    }
  }, 5000);
  return () => clearInterval(interval);
}, [ctx.project.id, boqGenJob?.status]);

// Generate handler
const handleGenerateBOQ = async () => {
  if (!boqGenForm.total_area_sqft) {
    alert('Please enter the total floor area first.');
    return;
  }
  // Find the uploaded layout file path
  const layoutDeliverable = deliverables.find(d => d.kind === 'layout' && d.is_active);
  if (!layoutDeliverable) {
    alert('Please upload the Layout PDF first before generating BOQ.');
    return;
  }
  setBoqGenLoading(true);
  try {
    // Get a signed URL for the layout PDF (5 minutes)
    const { data: signedUrlData, error: signedErr } = await supabase.storage
      .from('design-deliverables')
      .createSignedUrl(layoutDeliverable.file_path, 300);
    if (signedErr || !signedUrlData?.signedUrl) throw signedErr;

    // Insert job record first
    const { data: job, error: jobErr } = await supabase
      .from('design_boq_generation_jobs')
      .insert({
        project_id: ctx.project.id,
        created_by: ctx.currentUser.id,
        status: 'pending',
        input_pdf_path: layoutDeliverable.file_path,
        total_area_sqft: parseFloat(boqGenForm.total_area_sqft),
        project_type: boqGenForm.project_type,
        ceiling_height_ft: parseFloat(boqGenForm.ceiling_height_ft),
        notes: boqGenForm.notes,
      })
      .select()
      .single();
    if (jobErr) throw jobErr;
    setBoqGenJob(job);

    // Call n8n webhook
    const n8nUrl = import.meta.env.VITE_N8N_BOQ_WEBHOOK_URL;
    await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.id,
        project_id: ctx.project.id,
        pdf_signed_url: signedUrlData.signedUrl,
        total_area_sqft: parseFloat(boqGenForm.total_area_sqft),
        project_type: boqGenForm.project_type,
        ceiling_height_ft: parseFloat(boqGenForm.ceiling_height_ft),
        notes: boqGenForm.notes,
        project_name: ctx.project.name,
      }),
    });
  } catch (err) {
    console.error(err);
    alert('Failed to start BOQ generation. Please try again.');
  } finally {
    setBoqGenLoading(false);
  }
};
```

**JSX to add (inside the render, after Layout panel):**
```tsx
{/* AI BOQ Generator Panel */}
<div className="border rounded-lg p-4 space-y-4 bg-blue-50">
  <h3 className="font-medium text-blue-900">AI BOQ Generator</h3>
  <p className="text-sm text-blue-700">
    Upload the layout PDF first, then generate a draft BOQ automatically.
    You can download, edit, and re-upload the final version below.
  </p>

  {/* Input form */}
  <div className="grid grid-cols-2 gap-3">
    <div>
      <label className="text-xs font-medium text-gray-600">Total floor area (sqft) *</label>
      <input
        type="number"
        placeholder="e.g. 2765"
        value={boqGenForm.total_area_sqft}
        onChange={e => setBoqGenForm(f => ({ ...f, total_area_sqft: e.target.value }))}
        className="w-full mt-1 border rounded px-3 py-1.5 text-sm"
      />
    </div>
    <div>
      <label className="text-xs font-medium text-gray-600">Project type</label>
      <select
        value={boqGenForm.project_type}
        onChange={e => setBoqGenForm(f => ({ ...f, project_type: e.target.value }))}
        className="w-full mt-1 border rounded px-3 py-1.5 text-sm"
      >
        <option value="office">Office fit-out</option>
        <option value="gym">Gym / sports facility</option>
        <option value="hospitality">Restaurant / cafe / hospitality</option>
        <option value="retail">Retail / showroom</option>
        <option value="residential">Residential</option>
        <option value="clubhouse">Club house / society facility</option>
        <option value="other">Other</option>
      </select>
    </div>
    <div>
      <label className="text-xs font-medium text-gray-600">Ceiling height (ft)</label>
      <input
        type="number"
        value={boqGenForm.ceiling_height_ft}
        onChange={e => setBoqGenForm(f => ({ ...f, ceiling_height_ft: e.target.value }))}
        className="w-full mt-1 border rounded px-3 py-1.5 text-sm"
      />
    </div>
    <div>
      <label className="text-xs font-medium text-gray-600">Notes (optional)</label>
      <input
        type="text"
        placeholder="Special requirements, materials..."
        value={boqGenForm.notes}
        onChange={e => setBoqGenForm(f => ({ ...f, notes: e.target.value }))}
        className="w-full mt-1 border rounded px-3 py-1.5 text-sm"
      />
    </div>
  </div>

  {/* Generate button */}
  {(!boqGenJob || boqGenJob.status === 'failed') && (
    <button
      onClick={handleGenerateBOQ}
      disabled={boqGenLoading}
      className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
    >
      {boqGenLoading ? 'Starting...' : 'Generate BOQ from Layout'}
    </button>
  )}

  {/* Status display */}
  {boqGenJob?.status === 'pending' && (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <span className="animate-spin">⏳</span> Queued — generation starting...
    </div>
  )}
  {boqGenJob?.status === 'processing' && (
    <div className="flex items-center gap-2 text-sm text-blue-600">
      <span className="animate-spin">⚙️</span> Analysing layout... (2–4 minutes)
    </div>
  )}
  {boqGenJob?.status === 'completed' && boqGenJob.output_excel_signed_url && (
    <div className="space-y-2">
      <div className="text-sm text-green-700 font-medium">✅ BOQ generated successfully</div>
      <a
        href={boqGenJob.output_excel_signed_url}
        download
        className="inline-block bg-green-600 text-white px-4 py-2 rounded text-sm font-medium"
      >
        Download Generated BOQ (.xlsx)
      </a>
      <p className="text-xs text-gray-500">
        Review and edit the Excel. Then upload your final version as the BOQ below.
      </p>
      <button
        onClick={() => setBoqGenJob(null)}
        className="text-xs text-blue-600 underline"
      >
        Generate again with different inputs
      </button>
    </div>
  )}
  {boqGenJob?.status === 'failed' && (
    <div className="text-sm text-red-600">
      Generation failed: {boqGenJob.error_message || 'Unknown error'}. Try again.
    </div>
  )}
</div>

{/* EXISTING BOQ upload panel — just rename the label */}
{/* Change the heading from "BOQ" to "Final BOQ (upload after reviewing AI draft or your own)" */}
```

### 3.3 Environment Variable to Add to PMS `.env`

```bash
# n8n webhook URL for BOQ generation (get this after creating the n8n workflow)
VITE_N8N_BOQ_WEBHOOK_URL=https://primary-production-72e3f.up.railway.app/webhook/boq-generate-pms
```

### 3.4 Rate Card JSON — QS Team to Validate

Save this as `src/lib/boqRateCard.ts` OR embed directly in the n8n Code node. **Rates in ₹ per sqft unless otherwise noted.**

> ⚠️ QS team must validate every rate. These are extracted from Hagerstone's historical BOQs — update before going live.

```typescript
// These are from real Hagerstone BOQs. Validate with QS team before use.
export const HAGERSTONE_RATES = {
  // ── Civil works (per sqft of floor area) ──────────────────────────────────
  civil: {
    floor_dismantling:    { rate: 60.50,  unit: 'sqft', desc: 'Floor dismantling and disposal' },
    pcc_work:             { rate: 93.50,  unit: 'sqft', desc: '75mm PCC M-10 grade with wire mesh' },
    waterproofing:        { rate: 110.00, unit: 'sqft', desc: 'Dr. Fixit waterproofing (wet areas only)' },
    rough_plaster:        { rate: 55.00,  unit: 'sqft', desc: 'Rough plaster on walls (wet areas)' },
    pop_punning:          { rate: 42.00,  unit: 'sqft', desc: 'POP punning on walls' },
    deck_slab:            { rate: 715.00, unit: 'sqft', desc: 'RCC deck slab 100mm (terrace)' },
  },
  // ── Flooring (per sqft) ────────────────────────────────────────────────────
  flooring: {
    rubber_gym:           { rate: 715.00, unit: 'sqft', desc: 'Heavy-duty rubber gym tiles 10mm, Eco-Trax or equivalent' },
    lvt:                  { rate: 495.00, unit: 'sqft', desc: 'Luxury vinyl tile (LVT), 2mm, Armstrong or equivalent' },
    wooden_flooring:      { rate: 660.00, unit: 'sqft', desc: 'Pre-finished wooden flooring 12mm, AC4 grade' },
    marble:               { rate: 495.00, unit: 'sqft', desc: 'Italian marble 18mm, P3 finish' },
    vitrified_800:        { rate: 198.00, unit: 'sqft', desc: 'Vitrified tiles 800×800mm, RAK or equivalent, P3 finish' },
    antiskid_vitrified:   { rate: 130.00, unit: 'sqft', desc: 'Anti-skid vitrified tiles 600×600mm (toilets/terrace)' },
    kota_stone:           { rate: 99.00,  unit: 'sqft', desc: 'Kota stone 20mm (utility/service areas)' },
  },
  // ── Ceiling (per sqft) ─────────────────────────────────────────────────────
  ceiling: {
    gypsum_plain:         { rate: 215.00, unit: 'sqft', desc: 'Gypsum false ceiling 12.5mm, Saint-Gobain, single layer' },
    gypsum_with_coves:    { rate: 259.00, unit: 'sqft', desc: 'Gypsum false ceiling with cove profile' },
    wpc_fluted:           { rate: 440.00, unit: 'sqft', desc: 'WPC / laminated fluted ceiling panels' },
    metal_grid:           { rate: 195.00, unit: 'sqft', desc: 'Metal grid ceiling 600×600mm tiles (toilets/service)' },
    metal_false_ceiling:  { rate: 418.00, unit: 'sqft', desc: 'Metal false ceiling (terraces, outdoor areas)' },
    ceiling_paint_aep:    { rate: 44.00,  unit: 'sqft', desc: 'Asian Paints Tractor Emulsion AEP on ceiling' },
  },
  // ── Wall finishes (per sqft of wall area) ─────────────────────────────────
  wall: {
    aep_paint:            { rate: 44.00,  unit: 'sqft', desc: 'Asian Paints Tractor Emulsion AEP 2 coats' },
    premium_emulsion:     { rate: 66.00,  unit: 'sqft', desc: 'Asian Paints Royale Matt 2 coats' },
    wallpaper:            { rate: 220.00, unit: 'sqft', desc: 'Wallpaper supply & installation (feature wall)' },
    fluted_panel_wpc:     { rate: 352.00, unit: 'sqft', desc: 'WPC fluted wall panel, 9mm, with back frame' },
    mirror_cladding:      { rate: 550.00, unit: 'sqft', desc: 'Mirror cladding 6mm toughened (gym/dance walls)' },
    acoustic_panel:       { rate: 418.00, unit: 'sqft', desc: 'Acoustic foam/fabric panel (studios/conference)' },
    tile_dado:            { rate: 220.00, unit: 'sqft', desc: 'Ceramic tile dado up to 7ft height (wet areas)' },
    exterior_paint:       { rate: 60.50,  unit: 'sqft', desc: 'Apex exterior emulsion (terrace boundary walls)' },
  },
  // ── Skirting (per RFT) ─────────────────────────────────────────────────────
  skirting: {
    aluminium_50mm:       { rate: 175.00, unit: 'rft',  desc: 'Aluminium skirting 50mm with SS screws' },
    tile_skirting:        { rate: 99.00,  unit: 'rft',  desc: 'Tile skirting to match floor' },
  },
  // ── Doors (per unit) ───────────────────────────────────────────────────────
  doors: {
    flush_900_2100:       { rate: 28000,  unit: 'nos',  desc: 'Flush door 900×2100mm, 35mm thick, laminate finish' },
    flush_800_2100:       { rate: 25000,  unit: 'nos',  desc: 'Flush door 800×2100mm, 35mm thick, laminate finish' },
    glass_door_frameless: { rate: 45000,  unit: 'nos',  desc: 'Frameless glass door 900×2100mm, 12mm toughened' },
    toilet_door:          { rate: 18000,  unit: 'nos',  desc: 'Toilet door 750×2100mm, WPC frame + laminate shutt.' },
  },
  // ── MEP (per sqft of floor area) ──────────────────────────────────────────
  mep: {
    electrical:           { rate: 350.00, unit: 'sqft', desc: 'Electrical wiring, DB, switches, light points, power points' },
    hvac_vrv:             { rate: 550.00, unit: 'sqft', desc: 'HVAC — VRV/VRF system, ductwork, grilles' },
    lv_firefighting:      { rate: 180.00, unit: 'sqft', desc: 'LV cabling, fire detection, sprinklers, hose reels' },
    pa_system:            { rate: 90.00,  unit: 'sqft', desc: 'PA/background music system, speakers' },
    plumbing_basic:       { rate: 165.00, unit: 'sqft', desc: 'Plumbing — inlet/outlet, fixtures (wet areas only)' },
  },
};

// ── Space-type templates ─────────────────────────────────────────────────────
// Maps space type → which line items to include.
// Each entry: [category, item_key, qty_basis, multiplier]
// qty_basis: 'floor' = area sqft, 'wall' = wall sqft, 'perimeter' = perimeter rft, 'nos' = count
// multiplier: fraction of area the item covers (1.0 = full area, 0.3 = feature wall only, etc.)

export const BOQ_TEMPLATES: Record<string, Array<[string, string, string, number]>> = {
  gym: [
    ['civil',    'floor_dismantling',   'floor',   1.0],
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'rubber_gym',          'floor',   0.75], // 75% rubber, 25% other
    ['flooring', 'lvt',                 'floor',   0.25],
    ['ceiling',  'wpc_fluted',          'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'aep_paint',           'wall',    0.50],
    ['wall',     'mirror_cladding',     'wall',    0.35],
    ['wall',     'acoustic_panel',      'wall',    0.15],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'hvac_vrv',            'floor',   1.0],
    ['mep',      'lv_firefighting',     'floor',   1.0],
    ['mep',      'pa_system',           'floor',   1.0],
  ],
  yoga: [
    ['civil',    'floor_dismantling',   'floor',   1.0],
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'lvt',                 'floor',   1.0],
    ['ceiling',  'gypsum_plain',        'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'aep_paint',           'wall',    0.60],
    ['wall',     'mirror_cladding',     'wall',    0.30],
    ['wall',     'acoustic_panel',      'wall',    0.10],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'hvac_vrv',            'floor',   1.0],
    ['mep',      'pa_system',           'floor',   1.0],
  ],
  zumba: [
    ['civil',    'floor_dismantling',   'floor',   1.0],
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'wooden_flooring',     'floor',   1.0],
    ['ceiling',  'gypsum_with_coves',   'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'mirror_cladding',     'wall',    0.60],
    ['wall',     'acoustic_panel',      'wall',    0.25],
    ['wall',     'aep_paint',           'wall',    0.15],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'hvac_vrv',            'floor',   1.0],
    ['mep',      'pa_system',           'floor',   1.0],
    ['mep',      'lv_firefighting',     'floor',   1.0],
  ],
  office: [
    ['civil',    'pcc_work',            'floor',   1.0],
    ['civil',    'pop_punning',         'wall',    1.0],
    ['flooring', 'vitrified_800',       'floor',   1.0],
    ['ceiling',  'gypsum_plain',        'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'aep_paint',           'wall',    0.70],
    ['wall',     'wallpaper',           'wall',    0.30],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['doors',    'flush_900_2100',      'nos',     1.0],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'hvac_vrv',            'floor',   1.0],
  ],
  cabin: [
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'wooden_flooring',     'floor',   0.60],
    ['flooring', 'marble',              'floor',   0.40],
    ['ceiling',  'gypsum_with_coves',   'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'premium_emulsion',    'wall',    0.60],
    ['wall',     'fluted_panel_wpc',    'wall',    0.25],
    ['wall',     'wallpaper',           'wall',    0.15],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['doors',    'flush_900_2100',      'nos',     1.0],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'hvac_vrv',            'floor',   1.0],
  ],
  conference: [
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'vitrified_800',       'floor',   1.0],
    ['ceiling',  'gypsum_with_coves',   'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'acoustic_panel',      'wall',    0.40],
    ['wall',     'fluted_panel_wpc',    'wall',    0.30],
    ['wall',     'aep_paint',           'wall',    0.30],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['doors',    'flush_900_2100',      'nos',     1.0],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'hvac_vrv',            'floor',   1.0],
    ['mep',      'lv_firefighting',     'floor',   1.0],
    ['mep',      'pa_system',           'floor',   1.0],
  ],
  toilet: [
    ['civil',    'waterproofing',       'floor',   1.0],
    ['civil',    'rough_plaster',       'wall',    1.0],
    ['flooring', 'antiskid_vitrified',  'floor',   1.0],
    ['ceiling',  'metal_grid',          'floor',   1.0],
    ['wall',     'tile_dado',           'wall',    1.0],
    ['skirting', 'tile_skirting',       'perimeter', 1.0],
    ['doors',    'toilet_door',         'nos',     1.0],
    ['mep',      'plumbing_basic',      'floor',   1.0],
    ['mep',      'electrical',          'floor',   1.0],
  ],
  reception: [
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'marble',              'floor',   1.0],
    ['ceiling',  'gypsum_with_coves',   'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'fluted_panel_wpc',    'wall',    0.50],
    ['wall',     'premium_emulsion',    'wall',    0.50],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'hvac_vrv',            'floor',   1.0],
  ],
  banquet: [
    ['civil',    'floor_dismantling',   'floor',   1.0],
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'vitrified_800',       'floor',   1.0],
    ['ceiling',  'gypsum_with_coves',   'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'fluted_panel_wpc',    'wall',    0.40],
    ['wall',     'acoustic_panel',      'wall',    0.30],
    ['wall',     'aep_paint',           'wall',    0.30],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'hvac_vrv',            'floor',   1.0],
    ['mep',      'lv_firefighting',     'floor',   1.0],
    ['mep',      'pa_system',           'floor',   1.0],
  ],
  terrace: [
    ['civil',    'deck_slab',           'floor',   1.0],
    ['civil',    'waterproofing',       'floor',   1.0],
    ['flooring', 'antiskid_vitrified',  'floor',   1.0],
    ['ceiling',  'metal_false_ceiling', 'floor',   0.40], // only covered area
    ['wall',     'exterior_paint',      'wall',    1.0],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'lv_firefighting',     'floor',   1.0],
  ],
  pantry: [
    ['civil',    'waterproofing',       'floor',   1.0],
    ['flooring', 'antiskid_vitrified',  'floor',   1.0],
    ['ceiling',  'metal_grid',          'floor',   1.0],
    ['wall',     'tile_dado',           'wall',    1.0],
    ['mep',      'electrical',          'floor',   1.0],
    ['mep',      'plumbing_basic',      'floor',   1.0],
  ],
  corridor: [
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'vitrified_800',       'floor',   1.0],
    ['ceiling',  'gypsum_plain',        'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'aep_paint',           'wall',    1.0],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['mep',      'electrical',          'floor',   1.0],
  ],
  storage: [
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'kota_stone',          'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'aep_paint',           'wall',    1.0],
    ['mep',      'electrical',          'floor',   1.0],
  ],
  other: [
    ['civil',    'pcc_work',            'floor',   1.0],
    ['flooring', 'vitrified_800',       'floor',   1.0],
    ['ceiling',  'gypsum_plain',        'floor',   1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',   1.0],
    ['wall',     'aep_paint',           'wall',    1.0],
    ['mep',      'electrical',          'floor',   1.0],
  ],
};
```

---

## 4. n8n Workflow — Build via Claude Code

Open Claude Code (with n8n MCP connected). Use these exact prompts in sequence.

### Step 1 — Get SDK reference
Ask Claude Code:
> "Use n8n:get_sdk_reference to understand how to build an n8n workflow with webhook trigger, HTTP request nodes, and code nodes. Then use n8n:search_nodes to find the correct node type names for: webhook, HTTP request, code, and respond to webhook."

### Step 2 — Create the main workflow
Ask Claude Code:

> "Create a new n8n workflow called 'BOQ Generator — PMS Integrated' using n8n:create_workflow_from_code. It must have exactly these 10 nodes in sequence:
>
> **Node 1 — Webhook trigger**
> - Path: `boq-generate-pms`
> - Method: POST
> - Response mode: respond immediately with 200 (not responseNode — we respond async via Supabase)
> - Accepts binary data: false
>
> **Node 2 — Code: Update job status to processing**
> ```javascript
> const body = $input.first().json;
> // Store inputs for downstream nodes
> return [{
>   json: {
>     job_id: body.job_id,
>     project_id: body.project_id,
>     pdf_signed_url: body.pdf_signed_url,
>     total_area_sqft: parseFloat(body.total_area_sqft) || 0,
>     project_type: body.project_type || 'other',
>     ceiling_height_ft: parseFloat(body.ceiling_height_ft) || 9,
>     notes: body.notes || '',
>     project_name: body.project_name || 'Project',
>   }
> }];
> ```
>
> **Node 3 — HTTP Request: Update Supabase job to 'processing'**
> - Method: PATCH
> - URL: `https://orhbzvoqtingmqjbjzqw.supabase.co/rest/v1/design_boq_generation_jobs?id=eq.={{ $json.job_id }}`
> - Headers:
>   - `apikey`: `{{ $env.SUPABASE_SERVICE_KEY }}`
>   - `Authorization`: `Bearer {{ $env.SUPABASE_SERVICE_KEY }}`
>   - `Content-Type`: `application/json`
>   - `Prefer`: `return=minimal`
> - Body (JSON): `{ "status": "processing", "processing_started_at": "{{ new Date().toISOString() }}" }`
>
> **Node 4 — HTTP Request: Download PDF from signed URL**
> - Method: GET
> - URL: `={{ $('Code: Prepare Inputs').first().json.pdf_signed_url }}`
> - Response format: file (binary)
>
> **Node 5 — Code: Extract PDF base64**
> ```javascript
> const item = $input.first();
> const binary = item.binary;
> if (!binary || Object.keys(binary).length === 0) {
>   throw new Error('No PDF binary data received');
> }
> const key = Object.keys(binary)[0];
> const file = binary[key];
> const buffer = await $helpers.getBinaryDataBuffer(item, key);
> const base64PDF = buffer.toString('base64');
> if (!base64PDF || base64PDF.length < 500) {
>   throw new Error('PDF too short: ' + base64PDF.length);
> }
> const inputs = $('Code: Prepare Inputs').first().json;
> return [{
>   json: {
>     ...inputs,
>     base64PDF,
>   }
> }];
> ```
>
> **Node 6 — Code: Build Claude payload**
> (Insert the full code from Section 4.1 below)
>
> **Node 7 — HTTP Request: Claude Vision API**
> - Method: POST
> - URL: `https://api.anthropic.com/v1/messages`
> - Authentication: Header Auth credential named 'Anthropic API Key' (x-api-key header)
> - Additional headers: `anthropic-version: 2023-06-01`, `anthropic-beta: pdfs-2024-09-25`, `content-type: application/json`
> - Body: raw JSON `={{ JSON.stringify($json.payload) }}`
> - Timeout: 120000
>
> **Node 8 — Code: Parse + Calculate + Apply Rate Card**
> (Insert the full code from Section 4.2 below)
>
> **Node 9 — HTTP Request: Generate Excel**
> - Method: POST
> - URL: `https://hagerstone-boq-excel-production.up.railway.app/generate-boq-full`
> - Body: JSON with field `boqPayload` = `={{ $json.boqPayload }}`
> - Response format: file (binary)
>
> **Node 10 — Code: Upload Excel to Supabase + update job**
> (Insert the full code from Section 4.3 below)
>
> Connect all nodes in sequence 1→2→3→4→5→6→7→8→9→10.
> Add error handling: any node failure should PATCH the Supabase job to status='failed' with the error message."

---

### 4.1 Node 6 — Build Claude Payload (paste this code)

```javascript
const data = $input.first().json;
const { base64PDF, total_area_sqft, project_type, ceiling_height_ft, notes, project_name } = data;

const PROMPT = `You are a professional Quantity Surveyor for an interior design firm. Analyse this 2D floor plan PDF.

PROJECT CONTEXT:
- Project name: ${project_name}
- Total floor area (from project brief): ${total_area_sqft} sqft
- Project type: ${project_type}
- Standard ceiling height: ${ceiling_height_ft} feet
${notes ? '- Special notes: ' + notes : ''}

YOUR TASK:
1. Identify every distinct space/zone visible on this floor plan
2. For each space: read annotated boundary dimensions if clearly visible
3. If no clear boundary dimensions exist for a space, estimate what PERCENTAGE of the total floor area it occupies based on its visual size relative to the full floor

DIMENSION RULES:
- All annotated dimensions are in MILLIMETERS
- Only use dimensions ACTUALLY WRITTEN on the drawing for boundary walls — not furniture or equipment dims
- If you see cumulative dims along one wall (e.g. 490+1600+1115), add them for total wall length
- If a space has no annotated dims, estimate its area_pct (0–100, all spaces must sum to ~100)

SPACE TYPES to identify: gym, yoga, zumba, office, cabin, conference, toilet, pantry, reception, corridor, staircase, storage, banquet, terrace, lobby, medical, server_room, activity_area, other

RETURN ONLY raw valid JSON, no markdown, no preamble:
{
  "project_info": {
    "total_spaces": 0,
    "drawing_notes": "",
    "ceiling_height_ft": ${ceiling_height_ft},
    "processing_notes": ""
  },
  "spaces": [
    {
      "id": 1,
      "name": "Space Name (as on drawing)",
      "type": "gym",
      "dimensions_mm": {
        "length": 13480,
        "width": 14380,
        "raw_text": "13480 x 14380",
        "shape": "rectangular",
        "source": "annotated"
      },
      "area_pct": null,
      "confidence": "high",
      "notes": ""
    }
  ]
}

RULES:
- If dims are annotated: set length/width, set source="annotated", set area_pct=null
- If no dims: set length=null, width=null, set source="estimated", set area_pct to visual estimate (e.g. 25 for a room that looks like 1/4 of the floor)
- All area_pct values across all spaces (estimated ones) should sum to approximately 100
- Never hallucinate dimensions. Never guess a specific mm number — use area_pct instead.
- confidence: high=annotated dims | medium=inferred dims | low=estimated pct only`;

const payload = {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  messages: [{
    role: 'user',
    content: [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64PDF }
      },
      { type: 'text', text: PROMPT }
    ]
  }]
};

return [{ json: { payload, ...data } }];
```

---

### 4.2 Node 8 — Parse + Calculate + Apply Rate Card (paste this code)

```javascript
// ── 1. Parse Claude response ────────────────────────────────────────────────
const item = $input.first();
const inputs = item.json;

const response = inputs; // Claude API response is the json of this node
// Note: the HTTP Request node for Claude returns the API response as json
// The actual Claude response is in the content array

const claudeResponse = item.json;
const content = claudeResponse.content;
if (!content || !content[0]?.text) throw new Error('No Claude response');

let rawText = content[0].text.trim()
  .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
const jsonStart = rawText.indexOf('{');
const jsonEnd = rawText.lastIndexOf('}');
if (jsonStart === -1) throw new Error('No JSON in Claude response: ' + rawText.substring(0,200));

let extracted;
try {
  extracted = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
} catch(e) {
  throw new Error('JSON parse failed: ' + e.message);
}

// ── 2. Get inputs (from node 5 via $('Code: Build Claude Payload')) ─────────
const buildNode = $('Code: Build Claude Payload').first().json;
const total_area_sqft = parseFloat(buildNode.total_area_sqft) || 0;
const project_type = buildNode.project_type || 'other';
const ceiling_height_ft = parseFloat(buildNode.ceiling_height_ft) || 9;
const project_name = buildNode.project_name || 'Project';
const job_id = buildNode.job_id;
const project_id = buildNode.project_id;

const MM_PER_FOOT = 304.8;

// ── 3. Calculate area for each space ────────────────────────────────────────
const spaces = (extracted.spaces || []).map(s => {
  const dims = s.dimensions_mm || {};
  let area_sqft = null;
  let area_sqm = null;
  let perimeter_rft = null;
  let wall_area_sqft = null;
  let area_source = 'none';

  if (dims.length && dims.width && dims.source === 'annotated') {
    // Exact calculation from annotated dimensions
    area_sqft = Math.round((dims.length/MM_PER_FOOT) * (dims.width/MM_PER_FOOT) * 100) / 100;
    area_sqm  = Math.round((dims.length/1000) * (dims.width/1000) * 100) / 100;
    perimeter_rft = Math.round(2 * ((dims.length + dims.width) / MM_PER_FOOT) * 100) / 100;
    wall_area_sqft = Math.round(perimeter_rft * ceiling_height_ft * 100) / 100;
    area_source = 'annotated_dims';
  } else if (s.area_pct && total_area_sqft > 0) {
    // Proportional estimation
    area_sqft = Math.round(total_area_sqft * (s.area_pct / 100) * 100) / 100;
    area_sqm  = Math.round(area_sqft * 0.0929 * 100) / 100;
    // Estimate perimeter assuming roughly square room
    const side_ft = Math.sqrt(area_sqft);
    perimeter_rft = Math.round(4 * side_ft * 100) / 100;
    wall_area_sqft = Math.round(perimeter_rft * ceiling_height_ft * 100) / 100;
    area_source = 'estimated_pct';
  }

  return { ...s, quantities: { area_sqft, area_sqm, perimeter_rft, wall_area_sqft, ceiling_height_ft }, area_source };
});

// ── 4. Apply Hagerstone rate card ────────────────────────────────────────────
const RATES = {
  civil: {
    floor_dismantling:    { rate: 60.50,  unit: 'sqft', desc: 'Floor dismantling & disposal' },
    pcc_work:             { rate: 93.50,  unit: 'sqft', desc: '75mm PCC M-10 grade with wire mesh' },
    waterproofing:        { rate: 110.00, unit: 'sqft', desc: "Dr. Fixit waterproofing (wet areas)" },
    rough_plaster:        { rate: 55.00,  unit: 'sqft', desc: 'Rough plaster on walls (wet areas)' },
    pop_punning:          { rate: 42.00,  unit: 'sqft', desc: 'POP punning on walls' },
    deck_slab:            { rate: 715.00, unit: 'sqft', desc: 'RCC deck slab 100mm (terrace)' },
  },
  flooring: {
    rubber_gym:           { rate: 715.00, unit: 'sqft', desc: 'Heavy-duty rubber gym tiles 10mm' },
    lvt:                  { rate: 495.00, unit: 'sqft', desc: 'LVT 2mm, Armstrong or equivalent' },
    wooden_flooring:      { rate: 660.00, unit: 'sqft', desc: 'Pre-finished wooden flooring 12mm' },
    marble:               { rate: 495.00, unit: 'sqft', desc: 'Italian marble 18mm, P3 finish' },
    vitrified_800:        { rate: 198.00, unit: 'sqft', desc: 'Vitrified tiles 800x800mm, P3' },
    antiskid_vitrified:   { rate: 130.00, unit: 'sqft', desc: 'Anti-skid vitrified tiles 600x600mm' },
    kota_stone:           { rate: 99.00,  unit: 'sqft', desc: 'Kota stone 20mm' },
  },
  ceiling: {
    gypsum_plain:         { rate: 215.00, unit: 'sqft', desc: 'Gypsum false ceiling 12.5mm' },
    gypsum_with_coves:    { rate: 259.00, unit: 'sqft', desc: 'Gypsum false ceiling with cove' },
    wpc_fluted:           { rate: 440.00, unit: 'sqft', desc: 'WPC fluted ceiling panels' },
    metal_grid:           { rate: 195.00, unit: 'sqft', desc: 'Metal grid ceiling 600x600mm tiles' },
    metal_false_ceiling:  { rate: 418.00, unit: 'sqft', desc: 'Metal false ceiling (outdoor)' },
    ceiling_paint_aep:    { rate: 44.00,  unit: 'sqft', desc: 'AEP on ceiling' },
  },
  wall: {
    aep_paint:            { rate: 44.00,  unit: 'sqft', desc: 'Asian Paints AEP 2 coats' },
    premium_emulsion:     { rate: 66.00,  unit: 'sqft', desc: 'Asian Paints Royale Matt 2 coats' },
    wallpaper:            { rate: 220.00, unit: 'sqft', desc: 'Wallpaper (feature wall)' },
    fluted_panel_wpc:     { rate: 352.00, unit: 'sqft', desc: 'WPC fluted wall panel 9mm' },
    mirror_cladding:      { rate: 550.00, unit: 'sqft', desc: 'Mirror cladding 6mm toughened' },
    acoustic_panel:       { rate: 418.00, unit: 'sqft', desc: 'Acoustic foam/fabric panel' },
    tile_dado:            { rate: 220.00, unit: 'sqft', desc: 'Ceramic tile dado upto 7ft' },
    exterior_paint:       { rate: 60.50,  unit: 'sqft', desc: 'Apex exterior emulsion' },
  },
  skirting: {
    aluminium_50mm:       { rate: 175.00, unit: 'rft',  desc: 'Aluminium skirting 50mm' },
    tile_skirting:        { rate: 99.00,  unit: 'rft',  desc: 'Tile skirting to match floor' },
  },
  doors: {
    flush_900_2100:       { rate: 28000,  unit: 'nos',  desc: 'Flush door 900x2100mm, laminate' },
    flush_800_2100:       { rate: 25000,  unit: 'nos',  desc: 'Flush door 800x2100mm, laminate' },
    toilet_door:          { rate: 18000,  unit: 'nos',  desc: 'Toilet door 750x2100mm WPC' },
  },
  mep: {
    electrical:           { rate: 350.00, unit: 'sqft', desc: 'Electrical: wiring, DB, switches, points' },
    hvac_vrv:             { rate: 550.00, unit: 'sqft', desc: 'HVAC VRV/VRF system' },
    lv_firefighting:      { rate: 180.00, unit: 'sqft', desc: 'LV cabling, fire detection, sprinklers' },
    pa_system:            { rate: 90.00,  unit: 'sqft', desc: 'PA/background music system' },
    plumbing_basic:       { rate: 165.00, unit: 'sqft', desc: 'Plumbing inlet/outlet (wet areas)' },
  },
};

const TEMPLATES = {
  gym:        [['civil','floor_dismantling','floor',1],['civil','pcc_work','floor',1],['flooring','rubber_gym','floor',0.75],['flooring','lvt','floor',0.25],['ceiling','wpc_fluted','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','aep_paint','wall',0.5],['wall','mirror_cladding','wall',0.35],['wall','acoustic_panel','wall',0.15],['skirting','aluminium_50mm','perimeter',1],['mep','electrical','floor',1],['mep','hvac_vrv','floor',1],['mep','lv_firefighting','floor',1],['mep','pa_system','floor',1]],
  yoga:       [['civil','floor_dismantling','floor',1],['civil','pcc_work','floor',1],['flooring','lvt','floor',1],['ceiling','gypsum_plain','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','aep_paint','wall',0.6],['wall','mirror_cladding','wall',0.3],['wall','acoustic_panel','wall',0.1],['mep','electrical','floor',1],['mep','hvac_vrv','floor',1],['mep','pa_system','floor',1]],
  zumba:      [['civil','floor_dismantling','floor',1],['civil','pcc_work','floor',1],['flooring','wooden_flooring','floor',1],['ceiling','gypsum_with_coves','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','mirror_cladding','wall',0.6],['wall','acoustic_panel','wall',0.25],['wall','aep_paint','wall',0.15],['mep','electrical','floor',1],['mep','hvac_vrv','floor',1],['mep','pa_system','floor',1],['mep','lv_firefighting','floor',1]],
  office:     [['civil','pcc_work','floor',1],['flooring','vitrified_800','floor',1],['ceiling','gypsum_plain','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','aep_paint','wall',0.7],['wall','wallpaper','wall',0.3],['skirting','aluminium_50mm','perimeter',1],['doors','flush_900_2100','nos',1],['mep','electrical','floor',1],['mep','hvac_vrv','floor',1]],
  cabin:      [['civil','pcc_work','floor',1],['flooring','wooden_flooring','floor',1],['ceiling','gypsum_with_coves','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','premium_emulsion','wall',0.6],['wall','fluted_panel_wpc','wall',0.25],['wall','wallpaper','wall',0.15],['skirting','aluminium_50mm','perimeter',1],['doors','flush_900_2100','nos',1],['mep','electrical','floor',1],['mep','hvac_vrv','floor',1]],
  conference: [['civil','pcc_work','floor',1],['flooring','vitrified_800','floor',1],['ceiling','gypsum_with_coves','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','acoustic_panel','wall',0.4],['wall','fluted_panel_wpc','wall',0.3],['wall','aep_paint','wall',0.3],['skirting','aluminium_50mm','perimeter',1],['doors','flush_900_2100','nos',1],['mep','electrical','floor',1],['mep','hvac_vrv','floor',1],['mep','lv_firefighting','floor',1],['mep','pa_system','floor',1]],
  toilet:     [['civil','waterproofing','floor',1],['civil','rough_plaster','wall',1],['flooring','antiskid_vitrified','floor',1],['ceiling','metal_grid','floor',1],['wall','tile_dado','wall',1],['skirting','tile_skirting','perimeter',1],['doors','toilet_door','nos',1],['mep','plumbing_basic','floor',1],['mep','electrical','floor',1]],
  reception:  [['civil','pcc_work','floor',1],['flooring','marble','floor',1],['ceiling','gypsum_with_coves','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','fluted_panel_wpc','wall',0.5],['wall','premium_emulsion','wall',0.5],['skirting','aluminium_50mm','perimeter',1],['mep','electrical','floor',1],['mep','hvac_vrv','floor',1]],
  banquet:    [['civil','floor_dismantling','floor',1],['civil','pcc_work','floor',1],['flooring','vitrified_800','floor',1],['ceiling','gypsum_with_coves','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','fluted_panel_wpc','wall',0.4],['wall','acoustic_panel','wall',0.3],['wall','aep_paint','wall',0.3],['skirting','aluminium_50mm','perimeter',1],['mep','electrical','floor',1],['mep','hvac_vrv','floor',1],['mep','lv_firefighting','floor',1],['mep','pa_system','floor',1]],
  terrace:    [['civil','deck_slab','floor',1],['civil','waterproofing','floor',1],['flooring','antiskid_vitrified','floor',1],['ceiling','metal_false_ceiling','floor',0.4],['wall','exterior_paint','wall',1],['mep','electrical','floor',1],['mep','lv_firefighting','floor',1]],
  pantry:     [['civil','waterproofing','floor',1],['flooring','antiskid_vitrified','floor',1],['ceiling','metal_grid','floor',1],['wall','tile_dado','wall',1],['mep','electrical','floor',1],['mep','plumbing_basic','floor',1]],
  corridor:   [['civil','pcc_work','floor',1],['flooring','vitrified_800','floor',1],['ceiling','gypsum_plain','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','aep_paint','wall',1],['skirting','aluminium_50mm','perimeter',1],['mep','electrical','floor',1]],
  storage:    [['civil','pcc_work','floor',1],['flooring','kota_stone','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','aep_paint','wall',1],['mep','electrical','floor',1]],
  other:      [['civil','pcc_work','floor',1],['flooring','vitrified_800','floor',1],['ceiling','gypsum_plain','floor',1],['ceiling','ceiling_paint_aep','floor',1],['wall','aep_paint','wall',1],['mep','electrical','floor',1]],
};

function getTemplate(type) {
  const t = type?.toLowerCase();
  return TEMPLATES[t] || TEMPLATES.other;
}

// Build line items for each space
let lineItemId = 1;
const spacesWithItems = spaces.filter(s => s.quantities.area_sqft).map(s => {
  const qty = s.quantities;
  const tmpl = getTemplate(s.type);
  const lineItems = tmpl.map(([cat, item, basis, mult]) => {
    const rateObj = RATES[cat]?.[item];
    if (!rateObj) return null;
    let quantity = 0;
    if (basis === 'floor')     quantity = Math.round(qty.area_sqft * mult * 100) / 100;
    if (basis === 'wall')      quantity = Math.round((qty.wall_area_sqft || 0) * mult * 100) / 100;
    if (basis === 'perimeter') quantity = Math.round((qty.perimeter_rft || 0) * mult * 100) / 100;
    if (basis === 'nos')       quantity = 1;
    const amount = Math.round(quantity * rateObj.rate * 100) / 100;
    return {
      id: lineItemId++,
      category: cat,
      item_key: item,
      description: rateObj.desc,
      unit: rateObj.unit,
      quantity,
      rate: rateObj.rate,
      amount,
    };
  }).filter(Boolean);

  const spaceTotal = lineItems.reduce((s, i) => s + i.amount, 0);
  return { ...s, line_items: lineItems, space_total: Math.round(spaceTotal) };
});

// Grand totals
const grandTotal = spacesWithItems.reduce((s, sp) => s + sp.space_total, 0);
const gst = Math.round(grandTotal * 0.18);
const totalWithGst = grandTotal + gst;

// Category totals
const catTotals = {};
spacesWithItems.forEach(sp => {
  sp.line_items.forEach(li => {
    catTotals[li.category] = (catTotals[li.category] || 0) + li.amount;
  });
});

const boqPayload = {
  projectName: project_name,
  projectType: project_type,
  totalAreaSqft: total_area_sqft,
  generatedAt: new Date().toISOString(),
  processedBy: 'Hagerstone AI BOQ Generator',
  spaces: spacesWithItems,
  summary: {
    grandTotal: Math.round(grandTotal),
    gst18Pct: gst,
    totalWithGst,
    categoryTotals: catTotals,
    totalSpaces: spacesWithItems.length,
    spacesFromAnnotatedDims: spacesWithItems.filter(s => s.area_source === 'annotated_dims').length,
    spacesFromEstimatedPct: spacesWithItems.filter(s => s.area_source === 'estimated_pct').length,
  }
};

return [{
  json: {
    boqPayload,
    job_id,
    project_id,
    extractedSpaces: extracted,
    summary: boqPayload.summary,
  }
}];
```

---

### 4.3 Node 10 — Upload Excel + Update Job (paste this code)

```javascript
const item = $input.first();
const prevData = $('Code: Parse + Rate Card').first().json;
const { job_id, project_id, summary } = prevData;

const binary = item.binary;
if (!binary) throw new Error('No Excel binary from generator');
const key = Object.keys(binary)[0];
const buffer = await $helpers.getBinaryDataBuffer(item, key);
const base64Excel = buffer.toString('base64');

const SUPABASE_URL = 'https://orhbzvoqtingmqjbjzqw.supabase.co';
const SERVICE_KEY = $env.SUPABASE_SERVICE_KEY;
const timestamp = new Date().toISOString().replace(/[:.]/g,'-').substring(0,19);
const filePath = `${project_id}/boq_generated/${timestamp}_BOQ_AI_Draft.xlsx`;

// Upload to Supabase storage
const uploadResp = await fetch(
  `${SUPABASE_URL}/storage/v1/object/design-deliverables/${filePath}`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'x-upsert': 'true',
    },
    body: buffer,
  }
);
if (!uploadResp.ok) {
  const errText = await uploadResp.text();
  throw new Error('Supabase upload failed: ' + errText);
}

// Create signed URL (1 hour)
const signedResp = await fetch(
  `${SUPABASE_URL}/storage/v1/object/sign/design-deliverables/${filePath}`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 3600 }),
  }
);
const signedData = await signedResp.json();
const signedUrl = signedData.signedURL
  ? `${SUPABASE_URL}/storage/v1${signedData.signedURL}`
  : null;

// Update job to completed
await fetch(
  `${SUPABASE_URL}/rest/v1/design_boq_generation_jobs?id=eq.${job_id}`,
  {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      status: 'completed',
      output_excel_path: filePath,
      output_excel_signed_url: signedUrl,
      boq_summary: summary,
      extracted_spaces: prevData.extractedSpaces,
      completed_at: new Date().toISOString(),
    }),
  }
);

// Create alert for the project team
await fetch(
  `${SUPABASE_URL}/rest/v1/design_alerts`,
  {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      project_id,
      type: 'boq_generated',
      message: `AI BOQ generated for ${prevData.boqPayload?.projectName || 'project'}. ${summary?.totalSpaces || 0} spaces, total ₹${(summary?.grandTotal || 0).toLocaleString('en-IN')} (excl. GST). Download and review.`,
    }),
  }
);

return [{ json: { success: true, job_id, file_path: filePath, signed_url: signedUrl } }];
```

---

### Step 3 — Add error handler to n8n workflow
Ask Claude Code:
> "Add an error handler to the 'BOQ Generator — PMS Integrated' workflow. If any node fails, the workflow should execute a final PATCH to the Supabase `design_boq_generation_jobs` table setting status='failed' and error_message to the error text. Use the n8n Error Trigger node connected to an HTTP Request PATCH node."

### Step 4 — Add environment variables in n8n
In Railway → n8n service → Variables, add:
```
SUPABASE_SERVICE_KEY = [your-supabase-service-role-key]
```
(Get from Supabase → Settings → API → service_role key)

---

## 5. Railway Excel Generator — Update for Full BOQ Format

The existing `excel_generator.py` generates 3 simple sheets. Replace the `generate_boq_excel` function with a full Hagerstone-format generator. The new endpoint is `/generate-boq-full`.

Update on Railway by pushing to the GitHub repo. Add this new route to `excel_generator.py`:

```python
@app.route("/generate-boq-full", methods=["POST"])
def generate_full_excel():
    """Generates full costed BOQ in Hagerstone format — multiple sections per space."""
    try:
        data = request.get_json(force=True)
        payload = data.get("boqPayload", data)
        wb = create_full_hagerstone_boq(payload)
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        proj = payload.get("projectName", "Project") or "Project"
        safe = "".join(c if c.isalnum() or c in " _-" else "_" for c in proj)
        ts = datetime.now().strftime("%Y%m%d_%H%M")
        return send_file(
            output,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=f"BOQ_{safe}_{ts}.xlsx"
        )
    except Exception as e:
        import traceback; print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500
```

> The full `create_full_hagerstone_boq()` function is a larger build item — it should produce:
> - Sheet 1: Summary (project info, category totals, GST, grand total)
> - Sheets 2–N: One sheet per space, with all line items (S.No, Description, Unit, Qty, Rate, Amount)
> - Sheet N+1: MEP Summary across all spaces
> - Final sheet: Terms & Exclusions
>
> This mirrors the structure of the real `BOQ_-_CORONA_OPTUS_CLUB_HOUSE.xlsx`. Build this separately by asking Claude Code: *"Build the `create_full_hagerstone_boq` Python function for the Railway Flask service, matching the format of the real Hagerstone BOQ Excel files."* Share the Corona Optus real BOQ file with Claude Code for reference.

---

## 6. Testing Sequence

Run end-to-end after all above is complete:

1. **Supabase:** Run the migration SQL. Confirm `design_boq_generation_jobs` table appears.
2. **PMS:** Add `VITE_N8N_BOQ_WEBHOOK_URL` to `.env`. Rebuild frontend.
3. **n8n:** Activate the new workflow. Confirm webhook path is `/boq-generate-pms`.
4. **Railway:** Push updated `excel_generator.py` with `/generate-boq-full` endpoint. Verify `/health` returns OK.
5. **Test run:**
   - Open a Stage 3 project as a designer
   - Upload a Layout PDF
   - Enter total area (e.g. 2765 sqft), type = clubhouse, ceiling = 9ft
   - Click "Generate BOQ from Layout"
   - Check `design_boq_generation_jobs` row appears with `status='processing'`
   - Wait 2–4 minutes
   - Row should update to `status='completed'` with `output_excel_signed_url` set
   - UI should show "Download Generated BOQ" button
   - Download Excel, verify it has correct structure
   - Click "Upload Final BOQ", upload the (optionally edited) Excel
   - BOQ enters normal TH → Founder review pipeline

---

## 7. What n8n MCP Cannot Do — Manual Only

These cannot be done via n8n MCP and must be done manually:

| Task | Tool |
|---|---|
| Run Supabase SQL migration | Supabase dashboard → SQL editor |
| Edit `Stage3InitialDeliverables.tsx` | Cursor / VS Code in PMS repo |
| Add `VITE_N8N_BOQ_WEBHOOK_URL` to PMS | Edit `.env` file + Vercel/host env |
| Validate rate card with QS team | Shared Google Sheet or meeting |
| Push Excel generator updates to Railway | GitHub push → Railway auto-deploys |
| Add `SUPABASE_SERVICE_KEY` to Railway | Railway dashboard → Variables |
| Add `Anthropic API Key` credential in n8n | n8n UI → Settings → Credentials |

---

## 8. After This Is Working — What to Improve Next

1. **Rate card in Supabase** (not hardcoded in n8n): Create a `design_rate_card` table so TH/QS can update rates without touching n8n code.
2. **Multi-floor PDFs**: Loop Claude Vision per page, aggregate spaces across floors.
3. **BOQ diff view**: When designer uploads final BOQ, show diff against AI draft.
4. **Signed URL refresh**: Output signed URL expires in 1 hour. Add a re-sign endpoint or store path and generate fresh URL on demand.
5. **Stage 5 pre-fill**: When designer opens Stage 5 (Structured BOQ Entry), pre-fill line items from the approved AI-generated BOQ draft — saves 80% of data entry.

---

*Last updated: May 2026 | Hagerstone Design PMS v2*