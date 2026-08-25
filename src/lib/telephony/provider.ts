/**
 * Vendor-blocked (issue #30): no real telephony account (Exotel/Knowlarity/
 * Twilio) exists yet. This interface is the seam — the real provider call
 * behind a swap-in implementation, so wiring one up later is a single file
 * (and a single import in src/lib/telephony.server.ts), not a rewrite.
 */
export interface TelephonyProvider {
  initiateCall(fromNumber: string, toNumber: string): Promise<{ providerCallId: string }>;
}
