import type { AdSpendProvider, AdDailyStatPoint } from "./provider";
import { mockDailyStats } from "./mock-shared";

/**
 * Stand-in until a real Google Ads API account exists (issue #28). No SDK,
 * no network call — same "logs and returns instantly" shape as
 * MockWhatsAppProvider/MockTelephonyProvider.
 */
export class MockGoogleAdsProvider implements AdSpendProvider {
  async fetchDailyStats(
    externalAccountId: string,
    externalAdIds: string[],
    since: Date,
    until: Date,
  ): Promise<AdDailyStatPoint[]> {
    console.log(
      `[MockGoogleAdsProvider] fetching ${externalAdIds.length} ad(s) for account ${externalAccountId}`,
    );
    return mockDailyStats(externalAdIds, since, until);
  }
}
