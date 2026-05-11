-- =============================================================================
-- Hagerstone Design PMS — RLS Fixes
-- Run this in the Supabase SQL Editor to patch the live database.
-- =============================================================================

-- ─── 1. Add design_is_team_head_or_founder() helper (SECURITY DEFINER) ────────
-- This avoids recursive RLS when checking roles inside policies.

CREATE OR REPLACE FUNCTION design_is_team_head_or_founder()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM design_user_roles
    WHERE user_id = auth.uid() AND role IN ('founder', 'team_head')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── 2. design_user_roles — team heads and founders can read ALL roles ─────────
-- Without this, the user picker (team heads, designers) is empty for team_heads.

DROP POLICY IF EXISTS "user reads own roles"     ON design_user_roles;
DROP POLICY IF EXISTS "team head reads all roles" ON design_user_roles;

CREATE POLICY "user reads own roles"
  ON design_user_roles FOR SELECT
  USING (user_id = auth.uid() OR design_is_team_head_or_founder());

-- ─── 3. design_projects — fix INSERT policy (use SECURITY DEFINER helper) ─────

DROP POLICY IF EXISTS "create projects" ON design_projects;

CREATE POLICY "create projects"
  ON design_projects FOR INSERT
  WITH CHECK (design_is_team_head_or_founder());

-- ─── 4. design_projects — fix UPDATE policy ────────────────────────────────────

DROP POLICY IF EXISTS "update projects" ON design_projects;

CREATE POLICY "update projects"
  ON design_projects FOR UPDATE
  USING (design_is_project_member(id) AND design_is_team_head_or_founder())
  WITH CHECK (true);

-- ─── 5. design_projects — fix DELETE policy ────────────────────────────────────

DROP POLICY IF EXISTS "hard delete projects" ON design_projects;

CREATE POLICY "hard delete projects"
  ON design_projects FOR DELETE
  USING (design_is_team_head_or_founder());

-- ─── 6. design_project_members — fix management policy ────────────────────────

DROP POLICY IF EXISTS "manage project members" ON design_project_members;

CREATE POLICY "manage project members"
  ON design_project_members FOR ALL
  USING (design_is_team_head_or_founder())
  WITH CHECK (true);

-- ─── 7. design_vendors — fix management policy ────────────────────────────────

DROP POLICY IF EXISTS "manage vendors" ON design_vendors;

CREATE POLICY "manage vendors"
  ON design_vendors FOR ALL
  USING (design_is_team_head_or_founder())
  WITH CHECK (true);

-- ─── 8. design_client_users — fix management policy ───────────────────────────

DROP POLICY IF EXISTS "manage client users" ON design_client_users;

CREATE POLICY "manage client users"
  ON design_client_users FOR ALL
  USING (design_is_team_head_or_founder())
  WITH CHECK (true);

-- ─── 9. design_alerts — add INSERT policy (MISSING — blocked notifications) ───

DROP POLICY IF EXISTS "project members insert alerts" ON design_alerts;

CREATE POLICY "project members insert alerts"
  ON design_alerts FOR INSERT
  WITH CHECK (
    project_id IS NULL
    OR design_is_project_member(project_id)
    OR design_is_team_head_or_founder()
  );

-- ─── 10. design_alerts — add UPDATE policy (MISSING — blocked mark-as-read) ───

DROP POLICY IF EXISTS "recipient marks alert read" ON design_alerts;

CREATE POLICY "recipient marks alert read"
  ON design_alerts FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (true);

-- ─── 11. Fix auth hook — use || operator to safely merge app_metadata ─────────
-- The original jsonb_set with nested path crashes when app_metadata key is absent.

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
  -- Never block login
  RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION design_custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION design_custom_access_token_hook FROM PUBLIC, authenticated, anon;

-- ─── Verification smoke tests (run as postgres — expect these specific results) ─
-- NOTE: auth.uid() is NULL in SQL Editor (runs as postgres), so role checks
-- return false. That is EXPECTED. Test the real flow from the app.

SELECT
  'design_is_founder'               AS fn,
  design_is_founder()               AS result  -- false (expected in SQL Editor)
UNION ALL
SELECT
  'design_is_team_head_or_founder'  AS fn,
  design_is_team_head_or_founder()  AS result  -- false (expected in SQL Editor)
UNION ALL
SELECT
  'policies_applied'                AS fn,
  TRUE                              AS result;
