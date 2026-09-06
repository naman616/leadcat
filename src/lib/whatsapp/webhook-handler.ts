import { withAnonWhatsAppWebhookContext } from "../db.server";
import { verifyMetaSignature } from "../meta-lead-ads/verify-signature";
import { whatsappProvider } from "../whatsapp.server";

// ponytail: one hardcoded reply for every org, no per-org template
// selection. Add a WhatsAppTemplate "is_default" flag + admin UI to pick
// one when orgs need to customize this.
const AUTO_FIRST_RESPONSE_BODY = "Thanks for reaching out! Our team will get back to you shortly.";

interface WhatsAppInboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppMessagesChangeValue {
  metadata: { phone_number_id: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
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
 * Sends the auto-first-response via WhatsAppProvider, then records it as an
 * outbound whatsapp_messages row via app.record_whatsapp_autoresponse_sent.
 * Failure here (provider error, DB error) is logged and swallowed — the
 * inbound message was already recorded successfully by the caller, so this
 * is a best-effort follow-up, not something that should mark the inbound
 * delivery as failed.
 */
async function sendAutoFirstResponse(
  phoneNumberId: string,
  fromNumber: string,
  leadId: string,
): Promise<void> {
  try {
    const { providerMessageId } = await whatsappProvider.sendMessage(
      fromNumber,
      AUTO_FIRST_RESPONSE_BODY,
    );
    await withAnonWhatsAppWebhookContext(
      phoneNumberId,
      fromNumber,
      (tx) =>
        tx.$executeRaw`SELECT app.record_whatsapp_autoresponse_sent(
        ${leadId}::uuid, ${AUTO_FIRST_RESPONSE_BODY}, ${providerMessageId}
      )`,
    );
  } catch (error) {
    console.error(`[whatsapp webhook] auto-first-response failed for lead ${leadId}:`, error);
  }
}

/**
 * Processes one "messages" change value: for each text message, calls
 * app.record_inbound_whatsapp_message via withAnonWhatsAppWebhookContext.
 * Non-text messages are logged and skipped without touching the DB. Each
 * message is isolated in its own try/catch — one failing message never
 * blocks its siblings in the same delivery. The first message from a new
 * number (is_new_lead) triggers a fire-and-forget auto-first-response.
 */
async function processMessagesChange(value: WhatsAppMessagesChangeValue): Promise<void> {
  const phoneNumberId = value.metadata.phone_number_id;

  for (const message of value.messages ?? []) {
    if (message.type !== "text" || !message.text) {
      console.error(`[whatsapp webhook] skipping unsupported message type: ${message.type}`);
      continue;
    }

    try {
      // Match the contacts[] entry by wa_id, not index 0 — a batch can
      // carry messages from multiple senders, and contacts[0] would stamp
      // the first sender's name onto every new Contact in the batch.
      const contactName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name;
      const timestampMs = Number(message.timestamp) * 1000;
      const capturedAt = Number.isFinite(timestampMs) ? new Date(timestampMs) : new Date();
      const [row] = await withAnonWhatsAppWebhookContext(
        phoneNumberId,
        message.from,
        (tx) =>
          tx.$queryRaw<{ lead_id: string | null; is_new_lead: boolean }[]>`
          SELECT lead_id, is_new_lead FROM app.record_inbound_whatsapp_message(
            ${contactName || message.from}, ${message.id}, ${message.text!.body}, ${capturedAt}
          )
        `,
      );
      if (!row?.lead_id) {
        console.error(
          `[whatsapp webhook] unattributable phone_number_id: ${phoneNumberId} (message ${message.id})`,
        );
        continue;
      }
      if (row.is_new_lead) {
        await sendAutoFirstResponse(phoneNumberId, message.from, row.lead_id);
      }
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
      try {
        await processMessagesChange(change.value);
      } catch (error) {
        // isMessagesChangeValue only validates metadata.phone_number_id, not
        // messages — a structurally malformed messages[] (e.g. not an array)
        // would otherwise throw here and propagate to a 500, violating the
        // "always 200 once signature-verified" rule. Same pattern as the
        // Meta webhook's entry-loop catch around processLeadgenChange.
        console.error(`[whatsapp webhook] failed to process messages change:`, error);
      }
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
