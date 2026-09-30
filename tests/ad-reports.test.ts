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
