import type { WhatsAppProvider } from "./provider";

/**
 * Stand-in until a real WhatsApp Business API account exists. No SDK, no
 * network call — logs and resolves instantly with a fake id. This is the
 * one actually wired up in src/lib/whatsapp.server.ts today.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  async sendMessage(toNumber: string, body: string): Promise<{ providerMessageId: string }> {
    const providerMessageId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[MockWhatsAppProvider] sending to ${toNumber} (${providerMessageId}): ${body}`);
    return { providerMessageId };
  }
}
