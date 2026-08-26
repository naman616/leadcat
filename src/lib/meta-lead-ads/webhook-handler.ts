import { randomUUID } from "node:crypto";
import { withAnonMetaWebhookContext } from "../db.server";
import { MockMetaLeadAdsProvider } from "./mock-provider";
import type { MetaLeadAdsProvider } from "./provider";
import { verifyMetaSignature } from "./verify-signature";

// The one line to change when real Meta Graph API access exists (issue
// #24) — everything below depends only on MetaLeadAdsProvider.
const metaLeadAdsProvider: MetaLeadAdsProvider = new MockMetaLeadAdsProvider();

interface MetaLeadgenChangeValue {
  page_id: string;
  leadgen_id: string;
  form_id: string;
  campaign_id?: string;
  adgroup_id?: string;
  ad_id?: string;
}

interface MetaWebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: unknown }>;
  }>;
}

function isLeadgenChangeValue(value: unknown): value is MetaLeadgenChangeValue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["page_id"] === "string" &&
    typeof v["leadgen_id"] === "string" &&
    typeof v["form_id"] === "string"
  );
}

/** GET — Meta's subscription verification handshake. */
function handleVerificationRequest(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env["META_WEBHOOK_VERIFY_TOKEN"];
  if (mode === "subscribe" && expectedToken && token === expectedToken && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Resolves org + credentials for one leadgen change, fetches field data, writes Contact + Lead. */
async function processLeadgenChange(value: MetaLeadgenChangeValue): Promise<void> {
  await withAnonMetaWebhookContext(value.page_id, async (tx) => {
    const [orgRow] = await tx.$queryRaw<{ id: string | null }[]>`
      SELECT app.org_id_for_meta_page() AS id
    `;
    const orgId = orgRow?.id;

    if (!orgId) {
      // Unknown page_id — logged, not thrown. Meta disables a subscription
      // after repeated non-200 responses, so this must never surface as an
      // error to the caller. See docs/specs/07-meta-lead-ads-webhook.md.
      console.error(`[meta-leads webhook] unknown page_id: ${value.page_id}`);
      return;
    }

    const [tokenRow] = await tx.$queryRaw<{ token: string | null }[]>`
      SELECT app.meta_page_access_token_for_org() AS token
    `;
    const pageAccessToken = tokenRow?.token;
    if (!pageAccessToken) {
      console.error(`[meta-leads webhook] org ${orgId} has no page access token configured`);
      return;
    }

    const fields = await metaLeadAdsProvider.fetchLeadFields(value.leadgen_id, pageAccessToken);

    const contactId = randomUUID();
    const leadId = randomUUID();

    await tx.contact.createMany({
      data: [
        {
          id: contactId,
          orgId,
          fullName: fields.fullName,
          phone: fields.phone,
          email: fields.email ? fields.email.toLowerCase() : null,
        },
      ],
    });

    // Meta's campaign_id/adgroup_id/ad_id are large numeric strings, not
    // UUIDs — Lead.campaignId/adSetId/adId are @db.Uuid columns reserved
    // for this app's own ad_hierarchy row ids (see docs/specs/07-...), so
    // those stay unset here and the raw values go into rawPayload instead.
    await tx.lead.createMany({
      data: [
        {
          id: leadId,
          orgId,
          contactId,
          source: "Meta Lead Ads",
          subSource: value.page_id,
          formId: value.form_id,
          platformLeadId: value.leadgen_id,
          capturedAt: new Date(),
          rawPayload: {
            page_id: value.page_id,
            leadgen_id: value.leadgen_id,
            form_id: value.form_id,
            campaign_id: value.campaign_id ?? null,
            adgroup_id: value.adgroup_id ?? null,
            ad_id: value.ad_id ?? null,
          },
        },
      ],
      skipDuplicates: true, // idempotent against Meta's webhook retries.
    });
  });
}

/** POST — the lead notification. Always 200s once signature-verified, even for entries it can't attribute. */
async function handleLeadNotification(request: Request): Promise<Response> {
  const rawBody = await request.text();

  const appSecret = process.env["META_APP_SECRET"];
  if (!appSecret) {
    console.error("[meta-leads webhook] META_APP_SECRET is not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
    return new Response("Invalid signature", { status: 403 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen" || !isLeadgenChangeValue(change.value)) continue;
      await processLeadgenChange(change.value);
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

/** Entry point wired up from src/server.ts — routes GET (verification) and POST (lead notifications). */
export async function handleMetaLeadsWebhook(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") return handleVerificationRequest(url);
  if (request.method === "POST") return handleLeadNotification(request);
  return new Response("Method Not Allowed", { status: 405 });
}
