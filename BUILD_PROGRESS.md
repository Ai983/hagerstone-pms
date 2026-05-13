# Hagerstone Design PMS — Build Progress

Snapshot of what's been built, the design decisions baked in, and what's still ahead. Read alongside the original brief.

---

## 0. Locked-in design decisions

These were confirmed before the workspace pattern was built and now govern every stage:

1. **Stage 3 deliverables**: BOQ + Layout + PPT, each independently revisable. Each artifact has its own version history and review state.
2. **Team Head approval before every Founder review**. Every designer submission (Stage 3 deliverables, Stage 5 structured BOQ) goes through TH first, then Founder where applicable.
3. **Auto-advance on approval**. No manual `→ Stage N` buttons anywhere. The gating action (final approval) triggers `advanceProject()`, which logs to `design_stage_log`, updates `design_projects.current_stage`, and inserts in-app alerts for every member.
4. **Revision cycles stay within the same stage**. A founder marking BOQ `founder_revise` keeps the project at Stage 4 — designer re-uploads, TH re-approves, founder reviews again. The project only moves when all three current artifacts reach the stage's exit status.
5. **`STAGE_OWNERS` is "who does the work", not "who can press the advance button"**. Team Head and Founder can also move stages forward (designer is the only one scoped to "own project only").

---

## 1. Stage-by-stage build state

| Stage | Title                            | Status    | Owner-side action                                         | Auto-advance trigger                                  |
|------:|----------------------------------|-----------|-----------------------------------------------------------|-------------------------------------------------------|
| 1     | Project Creation                 | ✅ done    | Team Head / Founder fills the create form                 | Auto-advances to 2 the moment the project is created  |
| 2     | Client Meeting                   | ✅ done    | Anyone on the project logs a meeting (date, mode, MOM)    | At least one meeting where online → has MOM           |
| 3     | Initial Deliverables             | ✅ done    | Designer uploads BOQ + Layout + PPT (each revisable)      | All 3 current rows in `design_deliverables` = `th_approved` |
| 4     | Founder Budget Review            | ✅ done    | Founder approves each artifact + sets budget on BOQ       | All 3 current rows = `founder_approved`               |
| 5     | Structured BOQ Entry             | ✅ done    | Designer creates internal `design_boqs` and adds line items | `design_boqs.status = 'th_approved'`                |
| 6     | Two-BOQ Split + Margin Mode      | ✅ done    | Founder picks margin mode + per-line values; system writes External BOQ | Save action creates external BOQ + advances        |
| 7     | Client Walkthrough (portal)      | ✅ done    | Designer shares the client portal link; client approves/comments via public token-based portal | Client posts an `approved` response on the External BOQ |
| 8     | Vendor Confirmation              | ✅ done    | Designer assigns a vendor + confirmation timestamp + notes per internal BOQ line (rate gathered via call/email or already known) | Every internal BOQ line has both `vendor_id` and `vendor_confirmed_at` set |
| 9     | Final BOQ Revision               | ⏳ next    | Designer marks client-confirmed (timestamp + note)        | Designer click                                        |
| 10    | Founder Final Approval           | ⏳ pending | Founder signs off (irreversible)                          | Founder click                                         |
| 11    | Handoff to CPS                   | ⏳ pending | n8n `WF-DESIGN-1` fires                                   | Stage transition itself triggers webhook              |

---

## 2. Data model added during this build

### `design_deliverables` (Stage 3 / 4)
File pipeline for BOQ, Layout, PPT. One row per (project, kind, version). Statuses:
`pending_th → th_revise → pending_th → th_approved → (Stage 4) → founder_revise → pending_th → … → founder_approved`.

Carries `file_path` (storage), `th_comment`, `founder_comment`, and `budget_amount` (only used on the BOQ row at founder approval, mirrored to `design_projects.budget_amount`).

### `design_boqs` extensions (Stage 5)
Added `status`, `submitted_at`, `th_reviewed_by`, `th_reviewed_at`, `th_comment`.
Status pipeline for the structured BOQ: `draft → pending_th → th_revise → th_approved`.

### Storage bucket `design-deliverables`
Private; path convention `{project_id}/{kind}/{version}-{timestamp}-{filename}`. Read/write gated by project membership; signed URLs (5 min) for downloads.

### RLS additions
- `design_deliverables`: read by project members, insert by assigned designer / TH / Founder, update by uploader or TH / Founder.
- `design_boqs`: designer can update their own BOQ; TH/Founder can update any BOQ on a project they belong to.
- Storage: project members read/insert; owner or TH/Founder update/delete.

### Stage 6 writes (no new schema)
External BOQ generation reuses existing tables:
- `design_boqs` — new row with `kind='external'`, `version=1`, `status='th_approved'`, `margin_mode` stamped.
- `design_boq_line_items` — one per internal line item, with computed `unit_price`.
- `design_boq_margins` — `flat_pct`: 1 row with `line_item_id=NULL`. `per_line_pct` / `per_line_abs`: 1 row per external line item.
- `design_projects.margin_mode` — stamped on save for downstream consumers (Stage 7 client view, CPS handoff).

### Vendor confirmation (Stage 8)
- `design_boq_line_items` gained `vendor_confirmed_at`, `vendor_confirmed_by`, `vendor_notes`. The pre-existing `vendor_id` FK is what links each line to `design_vendors`.
- Phase 1 simplification per design head: no vendor portal / in-portal chat. Designer calls or emails the vendor (or already knows the rate) and clicks **Confirm rate** on each line. Vendor master record + line confirmation is enough.
- New RLS: project members can insert vendors (was TH/Founder only). UPDATE / DELETE still gated to TH/Founder.
- Auto-advance to Stage 9 when every internal BOQ line has both `vendor_id` and `vendor_confirmed_at`. A confirmation header shows `n/total confirmed`.

### AI BOQ Generator (Stage 3 sub-feature)
- New table `design_boq_generation_jobs` tracks each generation request. Status pipeline: `pending → processing → completed | failed`. Stores input meta (area, type, ceiling, notes), the layout PDF path, the generated Excel path + signed URL, and the Claude space extraction in `extracted_spaces` for debugging.
- RLS: project members read + insert; uploader/TH/Founder update. n8n bypasses RLS via the service-role key.
- New module `src/lib/boqRateCard.ts` mirrors the rate card + per-space templates the n8n workflow uses. Keep both copies in sync until rates move into a `design_rate_card` table.
- New component `src/components/stages/BoqGeneratorPanel.tsx` renders inside Stage 3 above the three deliverable panels. Designer enters total area / type / ceiling / notes, panel POSTs to `VITE_N8N_BOQ_WEBHOOK_URL` with a 10-min signed URL for the current Layout PDF, then polls the jobs table every 5 sec for status updates. On completion, surfaces the download link + a summary row (spaces, ₹ total, GST). The generated Excel is meant to be reviewed/edited offline and re-uploaded through the normal BOQ panel.
- Hidden if `VITE_N8N_BOQ_WEBHOOK_URL` is unset (passive notice). Disabled until a Layout deliverable exists.
- **External work needed** (outside this codebase): build the n8n workflow per `boq-integration.md` §4 (webhook → Claude Vision → rate-card math → Railway Excel generator → Supabase write-back). The spec's Supabase URL is the CPS project — update to `https://juxsvpuplgiobghauhoj.supabase.co` for the design PMS. The spec's `design_alerts` write uses `type`/`message` columns; our schema uses `alert_type`/`payload` — adjust the n8n alert insert accordingly.

### Client portal (Stage 7)
- `design_projects.client_portal_token` — unguessable token generated on project creation. Internal team shares it out-of-band; client visits `/c/:token`.
- `design_client_responses` — every approve / reject / comment from the client lands here. Internal team reads via RLS; writes only happen via the edge function with the service-role key after validating the token.
- Edge function `client-view` — public (verify_jwt=false). Takes `?token=`, returns project header, team profiles, founder-approved Layout/PPT (with signed URLs), External BOQ + line items (only at Stage 7+), and the response history.
- Edge function `client-action` — public. Takes `{ token, target_type, target_id, decision, comment, client_name }`. Validates token, validates artifact belongs to the project, inserts a `design_client_responses` row, and fires alerts to the team head + all designers.
- Stage 7 workspace (internal) — copies the portal link, lists every client response, and auto-advances to Stage 8 the moment a client `approved` response on the current External BOQ is recorded.
- Project detail page header now exposes the portal link at every stage, so the team can share it from day 1 (client sees "work in progress" + team until artifacts get founder-approved).

---

## 3. File layout (added / changed)

```
src/
├── lib/
│   └── projectActions.ts          # advanceProject() — stage_log + project update + alerts
├── components/
│   └── stages/
│       ├── types.ts               # ProjectDetailContext shared with every stage
│       ├── StageWorkspace.tsx     # Per-stage component router (case 2..6 routed; rest → placeholder)
│       ├── StagePlaceholder.tsx   # Fallback for unbuilt stages
│       ├── Stage1ProjectCreation.tsx   # Create form (auto-advances to 2)
│       ├── Stage2ClientMeeting.tsx     # Meeting list + form, auto-advance on valid meeting
│       ├── Stage3InitialDeliverables.tsx  # BOQ/Layout/PPT panels, also serves Stage 4
│       ├── Stage5BOQEntry.tsx     # Structured line-item editor + TH review
│       └── Stage6TwoBOQSplit.tsx  # Margin mode picker + External BOQ generator
└── routes/projects/
    └── detail.tsx                 # Mounts <StageWorkspace ctx={...} />
```

---

## 4. Shared mechanics every stage component follows

- Receives `ctx: ProjectDetailContext` with the project, members, current user, role flags, `isAssignedMember`, and an async `refresh()`.
- Renders read-only when the viewer has no action for the current state; renders editor / review controls only when permitted.
- On the gating action, calls `advanceProject({...})`. Errors surface in component state, not in `alert()`.
- On approval / revision, inserts a `design_alerts` row for the impacted user(s). Alert types so far:
  - `member_added`, `member_removed`, `member_role_changed`
  - `stage_advanced`
  - `deliverable_uploaded`, `deliverable_th_approved`, `deliverable_th_revise`, `deliverable_founder_approved`, `deliverable_founder_revise`
  - `boq_submitted`, `boq_th_approved`, `boq_th_revise`

---

## 5. Test path through the system

The shortest end-to-end exercise on the existing **Test1** project (already reset to Stage 2):

1. **Stage 2 — designer1**: log an offline meeting. → auto-advance to Stage 3.
2. **Stage 3 — designer1**: upload three small files (any pdf/xlsx/pptx) as BOQ / Layout / PPT.
3. **Stage 3 — teamhead**: approve each of the three panels. → auto-advance to Stage 4.
4. **Stage 4 — founder**: set budget (e.g. `1500000`) on BOQ panel + approve, then approve Layout and PPT. → auto-advance to Stage 5.
5. **Stage 5 — designer1**: click *Start Internal BOQ v1*, add 2–3 line items, *Submit for TH review*.
6. **Stage 5 — teamhead**: approve. → auto-advance to Stage 6.
7. **Stage 6 — founder**: pick *flat %* mode, type `25`, hit *Save External BOQ*. → auto-advance to Stage 7 (placeholder).

---

## 6. Next build (Stage 7)

**Client Material + Budget Walkthrough**. Designer-led.

What needs to exist:
- A read-only client view of the External BOQ (`design_boqs` where `kind='external'` and `is_active`).
- A confirmation record — either client clicks "confirm" (Phase 2 with client login) or designer marks confirmed on the client's behalf (Phase 1 default per the brief).
- Probably a `design_client_confirmations` table or just a status flag on the external BOQ.

Open question to confirm before building: at Stage 7, should the client see prices line-by-line, or just the bottom-line total? Brief says "Client Material + Budget Walkthrough", suggesting per-line. Will check before coding.

---

## 7. Tracked tech debt / things to revisit

- **Stage 4 budget input** sits on the BOQ panel only. If founder wants to set budget without approving the BOQ specifically, there's no separate budget-only action. May want a dedicated budget-set step later.
- **`design_boq_margins` line_item_id mapping** at Stage 6 uses `item_name` to map internal → external line items. Works because external items are created in the same save call from the internal set, but is fragile if line items get edited later. A `source_line_item_id` column on `design_boq_line_items` would make this watertight.
- **No file size cap on the client**. Storage bucket caps at 100 MB; the upload form should validate before sending. Low priority.
- **Stage 5 has no "save all" shortcut** — each new draft row needs its own save click. Fine for a few lines, painful for 50+. Could batch.
- **Auto-advance retries**: if `advanceProject()` fails mid-flow (e.g. RLS edge case), the local UI shows an error but the user must trigger another action to retry. A small "retry advance" button would help.
- **RLS advisor warnings**: pre-existing `function_search_path_mutable` and `anon_security_definer_function_executable` lints on the helper functions. Low risk since the JWT enforces the user identity; can be cleaned up in a hardening pass.

