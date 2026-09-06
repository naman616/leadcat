# 09 — WhatsApp Auto-First-Response

Issue #51. Builds directly on 08-whatsapp-inbound-webhook.md, merged as
PR #60: when a brand-new number messages an org's WhatsApp number for the
first time (a new Lead is created), automatically send back one canned
reply via `WhatsAppProvider`, and log it as an outbound message.

## What's in this slice vs. deferred

**In:**

- The inbound webhook detects "this message created a new Lead" (as
  opposed to attaching to an existing one) and, only in that case, sends
  one auto-reply.
- The reply is sent through the same `WhatsAppProvider` seam
  `sendWhatsAppMessage` already uses (currently `MockWhatsAppProvider`),
  and recorded as an outbound `whatsapp_messages` row + attributed to the
  Lead.
- Never re-fires on a retried webhook delivery (same `provider_message_id`)
  or on any later message from that number.

**Deferred:**

- Per-org customizable reply text. This ships one hardcoded body for every
  org (`ponytail` comment in `webhook-handler.ts`). Wiring it to an
  admin-selected `WhatsAppTemplate` needs a schema change (an
  "is_default"-style flag — none of the existing template fields express
  "use this one automatically") and an admin settings screen. Not worth
  it until an org actually needs a different first-response than another.
- Business-hours/quiet-hours suppression. Out of scope; nothing in the
  spec asked for it.
- Delivery-status tracking on the auto-reply beyond `status: 'sent'` — same
  gap `sendWhatsAppMessage` already has (mock provider never reports
  delivered/read).

## Why "is new lead", not "is first message"

The inbound function already does find-or-create-Lead-by-phone. The
natural signal for "should we auto-respond" is exactly the branch where it
creates a new Lead, not a heuristic re-derived from message counts
afterward (which would need an extra anon-readable query this feature
doesn't otherwise need).

## Design: two SECURITY DEFINER functions, not one

The provider send is a TypeScript-side operation (even the mock one is
`async`) — it cannot happen inside the SQL function that determines
"is this new". So this needs two round trips from the webhook handler:

1. `app.record_inbound_whatsapp_message` (existing, from PR #60) — its
   return type widens from a bare `UUID` to
   `TABLE(lead_id UUID, is_new_lead BOOLEAN)`. Postgres can't
   `CREATE OR REPLACE` a function into a different return type, so the
   migration `DROP`s and recreates it; the find-or-create logic itself is
   unchanged.
2. `app.record_whatsapp_autoresponse_sent(p_lead_id, p_message_body,
   p_provider_message_id)` — new. Called by the webhook handler after the
   provider send succeeds, to write the outbound `whatsapp_messages` row.

Both are anon-callable `SECURITY DEFINER` functions, same class as PR
#60's `record_inbound_whatsapp_message` — this is now the **second**
write-capable anon-granted function in the codebase, flagged for the same
human review gate (CLAUDE.md).

`record_whatsapp_autoresponse_sent` never trusts `p_lead_id` on its own:
it re-derives `org_id` from the same `request.whatsapp_phone_number_id`
GUC the webhook handler already set (after HMAC verification), and
requires the lead to actually belong to that org before writing anything.
Anyone holding the anon key could in principle call this function
directly with an arbitrary `lead_id` — the GUC requirement (which only our
webhook handler sets, and only post-signature-check) is what prevents
that from doing anything: without a matching phone-number-id credential
row, `org_id` never resolves and the function is a no-op. Covered by a
cross-org test in `tests/tenant-isolation.test.ts`.

## Data model changes

No new tables or columns. `whatsapp_messages` already supports everything
needed (`direction: 'outbound'`, `status: 'sent'`, `provider_message_id`
for the mock provider's generated id).

## New migration

`prisma/migrations/20260906000000_whatsapp_auto_first_response/migration.sql`
— drops and recreates `record_inbound_whatsapp_message` with the wider
return type, adds `record_whatsapp_autoresponse_sent`, grants `EXECUTE` on
both to `anon`. Proposed only — applied to a local throwaway Postgres in
this session, **not** to the shared Mumbai Supabase DB (same sign-off gate
as every migration here, and PR #60's migration is itself still pending
that same step).

## Testing plan

- `tests/tenant-isolation.test.ts`: extended the existing
  `record_inbound_whatsapp_message` regression tests to assert
  `is_new_lead` (true on first contact, false on repeat and on a retried
  delivery), and added a new `describe` block for
  `record_whatsapp_autoresponse_sent` — one happy-path test (writes the
  outbound row, attributed to the right org) and one cross-org test
  (a lead from org A, called under org B's phone-number context, writes
  nothing).
- `tests/whatsapp-inbound-webhook-handler.test.ts`: unchanged. Every
  existing test in this file deliberately avoids reaching an actual
  `tx.$queryRaw` round trip (per its own no-live-DB design principle,
  established when a DB-touching test was removed from it during PR #60's
  review). The new `is_new_lead` branch and `sendAutoFirstResponse` can
  only be exercised with a real Postgres behind
  `record_inbound_whatsapp_message`, so that behavior is covered in
  `tenant-isolation.test.ts` instead, not here.
- `bun run typecheck` — clean.
- `bun run lint` — 0 errors (7 pre-existing warnings, unrelated).
- `bun run test:db:setup` / `bun run test` — **not run this session**; no
  docker/local Postgres available in this sandbox (same limitation noted
  in PR #60 and PR #62). Relying on GitHub Actions CI as the actual DB-
  backed gate before merge.

## Known/accepted limitations

- One hardcoded reply body for every org (see "Deferred" above).
- If the provider send succeeds but recording the outbound message fails
  (or vice versa isn't possible — the record only happens after a
  successful send), the org's message log under-reports what was actually
  sent. Logged via `console.error`, swallowed — same "best-effort,
  isolated failure" shape as the rest of this webhook's per-message error
  handling. A real WhatsApp Business account (issue #31) would need
  delivery-status webhooks anyway, which is the natural point to
  reconcile this properly.
