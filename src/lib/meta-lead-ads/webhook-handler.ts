import { createHash } from "node:crypto";
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

/**
 * Deterministic UUID-shaped id derived from a composite key — RULING
 * (task 4 review round 1, extended in final whole-branch review): using
 * randomUUID() meant a retried webhook delivery for the same leadgen_id
 * got a fresh Contact row every time (skipDuplicates on the Lead insert
 * only protects the Lead row). Deriving ids from `${orgId}:${leadgenId}`
 * (not leadgen_id alone) makes a retry produce the exact same row ids as
 * the original delivery — skipDuplicates on both inserts now makes the
 * whole write genuinely idempotent — and scopes the derivation by org so
 * two different orgs can never collide on the same generated ids even in
 * the (currently unreachable, since Meta's leadgen_id is globally
 * unique) case of both receiving the same leadgen_id. Exported for its
 * own direct test — pure function, no DB dependency. SHA-256 formatted
 * into UUID shape — no new dependency, stdlib only.
 */
export function deterministicIdFor(key: string, salt: string): string {
  const hash = createHash("sha256").update(`${salt}:${key}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
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

/** Resolves org + Page access token for one leadgen change's page_id, or null if unattributable. */
async function resolveOrgAndToken(
  pageId: string,
): Promise<{ orgId: string; pageAccessToken: string } | null> {
  return withAnonMetaWebhookContext(pageId, async (tx) => {
    const [orgRow] = await tx.$queryRaw<{ id: string | null }[]>`
      SELECT app.org_id_for_meta_page() AS id
    `;
    const orgId = orgRow?.id;

    if (!orgId) {
      // Unknown page_id — logged, not thrown. Meta disables a subscription
      // after repeated non-200 responses, so this must never surface as an
      // error to the caller. See docs/specs/07-meta-lead-ads-webhook.md.
      console.error(`[meta-leads webhook] unknown page_id: ${pageId}`);
      return null;
    }

    const [tokenRow] = await tx.$queryRaw<{ token: string | null }[]>`
      SELECT app.meta_page_access_token_for_org() AS token
    `;
    const pageAccessToken = tokenRow?.token;
    if (!pageAccessToken) {
      console.error(`[meta-leads webhook] org ${orgId} has no page access token configured`);
      return null;
    }

    return { orgId, pageAccessToken };
  });
}

/**
 * Resolves org + credentials for one leadgen change, fetches field data,
 * writes Contact + Lead. Deliberately two separate
 * withAnonMetaWebhookContext calls, not one — RULING (final whole-branch
 * review): the Graph API call must not run inside an open DB transaction
 * (holding a pooled/pgbouncer connection across a real network round
 * trip risks the connection exhaustion CLAUDE.md calls out by name). The
 * deterministic ids above make this two-phase split safe against a retry
 * landing between the two transactions.
 */
async function processLeadgenChange(value: MetaLeadgenChangeValue): Promise<void> {
  const resolved = await resolveOrgAndToken(value.page_id);
  if (!resolved) return;
  const { orgId, pageAccessToken } = resolved;

  const fields = await metaLeadAdsProvider.fetchLeadFields(value.leadgen_id, pageAccessToken);

  const contactId = deterministicIdFor(`${orgId}:${value.leadgen_id}`, "contact");
  const leadId = deterministicIdFor(`${orgId}:${value.leadgen_id}`, "lead");

  await withAnonMetaWebhookContext(value.page_id, async (tx) => {
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
      skipDuplicates: true, // idempotent against Meta's webhook retries, same reason as the Lead insert below.
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
      try {
        await processLeadgenChange(change.value);
      } catch (error) {
        // RULING (task 4 review round 1): one failing entry in a batch
        // must not sink the whole delivery's 200 response — Meta disables
        // a subscription after repeated non-200/timeout responses, and an
        // uncaught throw here would abort every remaining entry/change in
        // this same payload too, not just the one that failed.
        console.error(`[meta-leads webhook] failed to process leadgen change:`, error);
      }
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
