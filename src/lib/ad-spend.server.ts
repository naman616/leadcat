import { createServerFn } from "@tanstack/react-start";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";
import { MockMetaMarketingProvider } from "./ad-spend/mock-meta-provider";
import { MockGoogleAdsProvider } from "./ad-spend/mock-google-provider";
import type { AdSpendProvider } from "./ad-spend/provider";

// The one place to swap in real vendor SDKs once accounts exist (issues
// #27/#28) — everything below depends only on AdSpendProvider.
const providersByPlatform: Record<"meta" | "google", AdSpendProvider> = {
  meta: new MockMetaMarketingProvider(),
  google: new MockGoogleAdsProvider(),
};

// The whole "rolling re-sync" window (issue #29) — every run re-fetches
// this many trailing days, because ad platforms revise a day's own
// attributed numbers for days after it ends.
const ROLLING_WINDOW_DAYS = 28;

/**
 * Re-fetches the trailing 28 days of spend/impressions/clicks for one ad
 * account and upserts them into ad_daily_stats, as `userId` (RLS gates the
 * write to org admins — this throws "row-level security" via Postgres if
 * userId isn't one for adAccountId's org). Plain function, not a
 * createServerFn, so both the interactive "Sync now" button (syncAdSpend
 * below) and the nightly cron (src/lib/ad-spend/cron-handler.ts, running as
 * a fixed system account — see docs/specs/10-ad-spend-sync.md) can call the
 * exact same logic instead of one of them drifting out of sync with a
 * hand-duplicated copy.
 */
export async function runAdSpendSync(
  userId: string,
  adAccountId: string,
): Promise<{ syncedAds: number; syncedDays: number }> {
  return withUserContext(userId, async (tx) => {
    const adAccount = await tx.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });

    const ads = await tx.ad.findMany({
      where: { adSet: { campaign: { adAccountId: adAccount.id } } },
      select: { id: true, externalAdId: true },
    });
    if (ads.length === 0) return { syncedAds: 0, syncedDays: 0 };

    const until = new Date();
    const since = new Date(until);
    since.setDate(since.getDate() - (ROLLING_WINDOW_DAYS - 1));

    const provider = providersByPlatform[adAccount.platform];
    const points = await provider.fetchDailyStats(
      adAccount.externalAccountId,
      ads.map((a) => a.externalAdId),
      since,
      until,
    );

    // Multiple Ad rows could in principle share an external_ad_id across
    // different ad sets (nothing in this schema forbids hand-entering
    // that); a provider's stat for that id would then apply to all of
    // them — same "attribute to every match" shape as
    // record_inbound_whatsapp_message's phone-number lookup.
    const adIdsByExternalId = new Map<string, string[]>();
    for (const ad of ads) {
      const existing = adIdsByExternalId.get(ad.externalAdId);
      if (existing) existing.push(ad.id);
      else adIdsByExternalId.set(ad.externalAdId, [ad.id]);
    }

    const rows: {
      adId: string;
      date: string;
      impressions: number;
      clicks: number;
      spend: string;
    }[] = [];
    for (const point of points) {
      const adIds = adIdsByExternalId.get(point.externalAdId);
      if (!adIds) continue; // a stat for an ad we don't know about — skip, don't fail the whole sync
      for (const adId of adIds) {
        rows.push({
          adId,
          date: point.date,
          impressions: point.impressions,
          clicks: point.clicks,
          spend: point.spend,
        });
      }
    }
    if (rows.length === 0) return { syncedAds: ads.length, syncedDays: 0 };

    // One bulk upsert, not one round trip per (ad, day) — a 20+ ad
    // account over a 28-day window is hundreds of sequential awaits
    // inside a single interactive transaction otherwise, risking
    // db.server.ts's TRANSACTION_TIMEOUT_MS on a real (non-local)
    // connection. Well under Postgres's per-statement parameter limit at
    // this app's realistic ad-account sizes.
    const values = Prisma.join(
      rows.map(
        (r) =>
          Prisma.sql`(${adAccount.orgId}::uuid, ${r.adId}::uuid, ${r.date}::date, ${r.impressions}, ${r.clicks}, ${r.spend}::decimal)`,
      ),
    );
    await tx.$executeRaw`
        INSERT INTO ad_daily_stats (org_id, ad_id, date, impressions, clicks, spend)
        VALUES ${values}
        ON CONFLICT (ad_id, date) DO UPDATE SET
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          spend = EXCLUDED.spend,
          synced_at = now()
      `;

    return { syncedAds: ads.length, syncedDays: rows.length };
  });
}

/** Interactive "Sync now" entry point — resolves the caller from their session, then delegates. */
export const syncAdSpend = createServerFn({ method: "POST" })
  .validator(z.object({ adAccountId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return runAdSpendSync(userId, data.adAccountId);
  });

export const listAdDailyStats = createServerFn({ method: "GET" })
  .validator(z.object({ adAccountId: z.string().uuid().optional() }).optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const stats = await tx.adDailyStat.findMany({
        where: data?.adAccountId
          ? { ad: { adSet: { campaign: { adAccountId: data.adAccountId } } } }
          : {},
        orderBy: { date: "desc" },
      });
      // spend is a Prisma Decimal, not JSON-serializable across the
      // createServerFn boundary — stringify it, same convention as
      // units.price (src/lib/unit-price.server.ts).
      return stats.map((s) => ({ ...s, spend: s.spend.toString() }));
    });
  });
