import type { EmailProvider } from "./provider";

/**
 * Stand-in until a real transactional email provider exists. No SDK, no
 * network call — logs and resolves instantly with a fake id. This is the
 * one actually wired up in src/lib/email.server.ts today.
 */
export class MockEmailProvider implements EmailProvider {
  async sendEmail(
    toAddress: string,
    subject: string,
    body: string,
  ): Promise<{ providerMessageId: string }> {
    const providerMessageId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(
      `[MockEmailProvider] sending email to ${toAddress} (${providerMessageId}): ${subject}`,
    );
    return { providerMessageId };
  }
}
