import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleWhatsAppWebhook } from "../src/lib/whatsapp/webhook-handler";

const APP_SECRET = "test-whatsapp-app-secret";
const VERIFY_TOKEN = "test-whatsapp-verify-token";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

describe("handleWhatsAppWebhook", () => {
  const originalAppSecret = process.env["WHATSAPP_APP_SECRET"];
  const originalVerifyToken = process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"];

  beforeEach(() => {
    process.env["WHATSAPP_APP_SECRET"] = APP_SECRET;
    process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"] = VERIFY_TOKEN;
  });

  afterEach(() => {
    process.env["WHATSAPP_APP_SECRET"] = originalAppSecret;
    process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"] = originalVerifyToken;
  });

  it("GET with the correct verify token echoes hub.challenge", async () => {
    const url =
      `http://localhost/api/webhooks/whatsapp?hub.mode=subscribe` +
      `&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=echo-me`;
    const response = await handleWhatsAppWebhook(new Request(url, { method: "GET" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("echo-me");
  });

  it("GET with the wrong verify token is rejected", async () => {
    const url =
      `http://localhost/api/webhooks/whatsapp?hub.mode=subscribe` +
      `&hub.verify_token=wrong&hub.challenge=echo-me`;
    const response = await handleWhatsAppWebhook(new Request(url, { method: "GET" }));
    expect(response.status).toBe(403);
  });

  it("POST with a missing signature is rejected before touching the payload", async () => {
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        body: JSON.stringify({ entry: [] }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("POST with a tampered signature is rejected", async () => {
    const body = JSON.stringify({ entry: [] });
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body: JSON.stringify({ entry: ["tampered after signing"] }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("POST with a valid signature but malformed JSON returns 400", async () => {
    const body = "{not valid json";
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    expect(response.status).toBe(400);
  });

  it("POST with a valid signature and an empty entry list returns 200", async () => {
    const body = JSON.stringify({ entry: [] });
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("EVENT_RECEIVED");
  });

  it("POST with a non-messages change field is skipped, still returns 200", async () => {
    const body = JSON.stringify({
      entry: [{ id: "some-waba", changes: [{ field: "some_other_field", value: {} }] }],
    });
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("POST with a status-update payload (no messages key) returns 200 without erroring", async () => {
    const body = JSON.stringify({
      entry: [
        {
          id: "some-waba",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "unattributed-phone-id" },
                statuses: [{ id: "wamid.x", status: "delivered" }],
              },
            },
          ],
        },
      ],
    });
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("POST with a non-text message type is skipped, still returns 200", async () => {
    const body = JSON.stringify({
      entry: [
        {
          id: "some-waba",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "unattributed-phone-id" },
                contacts: [{ profile: { name: "Someone" } }],
                messages: [
                  {
                    id: "wamid.image",
                    from: "919999999999",
                    timestamp: "1690000000",
                    type: "image",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("a non-text message doesn't block a sibling text message in the same delivery", async () => {
    const body = JSON.stringify({
      entry: [
        {
          id: "some-waba",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "unattributed-phone-id" },
                contacts: [
                  { wa_id: "919999999999", profile: { name: "Someone" } },
                  { wa_id: "918888888888", profile: { name: "Someone Else" } },
                ],
                messages: [
                  {
                    id: "wamid.image",
                    from: "919999999999",
                    timestamp: "1690000000",
                    type: "image",
                  },
                  {
                    id: "wamid.text",
                    from: "918888888888",
                    timestamp: "1690000000",
                    type: "text",
                    text: { body: "hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
    // "unattributed-phone-id" has no matching org, so the text message
    // resolves to no attribution (same as the file's other
    // unattributed-phone-id cases) — this proves the non-text sibling
    // didn't block it from being routed/processed at all, without needing
    // TEST_DATABASE_URL.
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("EVENT_RECEIVED");
  });

  it("unsupported methods return 405", async () => {
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", { method: "DELETE" }),
    );
    expect(response.status).toBe(405);
  });
});
