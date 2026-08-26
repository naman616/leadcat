/**
 * Vendor-blocked (issue #24): no real Meta Graph API access exists yet.
 * This interface is the seam — the real call
 * (`GET /{leadgen-id}?access_token=...`) behind a swap-in implementation,
 * so wiring one up later is a single file (and a single import in
 * src/lib/meta-lead-ads/webhook-handler.ts), not a rewrite.
 */
export interface MetaLeadAdsProvider {
  fetchLeadFields(
    leadgenId: string,
    pageAccessToken: string,
  ): Promise<{ fullName: string; phone: string | null; email: string | null }>;
}
