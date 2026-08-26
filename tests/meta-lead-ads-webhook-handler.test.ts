import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleMetaLeadsWebhook } from "../src/lib/meta-lead-ads/webhook-handler";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

describe("handleMetaLeadsWebhook", () => {
  const originalAppSecret = process.env["META_APP_SECRET"];
  const originalVerifyToken = process.env["META_WEBHOOK_VERIFY_TOKEN"];

  beforeEach(() => {
    process.env["META_APP_SECRET"] = APP_SECRET;
    process.env["META_WEBHOOK_VERIFY_TOKEN"] = VERIFY_TOKEN;
  });

  afterEach(() => {
    process.env["META_APP_SECRET"] = originalAppSecret;
    process.env["META_WEBHOOK_VERIFY_TOKEN"] = originalVerifyToken;
  });

  it("GET with the correct verify token echoes hub.challenge", async () => {
    const url =
      `http://localhost/api/webhooks/meta-leads?hub.mode=subscribe` +
      `&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=echo-me`;
    const response = await handleMetaLeadsWebhook(new Request(url, { method: "GET" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("echo-me");
  });

  it("GET with the wrong verify token is rejected", async () => {
    const url =
      `http://localhost/api/webhooks/meta-leads?hub.mode=subscribe` +
      `&hub.verify_token=wrong&hub.challenge=echo-me`;
    const response = await handleMetaLeadsWebhook(new Request(url, { method: "GET" }));
    expect(response.status).toBe(403);
  });

  it("POST with a missing signature is rejected before touching the payload", async () => {
    const response = await handleMetaLeadsWebhook(
      new Request("http://localhost/api/webhooks/meta-leads", {
        method: "POST",
        body: JSON.stringify({ entry: [] }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("POST with a tampered signature is rejected", async () => {
    const body = JSON.stringify({ entry: [] });
    const response = await handleMetaLeadsWebhook(
      new Request("http://localhost/api/webhooks/meta-leads", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body: JSON.stringify({ entry: ["tampered after signing"] }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("POST with a valid signature but malformed JSON returns 400", async () => {
    const body = "{not valid json";
    const response = await handleMetaLeadsWebhook(
      new Request("http://localhost/api/webhooks/meta-leads", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    expect(response.status).toBe(400);
  });

  it("POST with a valid signature and an empty entry list returns 200", async () => {
    const body = JSON.stringify({ entry: [] });
    const response = await handleMetaLeadsWebhook(
      new Request("http://localhost/api/webhooks/meta-leads", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("EVENT_RECEIVED");
  });

  it("POST with a non-leadgen change is skipped, still returns 200", async () => {
    const body = JSON.stringify({
      entry: [{ id: "some-page", changes: [{ field: "some_other_field", value: {} }] }],
    });
    const response = await handleMetaLeadsWebhook(
      new Request("http://localhost/api/webhooks/meta-leads", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("unsupported methods return 405", async () => {
    const response = await handleMetaLeadsWebhook(
      new Request("http://localhost/api/webhooks/meta-leads", { method: "DELETE" }),
    );
    expect(response.status).toBe(405);
  });
});
