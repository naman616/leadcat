import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "../src/lib/meta-lead-ads/verify-signature";

const SECRET = "test-app-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyMetaSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ entry: [] });
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ entry: [] });
    const signature = sign(body);
    const tampered = JSON.stringify({ entry: ["injected"] });
    expect(verifyMetaSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = JSON.stringify({ entry: [] });
    expect(verifyMetaSignature(body, sign(body, "wrong-secret"), SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyMetaSignature("{}", null, SECRET)).toBe(false);
  });

  it("rejects a malformed signature header (no sha256= prefix)", () => {
    expect(verifyMetaSignature("{}", "not-a-valid-header", SECRET)).toBe(false);
  });

  it("rejects a well-formed but short/malformed hex signature without throwing", () => {
    const body = JSON.stringify({ entry: [] });
    expect(verifyMetaSignature(body, "sha256=abcd", SECRET)).toBe(false);
  });
});
