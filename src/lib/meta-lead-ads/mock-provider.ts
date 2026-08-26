import type { MetaLeadAdsProvider } from "./provider";

/**
 * Stand-in until a real Meta Graph API access token exists. No network
 * call — logs and resolves instantly with deterministic fake field data,
 * keyed off leadgenId. This is the one actually wired up in
 * src/lib/meta-lead-ads/webhook-handler.ts today.
 */
export class MockMetaLeadAdsProvider implements MetaLeadAdsProvider {
  async fetchLeadFields(
    leadgenId: string,
    pageAccessToken: string,
  ): Promise<{ fullName: string; phone: string | null; email: string | null }> {
    console.log(
      `[MockMetaLeadAdsProvider] fetching fields for leadgen ${leadgenId} ` +
        `(token ${pageAccessToken.slice(0, 6)}...)`,
    );
    return {
      fullName: `Mock Meta Lead ${leadgenId.slice(0, 8)}`,
      phone: "9999999999",
      email: null,
    };
  }
}
