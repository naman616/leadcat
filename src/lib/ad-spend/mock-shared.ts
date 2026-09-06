import type { AdDailyStatPoint } from "./provider";

/** Every date string in [since, until] inclusive, as YYYY-MM-DD. */
function eachDate(since: Date, until: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(
    Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()),
  );
  const end = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()));
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// ponytail: deterministic pseudo-random, not real vendor data. Seeded by
// (externalAdId, date) so repeated syncs are idempotent instead of
// generating new numbers every call, which is what actually matters for a
// mock standing in for a real API that would return the same historical
// day's numbers on every call too.
function seededInt(seed: string, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % max;
}

/** Shared mock data generator — MockMetaMarketingProvider/MockGoogleAdsProvider both use this. */
export function mockDailyStats(
  externalAdIds: string[],
  since: Date,
  until: Date,
): AdDailyStatPoint[] {
  const dates = eachDate(since, until);
  const points: AdDailyStatPoint[] = [];
  for (const externalAdId of externalAdIds) {
    for (const date of dates) {
      const seed = `${externalAdId}:${date}`;
      const impressions = 500 + seededInt(seed, 4500);
      const clicks = Math.round(impressions * (0.01 + seededInt(seed + "c", 5) / 100));
      const spend = (clicks * (5 + seededInt(seed + "s", 20))).toFixed(2);
      points.push({ externalAdId, date, impressions, clicks, spend });
    }
  }
  return points;
}
