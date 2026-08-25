/**
 * Vendor-blocked (issues #32/#33): no DLT-registered SMS provider exists
 * yet (needs India TRAI DLT registration first). This interface is the
 * seam — the real provider call behind a swap-in implementation, so wiring
 * one up later is a single file (and a single import in
 * src/lib/sms.server.ts), not a rewrite.
 */
export interface SmsProvider {
  sendSms(toNumber: string, body: string): Promise<{ providerMessageId: string }>;
}
