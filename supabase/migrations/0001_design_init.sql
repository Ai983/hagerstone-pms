-- =============================================================================
-- Hagerstone Design PMS — Initial Schema
-- Run: supabase db push (after setting SUPABASE_PROJECT_REF)
-- =============================================================================

-- ─── CORE ─────────────────────────────────────────────────────────────────────

CREATE TABLE design_projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name    text NOT NULL,
  client_name     text NOT NULL,
  client_contact  text,
  current_stage   smallint NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 11),
  budget_amount   numeric(14,2),
  margin_mode     text CHECK (margin_mode IN ('flat_pct','per_line_pct','per_line_abs')),
  cps_project_id  uuid,
  team_head_id    uuid NOT NULL REFERENCES auth.users(id),
  created_by      uuid NOT NULL REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

-- ─── PROJECT MEMBERS (multi-designer support) ─────────────────────────────────
-- Replaces single designer_id on projects. Lead designer = role='lead'.

CREATE TABLE design_project_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  role        text NOT NULL CHECK (role IN ('lead','support')),
  added_by    uuid NOT NULL REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- ─── STAGE AUDIT ──────────────────────────────────────────────────────────────

CREATE TABLE design_stage_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  from_stage  smallint CHECK (from_stage BETWEEN 1 AND 11),
  to_stage    smallint NOT NULL CHECK (to_stage BETWEEN 1 AND 11),
  actor_id    uuid REFERENCES auth.users(id),
  reason      text,   -- mandatory for backward moves
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── MEETINGS / MOM ───────────────────────────────────────────────────────────

CREATE TABLE design_meetings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  mode         text NOT NULL CHECK (mode IN ('online','offline')),
  meeting_at   timestamptz NOT NULL,
  attendees    text[],
  mom_notes    text,       -- required if mode='online' (enforced at app layer)
  mom_file_url text,
  created_by   uuid NOT NULL REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── VENDORS ──────────────────────────────────────────────────────────────────

CREATE TABLE design_vendors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  phone        text,
  email        text,
  portal_token text UNIQUE,   -- token-based access, no vendor login
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── BOQs ─────────────────────────────────────────────────────────────────────

CREATE TABLE design_boqs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('internal','external')),
  version      int NOT NULL,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  margin_mode  text CHECK (margin_mode IN ('flat_pct','per_line_pct','per_line_abs')),
  is_active    boolean NOT NULL DEFAULT false,
  created_by   uuid NOT NULL REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, version)
);

CREATE TABLE design_boq_line_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id        uuid NOT NULL REFERENCES design_boqs(id) ON DELETE CASCADE,
  item_name     text NOT NULL,
  material_spec text,
  unit          text,
  quantity      numeric(12,2),
  unit_price    numeric(12,2),
  total_price   numeric(14,2) GENERATED ALWAYS AS (
    COALESCE(quantity, 0) * COALESCE(unit_price, 0)
  ) STORED,
  vendor_id     uuid REFERENCES design_vendors(id),
  notes         text
);

CREATE TABLE design_boq_margins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id       uuid NOT NULL REFERENCES design_boqs(id) ON DELETE CASCADE,
  line_item_id uuid REFERENCES design_boq_line_items(id),
  mode         text NOT NULL CHECK (mode IN ('flat_pct','per_line_pct','per_line_abs')),
  value        numeric(14,2) NOT NULL
);

-- ─── VENDOR CHAT ──────────────────────────────────────────────────────────────

CREATE TABLE design_vendor_chats (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  vendor_id      uuid REFERENCES design_vendors(id),
  sender_type    text NOT NULL CHECK (sender_type IN ('designer','vendor')),
  sender_id      uuid,   -- auth.users.id if designer
  message        text NOT NULL,
  attachment_url text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── FOUNDER REVIEWS ──────────────────────────────────────────────────────────

CREATE TABLE design_founder_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  boq_id        uuid REFERENCES design_boqs(id),
  decision      text NOT NULL CHECK (decision IN ('approved','revise','rejected')),
  budget_amount numeric(14,2),
  comments      text,
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── TASKS ────────────────────────────────────────────────────────────────────

CREATE TABLE design_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  assigned_to uuid REFERENCES auth.users(id),
  due_at      timestamptz,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','blocked')),
  created_by  uuid NOT NULL REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── CASH FLOW ────────────────────────────────────────────────────────────────

CREATE TABLE design_cash_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  direction     text NOT NULL CHECK (direction IN ('in','out')),
  amount        numeric(14,2) NOT NULL,
  source_system text NOT NULL CHECK (source_system IN ('cps','finance','manual')),
  source_ref    text,
  description   text,
  occurred_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_ref)  -- idempotency for cross-system syncs
);

-- ─── ALERTS ───────────────────────────────────────────────────────────────────

CREATE TABLE design_alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid REFERENCES design_projects(id),
  alert_type     text NOT NULL,
  recipient_role text NOT NULL CHECK (recipient_role IN ('founder','team_head','designer')),
  recipient_id   uuid,
  payload        jsonb,
  sent_via       text,
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE design_alert_templates (
  key       text PRIMARY KEY,
  body      text NOT NULL,
  variables text[]   -- e.g. {project_name, budget, designer}
);

-- ─── ROLES ────────────────────────────────────────────────────────────────────

CREATE TABLE design_user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role    text NOT NULL CHECK (role IN ('founder','team_head','designer')),
  PRIMARY KEY (user_id, role)
);

-- ─── CLIENT USERS (Phase 1 — Q1 non-default) ──────────────────────────────────

CREATE TABLE design_client_users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  email        text NOT NULL,
  phone        text,
  auth_user_id uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  UNIQUE (project_id, email)
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_dp_team_head  ON design_projects(team_head_id);
CREATE INDEX idx_dp_stage      ON design_projects(current_stage);
CREATE INDEX idx_dp_active     ON design_projects(archived_at) WHERE archived_at IS NULL;

CREATE INDEX idx_dpm_project   ON design_project_members(project_id);
CREATE INDEX idx_dpm_user      ON design_project_members(user_id);

CREATE INDEX idx_dsl_project   ON design_stage_log(project_id, created_at DESC);

CREATE INDEX idx_dm_project    ON design_meetings(project_id);

CREATE INDEX idx_dboq_project  ON design_boqs(project_id, kind);
CREATE INDEX idx_dboq_active   ON design_boqs(project_id, kind) WHERE is_active = true;

CREATE INDEX idx_dvc_project   ON design_vendor_chats(project_id, created_at DESC);

CREATE INDEX idx_dcl_project   ON design_cash_ledger(project_id, occurred_at DESC);

CREATE INDEX idx_da_unsent     ON design_alerts(sent_at) WHERE sent_at IS NULL;

CREATE INDEX idx_dcu_project   ON design_client_users(project_id);
CREATE INDEX idx_dcu_auth_user ON design_client_users(auth_user_id) WHERE auth_user_id IS NOT NULL;
