import { createServerFn } from "@tanstack/react-start";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";
import { adReportInputSchema } from "./ad-reports-input";
import {
  buildAdRows,
  buildCampaignRoi,
  buildCreativeComparison,
  buildFunnel,
  buildLeaderboard,
  buildTouchSplit,
  findStaleAds,
  type AdMeta,
  type BookingRec,
  type LeadRec,
} from "./ad-reports";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_WINDOW_DAYS = 7;

/**
 * Ad performance report. One transaction, everything through withUserContext
 * (RLS), so an org with no data — or a caller with no org context — gets
 * empty arrays, never an error or another tenant's rows.
 *
 * ponytail: leads/bookings are fetched as rows and counted in TypeScript.
 * Fine for thousands per range; switch to groupBy/raw SQL if a range
 * routinely returns >~50k leads. Dates are UTC days, not IST.
 */
export const getAdReport = createServerFn({ method: "GET" })
  .validator(adReportInputSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const from = new Date(`${data.from}T00:00:00Z`);
    const toExclusive = new Date(new Date(`${data.to}T00:00:00Z`).getTime() + DAY_MS);
    const staleFrom = new Date(Date.now() - STALE_WINDOW_DAYS * DAY_MS);

    return withUserContext(userId, async (tx) => {
      const [adRecords, stats, leadRecords, bookingRecords, stats7, leads7Groups] = await Promise.all([
        tx.ad.findMany({ include: { adSet: { include: { campaign: true } } } }),
        tx.adDailyStat.groupBy({
          by: ["adId"],
          where: { date: { gte: from, lt: toExclusive } },
          _sum: { spend: true, impressions: true, clicks: true },
        }),
        tx.lead.findMany({
          where: {
            createdAt: { gte: from, lt: toExclusive },
            OR: [{ adId: { not: null } }, { firstTouchAdId: { not: null } }],
          },
          select: { adId: true, firstTouchAdId: true, status: true },
        }),
        tx.booking.findMany({
          where: { status: "confirmed", bookingDate: { gte: from, lt: toExclusive } },
          select: {
            totalPrice: true,
            lead: { select: { adId: true, firstTouchAdId: true, project: true } },
          },
        }),
        tx.adDailyStat.groupBy({
          by: ["adId"],
          where: { date: { gte: staleFrom } },
          _sum: { spend: true },
        }),
        tx.lead.groupBy({
          by: ["adId"],
          where: { createdAt: { gte: staleFrom }, adId: { not: null } },
          _count: { _all: true },
        }),
      ]);

      const ads: AdMeta[] = adRecords.map((a) => ({
        adId: a.id,
        adName: a.name,
        adSetId: a.adSetId,
        adSetName: a.adSet.name,
        campaignId: a.adSet.campaignId,
        campaignName: a.adSet.campaign.name,
      }));
      const leads: LeadRec[] = leadRecords;
      const bookings: BookingRec[] = bookingRecords.map((b) => ({
        adId: b.lead.adId,
        firstTouchAdId: b.lead.firstTouchAdId,
        project: b.lead.project,
        totalPrice: Number(b.totalPrice),
      }));

      const rows = buildAdRows(
        ads,
        stats.map((s) => ({
          adId: s.adId,
          spend: Number(s._sum.spend ?? 0),
          impressions: s._sum.impressions ?? 0,
          clicks: s._sum.clicks ?? 0,
        })),
        leads,
        bookings,
      );

      const spend7: Record<string, number> = {};
      for (const s of stats7) spend7[s.adId] = Number(s._sum.spend ?? 0);
      const leads7ByAd: Record<string, number> = {};
      for (const l of leads7Groups) if (l.adId) leads7ByAd[l.adId] = l._count._all;

      return {
        leaderboard: buildLeaderboard(rows),
        creative: buildCreativeComparison(rows),
        roi: buildCampaignRoi(rows, ads, bookings),
        funnel: buildFunnel(rows),
        touch: buildTouchSplit(rows),
        stale: findStaleAds(ads, spend7, leads7ByAd),
      };
    });
  });
