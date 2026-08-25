import type { SmsProvider } from "./provider";

/**
 * Stand-in until a real DLT-registered SMS provider exists. No SDK, no
 * network call — logs and resolves instantly with a fake id. This is the
 * one actually wired up in src/lib/sms.server.ts today.
 */
export class MockSmsProvider implements SmsProvider {
  async sendSms(toNumber: string, body: string): Promise<{ providerMessageId: string }> {
    const providerMessageId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[MockSmsProvider] sending SMS to ${toNumber} (${providerMessageId}): ${body}`);
    return { providerMessageId };
  }
}
