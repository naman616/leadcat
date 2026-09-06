# 08 — WhatsApp Inbound Webhook + Lead Source Tagging

Status: proposed, not yet built. Same "spec before code" discipline as
`07-meta-lead-ads-webhook.md`, which this slice closely mirrors.

## What's in this slice vs. deferred

**This slice (now):**

- A public HTTP webhook endpoint (`/api/webhooks/whatsapp`) that handles
  the WhatsApp Cloud API's verification handshake (`GET`) and incoming
  message notifications (`POST`), with HMAC signature verification —
  same scheme Meta already uses for Lead Ads, reusing
  `verifyMetaSignature` unmodified.
- Per-org storage of which WhatsApp Business phone-number ID maps to that
  org — a new admin-only-readable table, no admin UI yet, same shape as
  `org_meta_credentials`.
- Find-existing-lead-or-create-new logic keyed by phone number within an
  org: unlike a Meta Lead Ads submission (always a fresh lead per
  `leadgen_id`), a WhatsApp number sends many messages over time, so the
  first inbound message from a number creates a Contact + Lead
  (`source: "WhatsApp"`); every later message from that same number
  attaches to the existing Lead instead of creating a duplicate.
- Idempotency against webhook retries, keyed by WhatsApp's own message id.
- Text messages only. Other WhatsApp message types (image, location,
  button reply, etc.) are logged and skipped, not erroring the batch.

**Explicitly deferred:**

- **Real WhatsApp Cloud API access** — no real WhatsApp Business account
  exists yet (issue #31, same vendor block `WhatsAppProvider` already
  documents). This webhook is receive-only and needs no outbound API call
  to process an inbound message (the Cloud API payload already carries
  the full message body, unlike Meta Lead Ads' `leadgen_id`-only payload)
  — so there's no provider seam to build for this slice; it stays
  entirely on the existing `MockWhatsAppProvider` for outbound sends.
- **Admin UI for configuring the phone-number ID** — backend only this
  slice, same as `setMetaPageCredentials`.
- **Non-text message types** — media/location/button-reply handling.
- **Phone-number-id ownership verification** — see "Known limitation"
  below, same accepted-gap shape as Meta's page-ownership gap.

## Webhook route

Same mechanism as the Meta webhook, for the same reason (no
`createServerFileRoute` API in the installed TanStack Start version):
`src/server.ts`'s existing `fetch` gets one more branch, **inside** the
existing `try` block (same placement fix PR #59's final review already
applied to the Meta branch, for the same reason — nothing before this
branch has its own error handling), matching pathname `/api/webhooks/whatsapp`
and dispatching to a new `handleWhatsAppWebhook(request)` in
`src/lib/whatsapp/webhook-handler.ts`.

- **`GET`** — WhatsApp's subscription verification handshake. Identical
  contract to Meta's (`hub.mode`/`hub.verify_token`/`hub.challenge`),
  checked against a new `WHATSAPP_WEBHOOK_VERIFY_TOKEN` env var.
- **`POST`** — the message notification.
  1. Verify `X-Hub-Signature-256` over the raw body, keyed with a new
     `WHATSAPP_APP_SECRET` env var, via the existing
     `verifyMetaSignature` helper (already generic on `appSecret` —
     WhatsApp Cloud API uses the identical HMAC-SHA256 scheme, so this is
     reuse, not a new implementation). Reject 403 on mismatch.
  2. Parse `entry[].changes[].value` — `metadata.phone_number_id`
     identifies the receiving number; `messages[]` (may be absent — the
     Cloud API also delivers status-update payloads with no `messages`
     key, which are acknowledged 200 and otherwise ignored) each carry
     `id`, `from`, `timestamp`, and `type`; `contacts[].profile.name`
     gives the sender's display name. Only `type: "text"` entries are
     processed this slice; others are logged and skipped.
  3. For each text message: resolve the org for `phone_number_id` (see
     RLS section) and call the new `record_inbound_whatsapp_message` SQL
     function (below) to atomically find-or-create the Lead and insert
     the message row.
  4. Always respond `200 EVENT_RECEIVED` once signature-verified — same
     "never surface as an error, or WhatsApp disables the subscription"
     rule as Meta.
  5. Per-message `try/catch`, same as the Meta handler's per-entry
     isolation — one bad message never sinks the rest of the delivery.

## Multi-tenancy: which org owns this phone number?

A new table, same reasoning as `org_meta_credentials` (kept off
`Organization` because a WhatsApp access-token-shaped credential column
shouldn't be readable by every org member):

```
model OrgWhatsAppCredential {
  orgId                  String   @id @map("org_id") @db.Uuid
  whatsappPhoneNumberId  String   @unique @map("whatsapp_phone_number_id")
  whatsappAccessToken    String   @map("whatsapp_access_token")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@map("org_whatsapp_credentials")
}
```

`whatsappAccessToken` is unused this slice (no real API call is ever
made) but modeled now for the same forward-compat reason
`metaPageAccessToken` was: swapping in the real provider later shouldn't
need a schema change. RLS: `SELECT`/`INSERT`/`UPDATE`/`DELETE` all gated
on `app.is_org_admin(org_id)`, identical to `org_meta_credentials`. Set
via a new `setWhatsAppPhoneCredentials` server function, same shape as
`setMetaPageCredentials` — no UI this slice.

### Known limitation: no phone-number ownership verification (flagged for human review gate)

Same shape as the Meta webhook's accepted page-ownership gap:
`whatsapp_phone_number_id` is globally unique and first-come-first-served
— nothing checks the registering org actually controls that WhatsApp
Business number. The HMAC signature proves a delivery is genuinely from
Meta/WhatsApp and that its `phone_number_id` is unforged; it proves
nothing about who was entitled to register that id. Can't be closed
without a real Graph API ownership check at registration time, blocked
on the same vendor dependency as everything else marked deferred above.
**Same mitigation as the Meta webhook:** not blocking merge, but this
feature must not be enabled for more than one org on a shared deployment
without trusted (non-self-serve) control over who gets credentials set
for which number.

### RLS / anon mechanism — one `SECURITY DEFINER` function, not new table policies

Deliberately **not** the Meta webhook's shape (anon `INSERT` policies on
`contacts`/`leads`, application-code `createMany` calls). This webhook
needs to *read* whether a Contact already exists for a phone number
before deciding whether to create one — doing that from application code
would require an anon `SELECT` policy on `contacts`/`leads` too, widening
what an unauthenticated (signature-verified-only) caller can read. To
avoid that, the whole find-or-create-and-insert sequence lives inside a
single `SECURITY DEFINER` SQL function that bypasses RLS internally
(same mechanism `app.org_id_for_meta_page()` already uses) — so `anon`
gets **zero** new grants on `contacts`/`leads`/`whatsapp_messages` at
all, only `EXECUTE` on this one function:

```sql
CREATE OR REPLACE FUNCTION app.record_inbound_whatsapp_message(
  contact_name TEXT,
  provider_message_id TEXT,
  message_body TEXT,
  captured_at TIMESTAMPTZ
)
RETURNS UUID -- lead_id, or NULL if phone_number_id is unattributable
```

Reads `request.whatsapp_phone_number_id` and `request.whatsapp_from_number`
GUCs (set by `withAnonWhatsAppWebhookContext`, mirroring
`withAnonMetaWebhookContext`) to resolve org + sender internally — no
org id or phone number is ever passed in as a plain argument, closing off
the exact parameter-injection shape PR #59's review already found and
fixed once in `meta_page_access_token_for_org()`.

Internal logic:
1. Resolve `org_id` from `request.whatsapp_phone_number_id` via
   `org_whatsapp_credentials`; return `NULL` if unknown (logged by the
   caller, not this function).
2. If a `whatsapp_messages` row already exists for
   `(org_id, provider_message_id)`, this is a retried delivery — return
   its existing `lead_id` without writing anything else.
3. Else, look up an existing Contact by `(org_id, phone = from_number)`.
   If found, reuse its Lead (the most recently created one, if somehow
   more than one exists — see Open questions). If not found, create a
   new Contact (`full_name: contact_name`) and Lead
   (`source: "WhatsApp"`, `subSource: phone_number_id`,
   `capturedAt: now()`).
4. Insert the `whatsapp_messages` row (`direction: inbound`,
   `status: received`, `body: message_body`, `provider_message_id`,
   `leadId` from step 2/3).
5. Return the `lead_id`.

`withAnonWhatsAppWebhookContext(phoneNumberId, fromNumber, fn)` — new
wrapper in `db.server.ts`, parallel to `withAnonMetaWebhookContext`:
`SET LOCAL ROLE anon` + both GUCs. Called once per inbound message from
`webhook-handler.ts` via a single `tx.$queryRaw` call into the function
above — no other Prisma model calls needed in the handler at all for
this path.

## Data model changes

- `org_whatsapp_credentials` — new table, see above.
- `whatsapp_messages` gains `providerMessageId String? @map("provider_message_id")`
  with `@@unique([orgId, providerMessageId])` — same org-scoped
  idempotency convention as `leads (org_id, platform_lead_id)`.
- `WhatsAppMessageStatus` enum gains a `received` value. The existing
  `queued/sent/delivered/read/failed` values are all outbound-lifecycle
  states; none fit a message the app received rather than sent.
- No `Lead`/`Contact` schema changes — reuses the already-existing,
  already-nullable `source`/`subSource`/`capturedAt` attribution columns
  (same ones `website-lead.server.ts` and the Meta webhook already
  populate with their own channel's values).

## New migration

`prisma/migrations/<timestamp>_whatsapp_inbound_webhook/migration.sql` —
hand-authored, same as every earlier migration in this repo (no network
path to the real Supabase DB from this sandbox). Adds: the
`org_whatsapp_credentials` table (RLS enabled, admin-only
SELECT/INSERT/UPDATE/DELETE), the `provider_message_id` column + its
org-scoped unique index on `whatsapp_messages`, the `received` enum
value, and the `app.record_inbound_whatsapp_message()` `SECURITY DEFINER`
function with `EXECUTE` granted to `anon` (the role this function is
designed for — Postgres also grants `EXECUTE` to `PUBLIC` by default on
function creation, and this migration doesn't `REVOKE` that; closing it
repo-wide across every `SECURITY DEFINER` function here is a separate
future cleanup, not done in this migration). Verified via
`prisma validate` + `db:generate` and a local throwaway Postgres
container — **not** applied to the real Mumbai Supabase DB by this
session; needs the same explicit `prisma migrate deploy` sign-off as
every other migration.

## New env vars

Added to `.env.example`:

```
WHATSAPP_APP_SECRET="<meta-app-secret-for-the-whatsapp-app>"
WHATSAPP_WEBHOOK_VERIFY_TOKEN="<any-string-you-choose-and-enter-in-meta-app-dashboard>"
```

Kept separate from `META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN` rather
than reused — a WhatsApp Business Account and a Lead Ads Page aren't
guaranteed to sit under the same Meta App, and coupling their secrets
would make rotating one silently break the other.

## Testing plan

- New `tests/whatsapp-inbound-webhook.test.ts`, DB-touching (same shape
  as `tests/meta-lead-ads-webhook-handler.test.ts`):
  - Valid signature + known `phone_number_id`, first message from a
    number → creates Contact + Lead with `source: "WhatsApp"`.
  - A second message from the same number → attaches to the same Lead,
    no duplicate Contact/Lead.
  - A retried delivery (same `provider_message_id`) → no-op, returns the
    same `lead_id`, doesn't create a second `whatsapp_messages` row.
  - Unknown `phone_number_id` → 200, nothing written.
  - Missing/invalid signature → 403, nothing written.
  - Non-text message type → skipped, doesn't error the batch, doesn't
    block sibling text messages in the same delivery.
- `GET` verification handshake: correct token echoes `hub.challenge`;
  wrong token 403s.
- Signature verification itself needs no new tests — reusing
  `verifyMetaSignature` as-is, already covered by
  `tests/meta-lead-ads-verify-signature.test.ts`.
- `org_whatsapp_credentials` cross-org admin-write isolation test, same
  as the equivalent `org_meta_credentials` test added in PR #59's final
  review.

## Open questions for you

- Step 3 above says "reuse the most recently created Lead" if a phone
  number somehow already has more than one (shouldn't normally happen
  through this webhook alone, but could via manual lead creation with a
  matching phone, or a future merge). Is "most recent" the right tie
  breaker, or should an inbound WhatsApp message from a number with
  multiple existing Leads attach to none automatically and instead
  surface for manual triage? Went with "most recent" as the pragmatic
  default; flagging since it's a real product decision, not just an
  implementation detail.
- Should `contact_name` from WhatsApp's `contacts[].profile.name`
  overwrite an existing Contact's `full_name` on a later message (e.g. if
  they changed their WhatsApp display name), or is name only ever set at
  Contact-creation time, same as `source` is only ever set at
  Lead-creation time? Went with **never overwrite** (first-touch, same
  as source) for consistency; flagging in case you'd rather keep it
  fresh.
