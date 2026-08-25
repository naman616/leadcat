import type { TelephonyProvider } from "./provider";

/**
 * Stand-in until a real telephony account exists. No SDK, no network call —
 * logs and resolves instantly with a fake id. This is the one actually
 * wired up in src/lib/telephony.server.ts today.
 */
export class MockTelephonyProvider implements TelephonyProvider {
  async initiateCall(fromNumber: string, toNumber: string): Promise<{ providerCallId: string }> {
    const providerCallId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[MockTelephonyProvider] initiating call ${fromNumber} -> ${toNumber} (${providerCallId})`);
    return { providerCallId };
  }
}
