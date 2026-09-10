import { withUserContext } from "../db.server";
import { runAdSpendSync } from "../ad-spend.server";

/**
 * Nightly fan-out for syncAdSpend — the "what actually runs this nightly"
 * question docs/specs/10-ad-spend-sync.md deliberately left open. Wired up
 * as a Vercel Cron job (see vercel.json) hitting this route.
 *
 * syncAdSpend's writes are RLS-gated to org admins, and there's no logged-in
 * user in a cron invocation, so this runs as a fixed per-org "system"
 * account instead (AD_SPEND_SYNC_SYSTEM_USER_ID) — provisioned once per
 * environment by scripts/setup-ad-spend-sync-system-user.ts, which also adds
 * it as an org-admin member of every org, same as every other write in this
 * app going through withUserContext. Zero new RLS bypass: this reuses the
 * exact path syncAdSpend already uses, just with a different (fixed) userId.
 */
export async function handleAdSpendSyncCron(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const cronSecret = process.env["CRON_SECRET"];
  if (!cronSecret) {
    console.error("[ad-spend cron] CRON_SECRET is not set");
    return new Response("Server misconfigured", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const systemUserId = process.env["AD_SPEND_SYNC_SYSTEM_USER_ID"];
  if (!systemUserId) {
    console.error(
      "[ad-spend cron] AD_SPEND_SYNC_SYSTEM_USER_ID is not set — run " +
        "scripts/setup-ad-spend-sync-system-user.ts first",
    );
    return new Response("Server misconfigured", { status: 500 });
  }

  // RLS's "org members can view ad accounts" policy does the actual
  // scoping here: this returns every ad account in every org the system
  // user is a member of, i.e. every org that's had the bootstrap/backfill
  // script run against it — nothing more.
  const adAccounts = await withUserContext(systemUserId, (tx) =>
    tx.adAccount.findMany({ select: { id: true } }),
  );

  let synced = 0;
  let failed = 0;
  for (const account of adAccounts) {
    try {
      await runAdSpendSync(systemUserId, account.id);
      synced++;
    } catch (error) {
      failed++;
      // One ad account's provider error or transient DB hiccup shouldn't
      // sink the rest of the night's run — same "isolate per item, keep
      // going" shape as the WhatsApp/Meta webhook handlers' per-message
      // try/catch.
      console.error(`[ad-spend cron] sync failed for ad account ${account.id}:`, error);
    }
  }

  return Response.json({ total: adAccounts.length, synced, failed });
}
