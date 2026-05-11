-- =============================================================================
-- Hagerstone Design PMS — Row Level Security Policies
-- (Canonical version — see 0005_rls_fixes.sql for the incremental patches)
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE design_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_stage_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_meetings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_vendors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_boqs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_boq_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_boq_margins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_vendor_chats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_founder_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_cash_ledger     ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_alerts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_alert_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_user_roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_client_users    ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Helper functions (SECURITY DEFINER so they bypass RLS on inner table reads)
-- All functions execute as the function owner (superuser context), not the caller.
-- =============================================================================

CREATE OR REPLACE FUNCTION design_current_role()
RETURNS text AS $$
  SELECT role FROM design_user_roles WHERE user_id = auth.uid() LIMIT 1
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION design_is_founder()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM design_user_roles
    WHERE user_id = auth.uid() AND role = 'founder'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION design_is_team_head_or_founder()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM design_user_roles
    WHERE user_id = auth.uid() AND role IN ('founder', 'team_head')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION design_is_project_member(pid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM design_project_members
    WHERE project_id = pid AND user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM design_projects
    WHERE id = pid AND team_head_id = auth.uid()
  )
  OR design_is_founder()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION design_is_client_for_project(pid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM design_client_users
    WHERE project_id = pid AND auth_user_id = auth.uid() AND archived_at IS NULL
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =============================================================================
-- design_user_roles
-- =============================================================================

-- Each user can always read their own role(s).
-- Team heads and founders can read ALL roles (needed for user pickers).
CREATE POLICY "user reads own roles"
  ON design_user_roles FOR SELECT
  USING (user_id = auth.uid() OR design_is_team_head_or_founder());

-- Founder can manage all roles
CREATE POLICY "founder manages roles"
  ON design_user_roles FOR ALL
  USING (design_is_founder())
  WITH CHECK (design_is_founder());

-- =============================================================================
-- design_projects
-- =============================================================================

-- Founders and team heads can create projects (SECURITY DEFINER avoids recursive RLS)
CREATE POLICY "create projects"
  ON design_projects FOR INSERT
  WITH CHECK (design_is_team_head_or_founder());

-- Project members, team head, and founder can read active projects
CREATE POLICY "read projects"
  ON design_projects FOR SELECT
  USING (
    archived_at IS NULL
    AND design_is_project_member(id)
  );

-- Archived projects visible to founder only
CREATE POLICY "founder reads archived projects"
  ON design_projects FOR SELECT
  USING (archived_at IS NOT NULL AND design_is_founder());

-- Team head and founder can update
CREATE POLICY "update projects"
  ON design_projects FOR UPDATE
  USING (design_is_project_member(id) AND design_is_team_head_or_founder())
  WITH CHECK (true);

-- Hard delete: founder or team_head only (Q7)
CREATE POLICY "hard delete projects"
  ON design_projects FOR DELETE
  USING (design_is_team_head_or_founder());

-- =============================================================================
-- design_project_members
-- =============================================================================

CREATE POLICY "read project members"
  ON design_project_members FOR SELECT
  USING (design_is_project_member(project_id));

CREATE POLICY "manage project members"
  ON design_project_members FOR ALL
  USING (design_is_team_head_or_founder())
  WITH CHECK (true);

-- =============================================================================
-- design_stage_log — immutable audit (insert only for members, no delete)
-- =============================================================================

CREATE POLICY "read stage log"
  ON design_stage_log FOR SELECT
  USING (design_is_project_member(project_id));

CREATE POLICY "insert stage log"
  ON design_stage_log FOR INSERT
  WITH CHECK (design_is_project_member(project_id));

-- =============================================================================
-- design_meetings
-- =============================================================================

CREATE POLICY "read meetings"
  ON design_meetings FOR SELECT
  USING (design_is_project_member(project_id));

CREATE POLICY "manage meetings"
  ON design_meetings FOR ALL
  USING (design_is_project_member(project_id))
  WITH CHECK (design_is_project_member(project_id));

-- =============================================================================
-- design_vendors — all internal users can read; founder/team_head manage
-- =============================================================================

CREATE POLICY "internal read vendors"
  ON design_vendors FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM design_user_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "manage vendors"
  ON design_vendors FOR ALL
  USING (design_is_team_head_or_founder())
  WITH CHECK (true);

-- =============================================================================
-- design_boqs — internal users see both kinds; clients see external only
-- =============================================================================

CREATE POLICY "internal read boqs"
  ON design_boqs FOR SELECT
  USING (design_is_project_member(project_id));

-- Clients can only see active external BOQ
CREATE POLICY "client reads external boq"
  ON design_boqs FOR SELECT
  USING (
    kind = 'external'
    AND is_active = true
    AND design_is_client_for_project(project_id)
  );

-- Designers (assigned) can insert new BOQ versions
CREATE POLICY "designer inserts boq"
  ON design_boqs FOR INSERT
  WITH CHECK (design_is_project_member(project_id));

-- Founder can update any BOQ (in-place edit with versioning handled at app layer)
CREATE POLICY "founder updates boq"
  ON design_boqs FOR UPDATE
  USING (design_is_founder())
  WITH CHECK (true);

-- =============================================================================
-- design_boq_line_items — follows parent BOQ access
-- =============================================================================

CREATE POLICY "read boq line items"
  ON design_boq_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM design_boqs b
      WHERE b.id = boq_id
      AND (design_is_project_member(b.project_id)
           OR (b.kind = 'external' AND b.is_active AND design_is_client_for_project(b.project_id)))
    )
  );

CREATE POLICY "manage boq line items"
  ON design_boq_line_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM design_boqs b WHERE b.id = boq_id AND design_is_project_member(b.project_id)
    )
  )
  WITH CHECK (true);

-- =============================================================================
-- design_boq_margins
-- =============================================================================

CREATE POLICY "read boq margins"
  ON design_boq_margins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM design_boqs b WHERE b.id = boq_id AND design_is_project_member(b.project_id)
    )
  );

CREATE POLICY "founder manages margins"
  ON design_boq_margins FOR ALL
  USING (design_is_founder())
  WITH CHECK (true);

-- =============================================================================
-- design_vendor_chats
-- =============================================================================

CREATE POLICY "project members read chats"
  ON design_vendor_chats FOR SELECT
  USING (design_is_project_member(project_id));

CREATE POLICY "project members insert chats"
  ON design_vendor_chats FOR INSERT
  WITH CHECK (design_is_project_member(project_id));

-- =============================================================================
-- design_founder_reviews
-- =============================================================================

CREATE POLICY "read founder reviews"
  ON design_founder_reviews FOR SELECT
  USING (design_is_project_member(project_id));

CREATE POLICY "founder inserts reviews"
  ON design_founder_reviews FOR INSERT
  WITH CHECK (design_is_founder());

-- =============================================================================
-- design_tasks
-- =============================================================================

CREATE POLICY "read tasks"
  ON design_tasks FOR SELECT
  USING (design_is_project_member(project_id));

CREATE POLICY "manage tasks"
  ON design_tasks FOR ALL
  USING (design_is_project_member(project_id))
  WITH CHECK (design_is_project_member(project_id));

-- =============================================================================
-- design_cash_ledger — project members can read; inserts via service role only
-- =============================================================================

CREATE POLICY "read cash ledger"
  ON design_cash_ledger FOR SELECT
  USING (design_is_project_member(project_id));

-- Manual entries allowed for founder; n8n uses service role (bypasses RLS)
CREATE POLICY "founder manual cash entry"
  ON design_cash_ledger FOR INSERT
  WITH CHECK (design_is_founder());

-- =============================================================================
-- design_alerts
-- =============================================================================

-- Each recipient sees their own alerts; founder sees all
CREATE POLICY "read own alerts"
  ON design_alerts FOR SELECT
  USING (recipient_id = auth.uid() OR design_is_founder());

-- Project members (and team heads/founders) can insert alerts
CREATE POLICY "project members insert alerts"
  ON design_alerts FOR INSERT
  WITH CHECK (
    project_id IS NULL
    OR design_is_project_member(project_id)
    OR design_is_team_head_or_founder()
  );

-- Recipients can mark their own alerts as read (update sent_at)
CREATE POLICY "recipient marks alert read"
  ON design_alerts FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (true);

-- =============================================================================
-- design_alert_templates — read-only for all internal users
-- =============================================================================

CREATE POLICY "read alert templates"
  ON design_alert_templates FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM design_user_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "founder manages alert templates"
  ON design_alert_templates FOR ALL
  USING (design_is_founder())
  WITH CHECK (true);

-- =============================================================================
-- design_client_users
-- =============================================================================

-- Internal members of the project can read client info
CREATE POLICY "internal read client users"
  ON design_client_users FOR SELECT
  USING (design_is_project_member(project_id));

-- Client can read their own record
CREATE POLICY "client reads own record"
  ON design_client_users FOR SELECT
  USING (auth_user_id = auth.uid());

-- Team head and founder manage client users
CREATE POLICY "manage client users"
  ON design_client_users FOR ALL
  USING (design_is_team_head_or_founder())
  WITH CHECK (true);

-- =============================================================================
-- Auth hook: set app_metadata.role for client users on sign-in
-- (Supabase Dashboard → Auth → Hooks → Customize Access Token → JWT Claims)
-- =============================================================================

CREATE OR REPLACE FUNCTION design_custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  claims         jsonb;
  app_meta       jsonb;
  client_rec     RECORD;
  internal_rec   RECORD;
BEGIN
  claims   := event -> 'claims';
  app_meta := COALESCE(claims -> 'app_metadata', '{}'::jsonb);

  -- Check if this is a client user
  SELECT project_id INTO client_rec
  FROM design_client_users
  WHERE auth_user_id = (event ->> 'user_id')::uuid
    AND archived_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    app_meta := app_meta || jsonb_build_object(
      'role',       'client',
      'project_id', client_rec.project_id::text
    );
    claims := jsonb_set(claims, '{app_metadata}', app_meta);
    RETURN jsonb_set(event, '{claims}', claims);
  END IF;

  -- Otherwise set internal role
  SELECT role INTO internal_rec
  FROM design_user_roles
  WHERE user_id = (event ->> 'user_id')::uuid
  LIMIT 1;

  IF FOUND THEN
    app_meta := app_meta || jsonb_build_object('role', internal_rec.role);
    claims   := jsonb_set(claims, '{app_metadata}', app_meta);
    RETURN jsonb_set(event, '{claims}', claims);
  END IF;

  RETURN event;
EXCEPTION WHEN OTHERS THEN
  -- Never block login; return event unmodified
  RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION design_custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION design_custom_access_token_hook FROM PUBLIC, authenticated, anon;
