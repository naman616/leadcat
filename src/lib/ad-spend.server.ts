import { createServerFn } from "@tanstack/react-start";
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
 * Re-fetches the trailing 28 days of spend/impressions/clicks for every ad
 * under one ad account and upserts them into ad_daily_stats. A normal
 * authenticated, admin-triggered write (RLS gates it to org admins) — not
 * wired to any scheduler. See docs/specs/10-ad-spend-sync.md for what
 * "nightly" actually requires and why that's not decided here.
 */
export const syncAdSpend = createServerFn({ method: "POST" })
  .validator(z.object({ adAccountId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const adAccount = await tx.adAccount.findUniqueOrThrow({ where: { id: data.adAccountId } });

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

      let syncedDays = 0;
      for (const point of points) {
        const adIds = adIdsByExternalId.get(point.externalAdId);
        if (!adIds) continue; // a stat for an ad we don't know about — skip, don't fail the whole sync

        for (const adId of adIds) {
          await tx.adDailyStat.upsert({
            where: { adId_date: { adId, date: new Date(point.date) } },
            create: {
              orgId: adAccount.orgId,
              adId,
              date: new Date(point.date),
              impressions: point.impressions,
              clicks: point.clicks,
              spend: point.spend,
            },
            update: {
              impressions: point.impressions,
              clicks: point.clicks,
              spend: point.spend,
            },
          });
          syncedDays++;
        }
      }

      return { syncedAds: ads.length, syncedDays };
    });
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
