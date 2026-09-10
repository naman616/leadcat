// One-time (per environment) bootstrap for the nightly ad-spend cron
// (docs/specs/10-ad-spend-sync.md). Creates a fixed "system" Supabase Auth
// user that owns no real login, then seats it as an org-admin member of
// every existing org — the same org_members shape syncAdSpend already
// requires for a normal user, so the cron (src/lib/ad-spend/cron-handler.ts)
// can call it through withUserContext exactly like any other admin write,
// with zero new RLS bypass.
//
// Idempotent: safe to re-run. Re-running with SUPABASE_URL/
// SUPABASE_SERVICE_ROLE_KEY already pointed at an environment that has a
// system user just backfills any org created since the last run — it does
// not create a second system user (looked up by fixed email first).
//
// This talks to the real Supabase project on purpose (Admin API + service
// role) — unlike scripts/seed.ts and scripts/apply-test-schema.ts, which
// explicitly refuse anything that looks like the real project. Run this
// manually, with the same care as applying a migration to a shared/prod
// database (CLAUDE.md's review gates) — it is not run automatically by any
// app code path or CI job.
//
// After it prints the system user's id, set AD_SPEND_SYNC_SYSTEM_USER_ID to
// that value everywhere the app runs (.env locally, Vercel project env
// vars for prod) — src/lib/ad-spend/cron-handler.ts and signUp() both read
// it from there, not from anywhere in the database.
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.server";

const SYSTEM_USER_EMAIL = "system+ad-spend-sync@leadcat.internal";

async function main() {
  const admin = createSupabaseAdminClient();

  const systemUserId = await findOrCreateSystemUser(admin);
  console.log(`System user: ${systemUserId} (${SYSTEM_USER_EMAIL})`);

  const { data: orgs, error: orgsError } = await admin.from("organizations").select("id, name");
  if (orgsError) throw new Error(orgsError.message);

  let added = 0;
  let alreadyMember = 0;
  for (const org of orgs ?? []) {
    const { error: insertError } = await admin
      .from("org_members")
      .insert({ org_id: org["id"], user_id: systemUserId, role: "admin" });
    if (!insertError) {
      added++;
    } else if (insertError.code === "23505") {
      // unique_violation on (org_id, user_id) — already a member, fine.
      alreadyMember++;
    } else {
      throw new Error(
        `Failed to add system user to org ${org["id"]} (${org["name"]}): ${insertError.message}`,
      );
    }
  }

  console.log(
    `Orgs backfilled: ${added} added, ${alreadyMember} already members, ${orgs?.length ?? 0} total.`,
  );
  console.log("");
  console.log(
    `Set AD_SPEND_SYNC_SYSTEM_USER_ID=${systemUserId} in .env and in Vercel's project env vars.`,
  );
}

async function findOrCreateSystemUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<string> {
  // supabase-js's admin.listUsers() has no filter-by-email — page through
  // until found or exhausted. Fine at this app's user-count scale; this
  // script is a one-time/rare manual operation, not a hot path.
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const existing = data.users.find((u) => u.email === SYSTEM_USER_EMAIL);
    if (existing) return existing.id;
    if (data.users.length < 200) break;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: SYSTEM_USER_EMAIL,
    email_confirm: true,
    user_metadata: { system_account: true, purpose: "ad-spend-sync-cron" },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "Failed to create system user");
  }
  return data.user.id;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
