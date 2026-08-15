import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS entirely. This is the one
 * audited admin path referenced in CLAUDE.md. It deliberately does NOT go
 * through Prisma/app_user at all (app_user isn't even a member of the
 * service_role Postgres role — see prisma/migrations/*_app_role), so every
 * RLS bypass in this codebase is reachable by grepping for
 * `createSupabaseAdminClient`, not buried inside the normal data-access
 * layer.
 *
 * Only use for operations that must act outside any user's tenancy scope —
 * e.g. creating a brand-new signup's first organization, before that user
 * has any org_members row for RLS to key off. Never use this to serve data
 * back to a request without re-checking who's allowed to see it.
 */
export function createSupabaseAdminClient() {
  const supabaseUrl = process.env["VITE_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
