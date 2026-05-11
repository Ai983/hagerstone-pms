-- =============================================================================
-- Hagerstone Design PMS — FDW: CPS Materials
-- ⚠  STUB — fill in CPS_HOST, CPS_USER, CPS_PASSWORD before running.
-- Get these from: Supabase Dashboard → hagerstone-cps → Settings → Database
-- =============================================================================
-- DO NOT run this migration until you have the CPS connection credentials.

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SERVER cps_server
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (
    host     '<CPS_HOST>',      -- e.g. db.orhbzvoqtingmqjbjzqw.supabase.co
    dbname   'postgres',
    port     '5432',
    sslmode  'require'
  );

-- Map the service role of THIS Supabase project to the CPS read-only user
CREATE USER MAPPING FOR authenticated
  SERVER cps_server
  OPTIONS (
    user     '<CPS_USER>',      -- service_role or a dedicated read-only role
    password '<CPS_PASSWORD>'
  );

-- Also map for service_role (used by Edge Functions)
CREATE USER MAPPING FOR service_role
  SERVER cps_server
  OPTIONS (
    user     '<CPS_USER>',
    password '<CPS_PASSWORD>'
  );

CREATE FOREIGN TABLE cps_materials_fdw (
  id          uuid,
  name        text,
  unit        text,
  description text,
  category    text,
  created_at  timestamptz
)
  SERVER cps_server
  OPTIONS (schema_name 'public', table_name 'cps_materials');

-- Grant authenticated users read access to the foreign table
GRANT SELECT ON cps_materials_fdw TO authenticated;
