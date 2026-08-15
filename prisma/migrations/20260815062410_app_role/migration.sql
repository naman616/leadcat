-- ============================================================================
-- A dedicated, non-superuser Postgres role for Prisma's app-runtime
-- connection (DATABASE_URL) — deliberately NOT the default "postgres" role
-- used for migrations, because "postgres" is a superuser and superusers
-- bypass RLS entirely, regardless of any policy. If Prisma's app connection
-- used "postgres", every RLS policy in this project would be dead code for
-- real application queries — only ever exercised by tests that explicitly
-- SET ROLE, never by the app itself.
--
-- app_user has no direct table grants of its own. It's only a member of
-- authenticated and anon — NOT service_role — so the app can (and, per
-- src/lib/db.server.ts, always does) SET LOCAL ROLE authenticated/anon per
-- request, but structurally cannot SET ROLE service_role to bypass RLS even
-- if application code tried to. A forgotten SET LOCAL fails closed (zero
-- rows, no active role's grants apply) rather than silently running with
-- superuser privileges.
--
-- This migration only creates the role's structure. The password is set
-- separately, out of version control — see the deploy note this migration
-- ships with.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT authenticated TO app_user;
GRANT anon TO app_user;
-- Deliberately no: GRANT service_role TO app_user;

GRANT CONNECT ON DATABASE postgres TO app_user;
