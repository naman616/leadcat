/**
 * Vendor-blocked (issues #32/#33): no transactional email provider account
 * exists yet. This interface is the seam — the real provider call behind a
 * swap-in implementation, so wiring one up later is a single file (and a
 * single import in src/lib/email.server.ts), not a rewrite.
 */
export interface EmailProvider {
  sendEmail(
    toAddress: string,
    subject: string,
    body: string,
  ): Promise<{ providerMessageId: string }>;
}
