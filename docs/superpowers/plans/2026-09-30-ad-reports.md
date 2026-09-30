# Ad Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/ad-reports` page with six real ad-performance views (leaderboard, creative comparison, campaign ROI, funnel, first- vs last-touch, stale ads) over a date range, plus leaderboard CSV export.

**Architecture:** Pure functions in `src/lib/ad-reports.ts` turn raw records (ads, summed daily stats, leads, confirmed bookings) into the six views. One server function in `src/lib/ad-reports.server.ts` fetches those records inside a single `withUserContext` transaction and returns the built report. One flat route renders it with TanStack Query.

**Tech Stack:** TanStack Start (`createServerFn`, `.validator`), Zod, Prisma via `withUserContext`, TanStack Query, Vitest, Tailwind. Package manager: bun.

**Spec:** `docs/superpowers/specs/2026-09-30-ad-reports-design.md`

## Global Constraints

- No migration, no new dependency, no background job.
- Every query goes through `withUserContext` (`src/lib/db.server.ts`). No service role, no bare `prisma`.
- Leaderboard sorts by cost per booking; zero-booking ads sort last, by CPL. Lead count is never the headline.
- Division by zero returns `null`, rendered "—". Never `Infinity`/`NaN`/fake `0`.
- No `reach` or `qualified` columns anywhere.
- Stale window is a fixed 7 days and ignores the date filter.
- Use the package manager `bun` (`bun run test`, `bun run typecheck`, `bun run lint`).
- Tenancy-adjacent: flag for explicit human review before merge (CLAUDE.md).

## Review Focus

- Bookings in range from leads created before the range: funnel "site visit" must never be lower than "booked" (no negative drop-off). Pinned in Task 1.
- Ad with spend but zero leads and zero bookings: leaderboard shows "—" for every cost, and sorts after ads that have bookings. Pinned in Task 1.
- Leads/bookings with `adId` null or pointing at an ad missing from the hierarchy: must be ignored, not crash or create a phantom row. Pinned in Task 1.
- Empty org (no ads, no stats): report returns empty arrays and the page shows an empty state, not an error. Pinned in Task 1 and Task 3.
- `from` after `to`, or malformed date: validator rejects it. Pinned in Task 2.

---

### Task 1: Pure report builders

**Files:**
- Create: `src/lib/ad-reports.ts`
- Test: `tests/ad-reports.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `src/lib/ad-reports.ts`):
  - `AdMeta = { adId; adName; adSetId; adSetName; campaignId; campaignName }` (all `string`)
  - `AdStat = { adId: string; spend: number; impressions: number; clicks: number }`
  - `LeadRec = { adId: string | null; firstTouchAdId: string | null; status: string }`
  - `BookingRec = { adId: string | null; firstTouchAdId: string | null; project: string | null; totalPrice: number }`
  - `AdRow = AdMeta & { spend; impressions; clicks; leads; siteVisits; bookings; bookingValue; firstTouchLeads; firstTouchBookings }` (numbers)
  - `buildAdRows(ads, stats, leads, bookings): AdRow[]`
  - `buildLeaderboard(rows): LeaderboardRow[]` where `LeaderboardRow = AdRow & { cpl; costPerSiteVisit; costPerBooking: number | null }`
  - `buildCreativeComparison(rows): { adSetId; adSetName; campaignName; ads: LeaderboardRow[] }[]`
  - `buildCampaignRoi(rows, ads, bookings): CampaignRoiRow[]`, `CampaignRoiRow = { campaignId; campaignName; spend; bookingValue; roi: number | null; byProject: { project: string; value: number }[] }`
  - `buildFunnel(rows): FunnelStep[]`, `FunnelStep = { label: string; value: number; dropOffPct: number | null }`
  - `buildTouchSplit(rows): TouchRow[]`, `TouchRow = { adId; adName; lastTouchLeads; firstTouchLeads; lastTouchBookings; firstTouchBookings; disagrees: boolean }`
  - `findStaleAds(ads, spend7ByAd, leads7ByAd): AdMeta[]` (maps are `Record<string, number>`)

- [ ] **Step 1: Write the failing tests**

Create `tests/ad-reports.test.ts`:

```ts
// Pure-function tests for the ad report builders (no DB — same pattern as
// tests/lead-scoring.test.ts).
import { describe, expect, it } from "vitest";
import {
  buildAdRows,
  buildCampaignRoi,
  buildCreativeComparison,
  buildFunnel,
  buildLeaderboard,
  buildTouchSplit,
  findStaleAds,
  type AdMeta,
  type AdStat,
  type BookingRec,
  type LeadRec,
} from "../src/lib/ad-reports";

const meta = (id: string, adSetId = "s1", campaignId = "c1"): AdMeta => ({
  adId: id,
  adName: `Ad ${id}`,
  adSetId,
  adSetName: `Set ${adSetId}`,
  campaignId,
  campaignName: `Campaign ${campaignId}`,
});
const stat = (adId: string, spend: number, impressions = 1000, clicks = 100): AdStat => ({
  adId,
  spend,
  impressions,
  clicks,
});
const lead = (adId: string | null, status = "New", firstTouchAdId: string | null = adId): LeadRec => ({
  adId,
  firstTouchAdId,
  status,
});
const booking = (adId: string | null, totalPrice: number, project: string | null = "Tower A"): BookingRec => ({
  adId,
  firstTouchAdId: adId,
  project,
  totalPrice,
});

describe("buildAdRows", () => {
  it("counts leads, site visits (SiteVisit + Booked) and bookings per ad", () => {
    const rows = buildAdRows(
      [meta("a")],
      [stat("a", 500)],
      [lead("a", "New"), lead("a", "SiteVisit"), lead("a", "Booked"), lead("a", "Dropped")],
      [booking("a", 9_000_000)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      spend: 500,
      leads: 4,
      siteVisits: 2,
      bookings: 1,
      bookingValue: 9_000_000,
    });
  });

  it("ignores leads and bookings whose ad is null or not in the hierarchy", () => {
    const rows = buildAdRows(
      [meta("a")],
      [],
      [lead(null), lead("ghost")],
      [booking(null, 100), booking("ghost", 100)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leads: 0, bookings: 0, bookingValue: 0, spend: 0 });
  });

  it("tracks first-touch separately from last-touch", () => {
    const rows = buildAdRows([meta("a"), meta("b")], [], [lead("a", "New", "b")], []);
    const byId = Object.fromEntries(rows.map((r) => [r.adId, r]));
    expect(byId.a.leads).toBe(1);
    expect(byId.a.firstTouchLeads).toBe(0);
    expect(byId.b.leads).toBe(0);
    expect(byId.b.firstTouchLeads).toBe(1);
  });

  it("returns [] for an empty org", () => {
    expect(buildAdRows([], [], [], [])).toEqual([]);
  });
});

describe("buildLeaderboard", () => {
  it("sorts by cost per booking ascending, zero-booking ads last ordered by CPL", () => {
    const rows = buildAdRows(
      [meta("cheapBooking"), meta("pricyBooking"), meta("noBookCheapLead"), meta("noBookPricyLead")],
      [stat("cheapBooking", 100), stat("pricyBooking", 900), stat("noBookCheapLead", 100), stat("noBookPricyLead", 100)],
      [
        lead("cheapBooking"),
        lead("pricyBooking"),
        lead("noBookCheapLead"),
        lead("noBookCheapLead"),
        lead("noBookPricyLead"),
      ],
      [booking("cheapBooking", 1), booking("pricyBooking", 1)],
    );
    expect(buildLeaderboard(rows).map((r) => r.adId)).toEqual([
      "cheapBooking",
      "pricyBooking",
      "noBookCheapLead",
      "noBookPricyLead",
    ]);
  });

  it("gives null costs (not Infinity/NaN) when denominators are zero", () => {
    const [row] = buildLeaderboard(buildAdRows([meta("a")], [stat("a", 500)], [], []));
    expect(row.cpl).toBeNull();
    expect(row.costPerSiteVisit).toBeNull();
    expect(row.costPerBooking).toBeNull();
  });

  it("computes CPL and cost per booking", () => {
    const [row] = buildLeaderboard(
      buildAdRows([meta("a")], [stat("a", 600)], [lead("a"), lead("a", "Booked"), lead("a")], [booking("a", 1)]),
    );
    expect(row.cpl).toBe(200);
    expect(row.costPerBooking).toBe(600);
  });
});

describe("buildCreativeComparison", () => {
  it("groups by ad set and drops ad sets with a single ad", () => {
    const rows = buildAdRows(
      [meta("a", "s1"), meta("b", "s1"), meta("c", "s2")],
      [],
      [],
      [],
    );
    const out = buildCreativeComparison(rows);
    expect(out).toHaveLength(1);
    expect(out[0].adSetId).toBe("s1");
    expect(out[0].ads.map((r) => r.adId).sort()).toEqual(["a", "b"]);
  });
});

describe("buildCampaignRoi", () => {
  it("divides booking value by spend and breaks value down by project", () => {
    const ads = [meta("a", "s1", "c1"), meta("b", "s2", "c1")];
    const bookings = [booking("a", 1000, "Tower A"), booking("b", 500, "Tower B"), booking("a", 500, "Tower A")];
    const rows = buildAdRows(ads, [stat("a", 100), stat("b", 100)], [], bookings);
    const [c1] = buildCampaignRoi(rows, ads, bookings);
    expect(c1).toMatchObject({ campaignId: "c1", spend: 200, bookingValue: 2000, roi: 10 });
    expect(c1.byProject).toEqual([
      { project: "Tower A", value: 1500 },
      { project: "Tower B", value: 500 },
    ]);
  });

  it("gives roi null when a campaign has no spend", () => {
    const ads = [meta("a")];
    const bookings = [booking("a", 1000)];
    const rows = buildAdRows(ads, [], [], bookings);
    expect(buildCampaignRoi(rows, ads, bookings)[0].roi).toBeNull();
  });

  it("labels a null project as Unknown", () => {
    const ads = [meta("a")];
    const bookings = [booking("a", 1000, null)];
    const rows = buildAdRows(ads, [stat("a", 10)], [], bookings);
    expect(buildCampaignRoi(rows, ads, bookings)[0].byProject).toEqual([{ project: "Unknown", value: 1000 }]);
  });
});

describe("buildFunnel", () => {
  it("returns impressions -> clicks -> leads -> site visit -> booked with drop-off %", () => {
    const rows = buildAdRows(
      [meta("a")],
      [stat("a", 100, 1000, 100)],
      [lead("a"), lead("a"), lead("a", "SiteVisit"), lead("a", "SiteVisit")],
      [booking("a", 1)],
    );
    const f = buildFunnel(rows);
    expect(f.map((s) => [s.label, s.value])).toEqual([
      ["Impressions", 1000],
      ["Clicks", 100],
      ["Leads", 4],
      ["Site visit", 2],
      ["Booked", 1],
    ]);
    expect(f[0].dropOffPct).toBeNull();
    expect(f[1].dropOffPct).toBe(90);
    expect(f[4].dropOffPct).toBe(50);
  });

  it("never shows booked above site visit (bookings from older leads)", () => {
    const rows = buildAdRows([meta("a")], [], [lead("a")], [booking("a", 1), booking("a", 1)]);
    const f = buildFunnel(rows);
    const site = f.find((s) => s.label === "Site visit")!;
    const booked = f.find((s) => s.label === "Booked")!;
    expect(site.value).toBeGreaterThanOrEqual(booked.value);
    expect(booked.dropOffPct).toBe(0);
  });

  it("gives null drop-off when the previous step is zero", () => {
    const f = buildFunnel(buildAdRows([meta("a")], [], [], []));
    expect(f.every((s) => s.dropOffPct === null)).toBe(true);
  });
});

describe("buildTouchSplit", () => {
  it("flags ads where first- and last-touch leads differ a lot", () => {
    const leads = [
      ...Array.from({ length: 6 }, () => lead("a", "New", "b")),
      lead("b", "New", "b"),
    ];
    const rows = buildAdRows([meta("a"), meta("b")], [], leads, []);
    const byId = Object.fromEntries(buildTouchSplit(rows).map((r) => [r.adId, r]));
    expect(byId.a.disagrees).toBe(true);
    expect(byId.b.disagrees).toBe(true);
  });

  it("does not flag tiny counts or agreeing ads", () => {
    const rows = buildAdRows([meta("a"), meta("b")], [], [lead("a", "New", "b"), lead("a"), lead("a"), lead("a")], []);
    const byId = Object.fromEntries(buildTouchSplit(rows).map((r) => [r.adId, r]));
    expect(byId.b.disagrees).toBe(false);
  });
});

describe("findStaleAds", () => {
  it("returns ads with spend in the window and zero leads", () => {
    const ads = [meta("spendNoLeads"), meta("spendAndLeads"), meta("noSpend")];
    const stale = findStaleAds(ads, { spendNoLeads: 50, spendAndLeads: 50 }, { spendAndLeads: 2 });
    expect(stale.map((a) => a.adId)).toEqual(["spendNoLeads"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test tests/ad-reports.test.ts`
Expected: FAIL — cannot resolve `../src/lib/ad-reports`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ad-reports.ts`:

```ts
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
    const prev = i === 0 ? null : steps[i - 1][1];
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test tests/ad-reports.test.ts`
Expected: PASS, all tests green. If the "flags ads where first- and last-touch differ" test fails, re-check that ad `a` has 6 last-touch / 0 first-touch and ad `b` has 1 last-touch / 7 first-touch (both gaps >= 50% of the larger count, larger >= 3).

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add src/lib/ad-reports.ts tests/ad-reports.test.ts
git commit -m "feat: pure ad report builders"
```

---

### Task 2: Server function

**Files:**
- Create: `src/lib/ad-reports-input.ts`, `src/lib/ad-reports.server.ts`
- Test: `tests/ad-reports-input.test.ts`

**Interfaces:**
- Consumes: everything produced by Task 1; `withUserContext` (`src/lib/db.server.ts`), `requireUserId` (`src/lib/current-user.server.ts`).
- Produces:
  - `adReportInputSchema` (Zod): `{ from: "YYYY-MM-DD", to: "YYYY-MM-DD" }`, rejects malformed dates and `from > to`.
  - `getAdReport({ data: { from, to } })` returning `{ leaderboard: LeaderboardRow[]; creative: ReturnType<typeof buildCreativeComparison>; roi: CampaignRoiRow[]; funnel: FunnelStep[]; touch: TouchRow[]; stale: AdMeta[] }`.

The input schema lives in its own exported const so it can be tested without importing TanStack server code.

- [ ] **Step 1: Write the failing test**

Create `tests/ad-reports-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adReportInputSchema } from "../src/lib/ad-reports-input";

describe("adReportInputSchema", () => {
  it("accepts a valid range, including a single day", () => {
    expect(adReportInputSchema.safeParse({ from: "2026-09-01", to: "2026-09-30" }).success).toBe(true);
    expect(adReportInputSchema.safeParse({ from: "2026-09-01", to: "2026-09-01" }).success).toBe(true);
  });

  it("rejects from after to", () => {
    expect(adReportInputSchema.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success).toBe(false);
  });

  it("rejects malformed and impossible dates", () => {
    expect(adReportInputSchema.safeParse({ from: "30/09/2026", to: "2026-09-30" }).success).toBe(false);
    expect(adReportInputSchema.safeParse({ from: "2026-02-31", to: "2026-03-05" }).success).toBe(false);
    expect(adReportInputSchema.safeParse({ from: "", to: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/ad-reports-input.test.ts`
Expected: FAIL — cannot resolve `../src/lib/ad-reports-input`.

- [ ] **Step 3: Write the schema module**

Create `src/lib/ad-reports-input.ts`:

```ts
import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), {
    message: "not a real calendar date",
  });

export const adReportInputSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" });

export type AdReportInput = z.infer<typeof adReportInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/ad-reports-input.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the server function**

Create `src/lib/ad-reports.server.ts`:

```ts
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
```

- [ ] **Step 6: Typecheck and commit**

Run: `bun run typecheck`
Expected: no errors. If `tx.booking.findMany` complains about `status: "confirmed"`, use the Prisma enum value as declared in `prisma/schema.prisma` (`BookingStatus.confirmed`).

```bash
git add src/lib/ad-reports-input.ts src/lib/ad-reports.server.ts tests/ad-reports-input.test.ts
git commit -m "feat: getAdReport server function"
```

---

### Task 3: `/ad-reports` route, nav link, CSV export

**Files:**
- Create: `src/routes/ad-reports.tsx`
- Modify: `src/components/crm/AppShell.tsx:42` (add a nav item after Reports)
- Generated: `src/routeTree.gen.ts` (regenerated by the dev server/build; do not hand-edit)

**Interfaces:**
- Consumes: `getAdReport` (Task 2), `stringifyCsv` from `src/lib/csv.ts` (`(string | number | null | undefined)[][] -> string`), `AppShell` (`title`, `actions`, children), `cn` from `src/lib/utils`.
- Produces: the page. No exports other than `Route`.

- [ ] **Step 1: Add the nav item**

In `src/components/crm/AppShell.tsx`, directly after the `{ to: "/reports", label: "Reports", icon: PieChart },` line add:

```ts
  { to: "/ad-reports", label: "Ad Reports", icon: PieChart },
```

- [ ] **Step 2: Create the route**

Create `src/routes/ad-reports.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { getAdReport } from "@/lib/ad-reports.server";
import { stringifyCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ad-reports")({
  head: () => ({ meta: [{ title: "Ad Reports — Estatly Real Estate CRM" }] }),
  component: AdReportsPage,
});

const TABS = ["Leaderboard", "Creative", "Campaign ROI", "Funnel", "First vs last touch", "Stale ads"] as const;
type Tab = (typeof TABS)[number];

const dash = (n: number | null, digits = 0) =>
  n === null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AdReportsPage() {
  const [tab, setTab] = useState<Tab>("Leaderboard");
  const [range, setRange] = useState(() => {
    const to = new Date();
    return { from: isoDay(new Date(to.getTime() - 29 * 86_400_000)), to: isoDay(to) };
  });

  const report = useQuery({
    queryKey: ["ad-report", range],
    queryFn: () => getAdReport({ data: range }),
    enabled: range.from <= range.to,
  });
  const data = report.data;

  const exportLeaderboard = () => {
    if (!data) return;
    downloadCsv(
      stringifyCsv([
        ["Ad", "Ad set", "Campaign", "Spend", "Leads", "Site visits", "Bookings", "CPL", "Cost/site visit", "Cost/booking", "Booking value"],
        ...data.leaderboard.map((r) => [
          r.adName, r.adSetName, r.campaignName, r.spend, r.leads, r.siteVisits, r.bookings,
          r.cpl, r.costPerSiteVisit, r.costPerBooking, r.bookingValue,
        ]),
      ]),
      `ad-leaderboard-${range.from}-to-${range.to}.csv`,
    );
  };

  return (
    <AppShell
      title="Ad Reports"
      actions={
        <button
          onClick={exportLeaderboard}
          disabled={!data}
          className="inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Download className="size-4" /> Export leaderboard
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
          <label className="text-sm">
            From{" "}
            <input type="date" value={range.from} max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="ml-1 rounded-lg border border-input bg-background px-2 py-1" />
          </label>
          <label className="text-sm">
            To{" "}
            <input type="date" value={range.to} min={range.from}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="ml-1 rounded-lg border border-input bg-background px-2 py-1" />
          </label>
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1.5">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>

        {report.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {report.isError && <p className="text-sm text-destructive">Couldn't load the report.</p>}
        {data && data.leaderboard.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            No ads synced yet. Connect an ad account and run the ad spend sync to see reports.
          </p>
        )}

        {data && data.leaderboard.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            {tab === "Leaderboard" && (
              <Table head={["Ad", "Spend", "Leads", "Site visits", "Bookings", "CPL", "Cost / booking", "Booking value"]}
                rows={data.leaderboard.map((r) => [r.adName, dash(r.spend), dash(r.leads), dash(r.siteVisits), dash(r.bookings), dash(r.cpl), dash(r.costPerBooking), dash(r.bookingValue)])} />
            )}
            {tab === "Creative" && (
              data.creative.length === 0
                ? <p className="p-6 text-sm text-muted-foreground">No ad set has more than one ad to compare.</p>
                : data.creative.map((s) => (
                    <div key={s.adSetId} className="border-b border-border last:border-0">
                      <p className="px-4 pt-3 text-sm font-semibold">{s.adSetName} <span className="font-normal text-muted-foreground">· {s.campaignName}</span></p>
                      <Table head={["Ad", "Spend", "Leads", "Bookings", "CPL", "Cost / booking"]}
                        rows={s.ads.map((r) => [r.adName, dash(r.spend), dash(r.leads), dash(r.bookings), dash(r.cpl), dash(r.costPerBooking)])} />
                    </div>
                  ))
            )}
            {tab === "Campaign ROI" && (
              <Table head={["Campaign", "Spend", "Booking value", "ROI (x)", "Value by project"]}
                rows={data.roi.map((c) => [c.campaignName, dash(c.spend), dash(c.bookingValue), dash(c.roi, 1),
                  c.byProject.map((p) => `${p.project}: ${dash(p.value)}`).join(", ") || "—"])} />
            )}
            {tab === "Funnel" && (
              <>
                <Table head={["Step", "Count", "Drop-off from previous"]}
                  rows={data.funnel.map((s) => [s.label, dash(s.value), s.dropOffPct === null ? "—" : `${s.dropOffPct.toFixed(0)}%`])} />
                <p className="px-4 pb-3 text-xs text-muted-foreground">
                  Site visits are a lower bound: leads now marked Dropped are not counted.
                </p>
              </>
            )}
            {tab === "First vs last touch" && (
              <Table head={["Ad", "Leads (last touch)", "Leads (first touch)", "Bookings (last)", "Bookings (first)", ""]}
                rows={data.touch.map((r) => [r.adName, dash(r.lastTouchLeads), dash(r.firstTouchLeads), dash(r.lastTouchBookings), dash(r.firstTouchBookings), r.disagrees ? "⚠ disagree" : ""])} />
            )}
            {tab === "Stale ads" && (
              data.stale.length === 0
                ? <p className="p-6 text-sm text-muted-foreground">No stale ads. Every ad that spent in the last 7 days got a lead.</p>
                : <Table head={["Ad", "Ad set", "Campaign"]} rows={data.stale.map((a) => [a.adName, a.adSetName, a.campaignName])} />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full min-w-[640px] border-collapse text-sm">
      <thead>
        <tr className="bg-table-head text-table-head-foreground">
          {head.map((h) => (
            <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/70">
            {r.map((c, j) => (
              <td key={j} className="px-4 py-3 tabular-nums">{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Regenerate the route tree, typecheck, lint, test**

Run: `bun run build` (regenerates `src/routeTree.gen.ts`; if the repo's dev flow regenerates it instead, run `bun run dev` once and stop it).
Run: `bun run typecheck && bun run lint && bun run test`
Expected: all pass. The empty-state branch (`leaderboard.length === 0`) is what an org with no ads sees.

- [ ] **Step 4: Verify in the running app**

Run the app against the local/dev database (never a shared one), sign in, open `/ad-reports`. Check: page loads without error; empty state shows for an org with no ads; with seeded ads the leaderboard is sorted by cost per booking; inverting the date range is prevented by the inputs; Export downloads a CSV. Sign in as a user from a second org and confirm they see none of the first org's ads.

- [ ] **Step 5: Commit and flag for review**

```bash
git add src/routes/ad-reports.tsx src/components/crm/AppShell.tsx src/routeTree.gen.ts
git commit -m "feat: ad reports page with leaderboard, ROI, funnel, touch split, stale ads"
```

PR description must flag: tenancy-adjacent (new read path over `ads`, `ad_daily_stats`, `leads`, `bookings` via `withUserContext`) — needs explicit human review before merge.
