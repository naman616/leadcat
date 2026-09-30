// Pure builders for the ad reports (docs/specs/2026-09-30-ad-reports-design
// lives in docs/superpowers/specs). No I/O — the server function fetches the
// records and passes them in, same split as lead-scoring.ts.

export interface AdMeta {
  adId: string;
  adName: string;
  adSetId: string;
  adSetName: string;
  campaignId: string;
  campaignName: string;
}
export interface AdStat {
  adId: string;
  spend: number;
  impressions: number;
  clicks: number;
}
export interface LeadRec {
  adId: string | null;
  firstTouchAdId: string | null;
  status: string;
}
export interface BookingRec {
  adId: string | null;
  firstTouchAdId: string | null;
  project: string | null;
  totalPrice: number;
}
export interface AdRow extends AdMeta {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  siteVisits: number;
  bookings: number;
  bookingValue: number;
  firstTouchLeads: number;
  firstTouchBookings: number;
}
export interface LeaderboardRow extends AdRow {
  cpl: number | null;
  costPerSiteVisit: number | null;
  costPerBooking: number | null;
}
export interface CampaignRoiRow {
  campaignId: string;
  campaignName: string;
  spend: number;
  bookingValue: number;
  roi: number | null;
  byProject: { project: string; value: number }[];
}
export interface FunnelStep {
  label: string;
  value: number;
  dropOffPct: number | null;
}
export interface TouchRow {
  adId: string;
  adName: string;
  lastTouchLeads: number;
  firstTouchLeads: number;
  lastTouchBookings: number;
  firstTouchBookings: number;
  disagrees: boolean;
}

/** Statuses (Prisma enum identifiers, not the DB-mapped labels) that count as "reached a site visit" (status is current-only, so this is a lower bound). */
const SITE_VISIT_STATUSES = new Set(["SiteVisit", "Booked"]);
/** First/last-touch lead counts differing by at least this share of the larger one... */
const TOUCH_DISAGREE_RATIO = 0.5;
/** ...and only when the larger count is at least this, so tiny samples don't flag. */
const TOUCH_MIN_LEADS = 3;

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function buildAdRows(
  ads: AdMeta[],
  stats: AdStat[],
  leads: LeadRec[],
  bookings: BookingRec[],
): AdRow[] {
  const byId = new Map<string, AdRow>(
    ads.map((a) => [
      a.adId,
      {
        ...a,
        spend: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
        siteVisits: 0,
        bookings: 0,
        bookingValue: 0,
        firstTouchLeads: 0,
        firstTouchBookings: 0,
      },
    ]),
  );

  for (const s of stats) {
    const row = byId.get(s.adId);
    if (!row) continue;
    row.spend += s.spend;
    row.impressions += s.impressions;
    row.clicks += s.clicks;
  }
  for (const l of leads) {
    const last = l.adId ? byId.get(l.adId) : undefined;
    if (last) {
      last.leads += 1;
      if (SITE_VISIT_STATUSES.has(l.status)) last.siteVisits += 1;
    }
    const first = l.firstTouchAdId ? byId.get(l.firstTouchAdId) : undefined;
    if (first) first.firstTouchLeads += 1;
  }
  for (const b of bookings) {
    const last = b.adId ? byId.get(b.adId) : undefined;
    if (last) {
      last.bookings += 1;
      last.bookingValue += b.totalPrice;
    }
    const first = b.firstTouchAdId ? byId.get(b.firstTouchAdId) : undefined;
    if (first) first.firstTouchBookings += 1;
  }
  return [...byId.values()];
}

function withCosts(r: AdRow): LeaderboardRow {
  return {
    ...r,
    cpl: ratio(r.spend, r.leads),
    costPerSiteVisit: ratio(r.spend, r.siteVisits),
    costPerBooking: ratio(r.spend, r.bookings),
  };
}

/** Cost per booking ascending; ads with no bookings last, ordered by CPL (null CPL last of all). */
export function buildLeaderboard(rows: AdRow[]): LeaderboardRow[] {
  return rows.map(withCosts).sort((a, b) => {
    if (a.costPerBooking !== null && b.costPerBooking !== null) return a.costPerBooking - b.costPerBooking;
    if (a.costPerBooking !== null) return -1;
    if (b.costPerBooking !== null) return 1;
    if (a.cpl !== null && b.cpl !== null) return a.cpl - b.cpl;
    if (a.cpl !== null) return -1;
    if (b.cpl !== null) return 1;
    return 0;
  });
}

/** Ads grouped by ad set (targeting held constant); ad sets with one ad have nothing to compare. */
export function buildCreativeComparison(rows: AdRow[]) {
  const sets = new Map<string, { adSetId: string; adSetName: string; campaignName: string; rows: AdRow[] }>();
  for (const r of rows) {
    const set = sets.get(r.adSetId) ?? {
      adSetId: r.adSetId,
      adSetName: r.adSetName,
      campaignName: r.campaignName,
      rows: [],
    };
    set.rows.push(r);
    sets.set(r.adSetId, set);
  }
  return [...sets.values()]
    .filter((s) => s.rows.length > 1)
    .map((s) => ({
      adSetId: s.adSetId,
      adSetName: s.adSetName,
      campaignName: s.campaignName,
      ads: buildLeaderboard(s.rows),
    }));
}

export function buildCampaignRoi(rows: AdRow[], ads: AdMeta[], bookings: BookingRec[]): CampaignRoiRow[] {
  const campaignOfAd = new Map(ads.map((a) => [a.adId, a.campaignId]));
  const out = new Map<string, CampaignRoiRow>();
  for (const r of rows) {
    const c = out.get(r.campaignId) ?? {
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      spend: 0,
      bookingValue: 0,
      roi: null,
      byProject: [],
    };
    c.spend += r.spend;
    c.bookingValue += r.bookingValue;
    out.set(r.campaignId, c);
  }
  const projectValue = new Map<string, Map<string, number>>();
  for (const b of bookings) {
    const campaignId = b.adId ? campaignOfAd.get(b.adId) : undefined;
    if (!campaignId) continue;
    const m = projectValue.get(campaignId) ?? new Map<string, number>();
    const project = b.project ?? "Unknown";
    m.set(project, (m.get(project) ?? 0) + b.totalPrice);
    projectValue.set(campaignId, m);
  }
  for (const c of out.values()) {
    c.roi = ratio(c.bookingValue, c.spend);
    c.byProject = [...(projectValue.get(c.campaignId) ?? [])]
      .map(([project, value]) => ({ project, value }))
      .sort((a, b) => b.value - a.value);
  }
  return [...out.values()].sort((a, b) => (b.roi ?? -1) - (a.roi ?? -1));
}

/** impressions -> clicks -> leads -> site visit -> booked. No reach/qualified: no backing data. */
export function buildFunnel(rows: AdRow[]): FunnelStep[] {
  const sum = (f: (r: AdRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const bookings = sum((r) => r.bookings);
  // Bookings are keyed by booking date, site visits by lead creation date, so
  // bookings can exceed site visits; clamp so the funnel never widens.
  const siteVisits = Math.max(sum((r) => r.siteVisits), bookings);
  const steps: [string, number][] = [
    ["Impressions", sum((r) => r.impressions)],
    ["Clicks", sum((r) => r.clicks)],
    ["Leads", sum((r) => r.leads)],
    ["Site visit", siteVisits],
    ["Booked", bookings],
  ];
  return steps.map(([label, value], i) => {
    const prev = steps[i - 1]?.[1] ?? null;
    const drop = prev === null || prev === 0 ? null : Math.max(0, (1 - value / prev) * 100);
    return { label, value, dropOffPct: drop };
  });
}

export function buildTouchSplit(rows: AdRow[]): TouchRow[] {
  return rows.map((r) => {
    const big = Math.max(r.leads, r.firstTouchLeads);
    const gap = Math.abs(r.leads - r.firstTouchLeads);
    return {
      adId: r.adId,
      adName: r.adName,
      lastTouchLeads: r.leads,
      firstTouchLeads: r.firstTouchLeads,
      lastTouchBookings: r.bookings,
      firstTouchBookings: r.firstTouchBookings,
      disagrees: big >= TOUCH_MIN_LEADS && gap / big >= TOUCH_DISAGREE_RATIO,
    };
  });
}

/** Ads still spending with zero leads in the window. Maps are adId -> total over the window. */
export function findStaleAds(
  ads: AdMeta[],
  spend7ByAd: Record<string, number>,
  leads7ByAd: Record<string, number>,
): AdMeta[] {
  return ads.filter((a) => (spend7ByAd[a.adId] ?? 0) > 0 && (leads7ByAd[a.adId] ?? 0) === 0);
}
