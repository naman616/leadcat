import { withAnonWhatsAppWebhookContext } from "../db.server";
import { verifyMetaSignature } from "../meta-lead-ads/verify-signature";

interface WhatsAppInboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppMessagesChangeValue {
  metadata: { phone_number_id: string };
  contacts?: Array<{ profile?: { name?: string } }>;
  messages?: WhatsAppInboundMessage[];
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: unknown }>;
  }>;
}

function isMessagesChangeValue(value: unknown): value is WhatsAppMessagesChangeValue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const metadata = v["metadata"];
  if (typeof metadata !== "object" || metadata === null) return false;
  return typeof (metadata as Record<string, unknown>)["phone_number_id"] === "string";
}

/** GET — WhatsApp Cloud API's subscription verification handshake, same contract as Meta's. */
function handleVerificationRequest(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"];
  if (mode === "subscribe" && expectedToken && token === expectedToken && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Processes one "messages" change value: for each text message, calls
 * app.record_inbound_whatsapp_message via withAnonWhatsAppWebhookContext.
 * Non-text messages are logged and skipped without touching the DB. Each
 * message is isolated in its own try/catch — one failing message never
 * blocks its siblings in the same delivery.
 */
async function processMessagesChange(value: WhatsAppMessagesChangeValue): Promise<void> {
  const phoneNumberId = value.metadata.phone_number_id;
  const contactName = value.contacts?.[0]?.profile?.name;

  for (const message of value.messages ?? []) {
    if (message.type !== "text" || !message.text) {
      console.error(`[whatsapp webhook] skipping unsupported message type: ${message.type}`);
      continue;
    }

    try {
      const capturedAt = new Date(Number(message.timestamp) * 1000);
      await withAnonWhatsAppWebhookContext(
        phoneNumberId,
        message.from,
        (tx) =>
          tx.$queryRaw<{ lead_id: string | null }[]>`
          SELECT app.record_inbound_whatsapp_message(
            ${contactName ?? message.from}, ${message.id}, ${message.text!.body}, ${capturedAt}
          ) AS lead_id
        `,
      );
    } catch (error) {
      console.error(`[whatsapp webhook] failed to process message ${message.id}:`, error);
    }
  }
}

/** POST — message notifications. Always 200s once signature-verified, even for entries it can't attribute. */
async function handleMessageNotification(request: Request): Promise<Response> {
  const rawBody = await request.text();

  const appSecret = process.env["WHATSAPP_APP_SECRET"];
  if (!appSecret) {
    console.error("[whatsapp webhook] WHATSAPP_APP_SECRET is not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
    return new Response("Invalid signature", { status: 403 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !isMessagesChangeValue(change.value)) continue;
      await processMessagesChange(change.value);
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

/** Entry point wired up from src/server.ts — routes GET (verification) and POST (message notifications). */
export async function handleWhatsAppWebhook(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") return handleVerificationRequest(url);
  if (request.method === "POST") return handleMessageNotification(request);
  return new Response("Method Not Allowed", { status: 405 });
}
