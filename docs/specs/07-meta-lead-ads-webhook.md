# 07 — Meta Lead Ads Webhook

Status: proposed, not yet built. Same "spec before code" discipline as the
earlier docs. Corresponds to GitHub issue #24.

## What's in this slice vs. deferred

**This slice (now):**

- A public HTTP webhook endpoint (`/api/webhooks/meta-leads`) that handles
  Meta's verification handshake (`GET`) and incoming lead notifications
  (`POST`), with HMAC signature verification.
- Per-org storage of which Facebook Page maps to that org, and that page's
  access token — columns only, no admin UI (per your call).
- A `MetaLeadAdsProvider` interface + `MockMetaLeadAdsProvider` (no real
  Graph API call yet — same "build now, wire real credentials later"
  pattern as `WhatsAppProvider`/`SmsProvider`/`EmailProvider`/telephony).
- Contact + Lead creation from the (mocked) fetched field data, idempotent
  against Meta's webhook retries.

**Explicitly deferred:**

- **Real Graph API call** — `MockMetaLeadAdsProvider` returns fake field
  data for any `leadgenId`. Swapping in the real
  `GET /{leadgen-id}?access_token=...` call is a single file
  (`src/lib/meta-lead-ads/provider.ts`) plus the one line that constructs
  it in `meta-leads.server.ts`, once a real Meta App + Page + long-lived
  Page access token exist.
- **Admin UI for configuring the Page ID / access token** — backend only
  this slice (an admin-only server function), per your answer. An org
  admin without direct DB/API access can't self-serve this yet.
- **Linking into the `ad_accounts`/`campaigns`/`ad_sets`/`ads` hierarchy
  from `05-ad-attribution.md`** — per your answer, raw external IDs only.
  See "Attribution fields" below for exactly where those land, including a
  type mismatch this surfaced.
- **Real Meta App review/setup** (App Review, webhook subscription,
  Page linking in Meta Business Suite) — that's an operational step on
  Meta's side, not code. The endpoint and verification logic can be built
  and unit-tested now; full end-to-end delivery can't be confirmed without
  it.

## Webhook route

New file: `src/routes/api/webhooks/meta-leads.ts`, using TanStack Start's
file-based **server route** (`createServerFileRoute` — raw `Request`/
`Response`, not `createServerFn`). This is the first raw API route in the
app; every other public-facing entry point so far (`website-lead.server.ts`)
is a `createServerFn` called from the app's own generated RPC client, which
can't handle Meta's plain-JSON POST or its query-param `GET` handshake.

- **`GET`** — Meta's subscription verification handshake. Compares the
  `hub.verify_token` query param against `process.env.META_WEBHOOK_VERIFY_TOKEN`;
  if it matches, echoes back `hub.challenge` as the response body (per
  Meta's documented contract); otherwise 403.
- **`POST`** — the lead notification.
  1. Verify `X-Hub-Signature-256` header: HMAC-SHA256 of the raw request
     body, keyed with `process.env.META_APP_SECRET`, constant-time-compared
     against the header. Reject with 403 on mismatch — this is what proves
     the request actually came from Meta, replacing the need for a
     per-org secret token the way `public_form_token` provides for the
     website form.
  2. Parse the payload's `entry[].changes[].value` — each entry contains
     `page_id`, `leadgen_id`, `form_id`, `campaign_id`, `adgroup_id` (Meta's
     name for ad set), `ad_id`, `created_time`.
  3. For each change: look up the org for that `page_id` (see RLS section),
     call `MetaLeadAdsProvider.fetchLeadFields(leadgenId, pageAccessToken)`
     to get the actual field data (name/phone/email — Meta's webhook payload
     itself only carries IDs, never the submitted field values), then
     create Contact + Lead.
  4. Always respond `200` quickly once processing is attempted — Meta
     disables a subscription after repeated non-200/timeout responses, so
     an unknown `page_id` (no matching org) should be logged and
     acknowledged with 200, not surfaced as an error to Meta.
- Both handlers read the raw body once (needed for signature verification
  before JSON parsing) rather than relying on Start's default body parsing.

## Multi-tenancy: which org owns this Page?

New nullable columns on `Organization`:

```
metaPageId          String? @unique @map("meta_page_id")
metaPageAccessToken String? @map("meta_page_access_token")
```

Set via a new admin-only server function `setMetaPageCredentials` (RLS:
`app.is_org_admin(org_id)`, same gate as `updateUnitPrice`/`createTemplate`)
— no UI this slice, callable directly (e.g. from a REPL or a future admin
screen).

### Why `page_id` doesn't need to be a secret token (unlike `public_form_token`)

`public_form_token` exists because an anonymous browser's *only* proof of
authorization is holding that token — nothing else vouches for the
request. Here, the HMAC signature check in step 1 above already proves the
whole payload (including its `page_id`) genuinely came from Meta's
servers. Once that's verified, trusting the payload's own `page_id` is
safe — a forged request can't get a valid signature without the app
secret. So `page_id` can be a plain (not secret, not rotatable-as-a-token)
identifier, and the RLS design below mirrors `public_form_token`'s
mechanism but doesn't need its secrecy property.

### RLS / anon-write mechanism

Mirrors `20260822080000_website_lead_form_token` exactly, keyed by page
ID instead of form token:

- `app.org_id_for_meta_page()` — `SECURITY DEFINER`, reads a
  `request.meta_page_id` GUC, looks up `organizations.meta_page_id`,
  returns the org id or `NULL`. Same fixed-search-path, same
  "malformed and unknown both return NULL" shape as
  `app.org_id_for_form_token()`.
- `app.meta_page_access_token_for_org(org_id UUID)` — `SECURITY DEFINER`,
  returns that org's `meta_page_access_token`. Called by application code
  (not by an RLS policy) after `org_id` is already known, to fetch the
  credential needed for the Graph API call — kept as its own
  `SECURITY DEFINER` function rather than a direct anon `SELECT` grant on
  `organizations`, since anon has zero `SELECT` access to that table today
  and this shouldn't widen that.
- `withAnonMetaWebhookContext(pageId, fn)` — new wrapper in
  `db.server.ts`, parallel to `withAnonFormContext`: `SET LOCAL ROLE anon`
  + `SET LOCAL "request.meta_page_id" TO '<pageId>'`.
- New `TO anon` `INSERT` policies on `contacts`/`leads`, `WITH CHECK
  (org_id = app.org_id_for_meta_page())` — same shape as the existing
  form-token policies, additive (doesn't touch the existing ones).
- Same `createMany` (not `create`) pattern as `website-lead.server.ts`,
  for the same reason: anon has no `SELECT` policy, so any
  `RETURNING`-based insert would fail RLS even on success.

**Second unauthenticated-writable path into `contacts`/`leads` — flagging
for the same explicit human review gate as the website form, per
CLAUDE.md.**

## Attribution fields — a type mismatch this surfaced

`Lead.campaignId` / `adSetId` / `adId` are `@db.Uuid` columns (see
`01-leads.md`/`05-ad-attribution.md`) — they're shaped to hold *this app's
own* `ad_hierarchy` row IDs once a lead gets linked to a resolved
campaign/ad-set/ad, not a platform's raw external ID string. Meta's
`campaign_id`/`adgroup_id`/`ad_id` in the webhook payload are large numeric
strings (e.g. `"120211234567890"`), not UUIDs — writing them into those
columns directly would fail (invalid UUID). Since this slice deliberately
doesn't link into `ad_hierarchy` (your call above), those three columns
stay `NULL` here, and the raw values go where the schema already has
string-typed room for exactly this:

- `Lead.platformLeadId` (`String?`) — Meta's `leadgen_id`.
- `Lead.formId` (`String?`) — Meta's `form_id`.
- `Lead.rawPayload` (`Json?`) — the full raw webhook `value` object
  (including `campaign_id`, `adgroup_id`, `ad_id`, `page_id`), so nothing
  Meta sends is lost even though it isn't structurally linked yet. A later
  slice that does the real hierarchy linking (per `05-ad-attribution.md`'s
  deferred "Real Meta/Google API sync") can backfill `campaignId`/`adSetId`/
  `adId` from `rawPayload` once it can resolve those external IDs against
  `ad_hierarchy` rows.
- `Lead.source` = `"Meta Lead Ads"`, `Lead.subSource` = the Page name/ID —
  same field used as `"Website"` in `website-lead.server.ts`.

No `Lead`/`Organization` schema changes needed beyond the two new
`Organization` columns above.

## Provider abstraction

`src/lib/meta-lead-ads/provider.ts`:

```ts
export interface MetaLeadAdsProvider {
  fetchLeadFields(
    leadgenId: string,
    pageAccessToken: string,
  ): Promise<{ fullName: string; phone: string | null; email: string | null }>;
}
```

`src/lib/meta-lead-ads/mock-provider.ts` — `MockMetaLeadAdsProvider`:
returns deterministic fake field data (no network call), logs what it
"fetched", exactly the shape of `MockWhatsAppProvider`. The real
implementation later calls Meta's Graph API and parses its `field_data`
array into the same return shape — single swap point in
`meta-leads.server.ts`.

## Idempotency

`Lead.platformLeadId` (already the right field in intent — Meta's
`leadgen_id`, just not currently `@unique`) gains a `@unique` constraint,
rather than adding a parallel column. `createMany({ data: [...],
skipDuplicates: true })` for the `Lead` insert means a retried webhook
delivery for the same `leadgen_id` is a silent no-op, not a duplicate
Lead or a thrown error — same idempotency shape Meta's own docs expect a
receiver to have.

## New migration

`prisma/migrations/<timestamp>_meta_lead_ads_webhook/migration.sql` —
hand-authored (no network path to the real Supabase DB from this sandbox,
same as every earlier migration here). Adds: `organizations.meta_page_id`
(+ unique index), `organizations.meta_page_access_token`, unique index on
`leads.platform_lead_id`, the two `SECURITY DEFINER` functions, and the
two new anon `INSERT` policies. Verified via `prisma validate` +
`db:generate` and a local throwaway Postgres container — **not** applied
to the real Mumbai Supabase DB by this session; needs the same explicit
`prisma migrate deploy` sign-off as every other migration.

## New env vars

Added to `.env.example`:

```
META_APP_SECRET="<meta-app-secret>"
META_WEBHOOK_VERIFY_TOKEN="<any-string-you-choose-and-enter-in-meta-app-dashboard>"
```

Both app-level (one Meta App per LeadCat deployment), unlike
`metaPageId`/`metaPageAccessToken` which are per-org.

## Testing plan

- `tests/tenant-isolation.test.ts`: extend with cases mirroring the
  website-form suite — a request with a valid signature + known `page_id`
  creates Contact/Lead in the right org only; unknown `page_id` creates
  nothing (and the handler still returns 200); a bad/missing signature is
  rejected before any DB write; a retried `leadgen_id` doesn't create a
  second Lead.
- A small standalone test for the signature-verification helper itself
  (valid signature accepted, tampered body rejected, wrong secret
  rejected) — pure function, no DB needed.
- `GET` verification handshake: correct token echoes `hub.challenge`;
  wrong token 403s.
- Manual `curl` smoke test against a local dev server using a
  hand-computed HMAC signature, since there's no real Meta account to test
  against end-to-end.

## Open questions for you

- Should an unknown `page_id` (valid signature, but no org has claimed
  that page) be silently dropped-and-200'd (as designed above, so Meta
  doesn't disable the subscription), or actively logged/alerted somewhere
  you'd see it? There's no logging/alerting infrastructure in this repo
  yet beyond `console.log`/`console.error` — flagging rather than building
  one, per "don't reach for infrastructure prematurely."
- `platformLeadId` gaining a `@unique` constraint: any existing data risk?
  (Believed none — this column is currently unpopulated in production per
  `01-leads.md`, but confirming before adding a `@unique` migration to a
  live table.)
