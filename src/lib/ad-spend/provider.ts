/** One (ad, day) of spend/impressions/clicks, as a provider reports it. */
export interface AdDailyStatPoint {
  externalAdId: string;
  /** YYYY-MM-DD, the ad platform's own reporting day. */
  date: string;
  impressions: number;
  clicks: number;
  /** Decimal string — never a float, same reasoning as CostSheet/PaymentMilestone money fields. */
  spend: string;
}

/**
 * Vendor-blocked (issues #27-29): no real Meta Marketing API or Google Ads
 * API account exists yet. This interface is the seam — the real provider
 * call behind a swap-in implementation, so wiring one up later is a single
 * file (and a single import in src/lib/ad-spend.server.ts), same shape as
 * WhatsAppProvider/TelephonyProvider.
 */
export interface AdSpendProvider {
  /** Stats for every externalAdId, for each day in [since, until] inclusive. */
  fetchDailyStats(
    externalAccountId: string,
    externalAdIds: string[],
    since: Date,
    until: Date,
  ): Promise<AdDailyStatPoint[]>;
}
