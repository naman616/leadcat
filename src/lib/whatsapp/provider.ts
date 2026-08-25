/**
 * Vendor-blocked (issue #31): no real WhatsApp Business API account exists
 * yet. This interface is the seam — the real provider call behind a
 * swap-in implementation, so wiring one up later is a single file (and a
 * single import in src/lib/whatsapp.server.ts), not a rewrite.
 */
export interface WhatsAppProvider {
  sendMessage(toNumber: string, body: string): Promise<{ providerMessageId: string }>;
}
