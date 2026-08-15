-- ============================================================================
-- FOR LOCAL / CI TEST DATABASES ONLY. Never run against real Supabase — a
-- real Supabase project already has all of this natively, and this script's
-- auth.uid()/auth.users are a deliberately minimal stand-in, not a full
-- reimplementation of Supabase Auth.
--
-- Stubs just enough of Supabase's auth layer for our RLS policies (written
-- against the real auth.uid()) to be tested against a plain Postgres
-- instance, without running the full Supabase stack (GoTrue, PostgREST) in
-- CI. Run this BEFORE the real migration.sql — the migration's FK to
-- auth.users and its RLS policies depend on what's created here.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email              TEXT,
    raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Real Supabase's own definition (auth.uid() reads the JWT "sub" claim from
-- a Postgres session-local GUC that PostgREST sets per-request; we set the
-- same GUC by hand in tests). Kept identical on purpose so policies written
-- against the real thing behave the same way here.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

-- The Postgres roles Supabase's stack normally provisions. authenticated is
-- what a logged-in request runs as; service_role bypasses RLS entirely
-- (BYPASSRLS), matching Supabase's real service_role role exactly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- Real Supabase projects preconfigure this so every new table automatically
-- grants these roles table-level access, leaving RLS policies to do the
-- actual row filtering. Applies to tables created after this statement by
-- the same role (i.e. migration.sql, run right after this file).
--
-- anon is included deliberately, matching Supabase's real default: without
-- a table grant, an anonymous request fails with "permission denied" before
-- RLS even gets evaluated — an error, not the required zero rows.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, anon;
