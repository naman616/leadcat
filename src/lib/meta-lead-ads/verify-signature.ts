import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Meta's X-Hub-Signature-256 header: HMAC-SHA256 of the raw
 * request body, keyed with the app secret, hex-encoded and prefixed
 * "sha256=" (Meta's documented format). This is what proves a webhook
 * request actually came from Meta — see
 * docs/specs/07-meta-lead-ads-webhook.md.
 *
 * Takes the raw body string (not parsed JSON) — signature verification
 * must happen over the exact bytes Meta signed, before any JSON.parse.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");

  // Different lengths would make timingSafeEqual throw rather than return
  // false — reject up front instead of catching.
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
