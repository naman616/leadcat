# WhatsApp Inbound Webhook + Lead Source Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receive inbound WhatsApp messages via a webhook, attribute them to a Lead (creating one tagged `source: "WhatsApp"` on first contact, attaching to the existing Lead on every later message from the same number), and store the message.

**Architecture:** Mirrors the existing Meta Lead Ads webhook (`src/lib/meta-lead-ads/`, `docs/specs/07-meta-lead-ads-webhook.md`) — a public route in `src/server.ts`, HMAC signature verification, an org-scoped credential table resolving an external id to an org. The one structural difference: instead of always inserting a fresh Lead per event (Meta's shape), a single `SECURITY DEFINER` Postgres function does find-Lead-or-create, keyed by phone number, so `anon` needs zero new `SELECT`/`INSERT` grants on `contacts`/`leads`/`whatsapp_messages` — only `EXECUTE` on that one function.

**Tech Stack:** TanStack Start server entry (`src/server.ts`), Prisma (schema + hand-authored migration), Postgres/Supabase RLS + `SECURITY DEFINER` functions, Zod, Vitest.

**Spec:** `docs/specs/08-whatsapp-inbound-webhook.md`

## Global Constraints

- Every tenant-scoped table has `org_id` and RLS enabled from the migration that creates it (CLAUDE.md).
- Never disable or bypass RLS to make something work — the new `anon` write path here works entirely through one `SECURITY DEFINER` function with a narrow `EXECUTE` grant, not through widened table policies.
- Migrations are proposed, never applied to the real Supabase DB by this work — verify locally against `TEST_DATABASE_URL` only.
- `DATABASE_URL` (pooled, `app_user`) is for the app at runtime; migrations use `DIRECT_URL`. Don't touch either.
- This is an unauthenticated-writable endpoint (anon role) — same review-gate flag CLAUDE.md requires for the website lead form and the Meta webhook.
- Package manager is `bun` — use `bun run <script>`, not `npm`/`pnpm`/`yarn`.

---

### Task 1: Database layer — schema, migration, RLS, and the find-or-create function

**Files:**
- Modify: `prisma/schema.prisma` (Organization model relation list ~line 56, `WhatsAppMessageStatus` enum ~lines 782-789, `WhatsAppMessage` model ~lines 819-837, append new `OrgWhatsAppCredential` model at end of file, currently 854 lines)
- Create: `prisma/migrations/20260904000000_whatsapp_inbound_webhook/migration.sql`
- Modify: `tests/tenant-isolation.test.ts` (add a helper after `asAnonWithMetaPage` ~line 85, add two `describe` blocks at end of file)

**Interfaces:**
- Produces: Prisma model `OrgWhatsAppCredential { orgId, whatsappPhoneNumberId, whatsappAccessToken, createdAt, updatedAt }`.
- Produces: `WhatsAppMessage.providerMessageId: string | null`, `WhatsAppMessageStatus` enum value `"received"`.
- Produces: SQL function `app.record_inbound_whatsapp_message(contact_name TEXT, provider_message_id TEXT, message_body TEXT, captured_at TIMESTAMPTZ) RETURNS UUID` — reads `request.whatsapp_phone_number_id` / `request.whatsapp_from_number` GUCs, returns the resolved/created Lead's id, or `NULL` if `phone_number_id` is unattributed. Callable by `anon`.
- Consumed by: Task 3's `withAnonWhatsAppWebhookContext` (which sets those two GUCs) and Task 3's webhook handler.

- [ ] **Step 1: Add `OrgWhatsAppCredential` relation to `Organization` and the model itself**

In `prisma/schema.prisma`, add one line to the `Organization` model's relation list, immediately after `orgMetaCredential OrgMetaCredential?` (~line 56):

```prisma
  orgWhatsAppCredential OrgWhatsAppCredential?
```

Then append this new model at the end of the file (after the existing `OrgMetaCredential` model):

```prisma
/// Which WhatsApp Business phone-number ID maps to which org (see
/// docs/specs/08-whatsapp-inbound-webhook.md). Deliberately its own table,
/// not columns on Organization — same reasoning as OrgMetaCredential: a
/// bearer access token shouldn't be readable by every org member.
model OrgWhatsAppCredential {
  orgId                 String   @id @map("org_id") @db.Uuid
  whatsappPhoneNumberId String   @unique @map("whatsapp_phone_number_id")
  whatsappAccessToken   String   @map("whatsapp_access_token")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @default(now()) @updatedAt @map("updated_at")

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@map("org_whatsapp_credentials")
}
```

- [ ] **Step 2: Add `received` to `WhatsAppMessageStatus` and `providerMessageId` to `WhatsAppMessage`**

In `prisma/schema.prisma`, change the enum (~line 782-789):

```prisma
enum WhatsAppMessageStatus {
  queued
  sent
  delivered
  read
  failed
  received

  @@map("whatsapp_message_status")
}
```

In the `WhatsAppMessage` model (~lines 819-837), add a field and a unique constraint:

```prisma
model WhatsAppMessage {
  id                 String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orgId              String                @map("org_id") @db.Uuid
  leadId             String?               @map("lead_id") @db.Uuid
  direction          WhatsAppDirection
  fromNumber         String                @map("from_number")
  toNumber           String                @map("to_number")
  body               String
  templateId         String?               @map("template_id") @db.Uuid
  status             WhatsAppMessageStatus @default(queued)
  /// WhatsApp's own message id ("wamid...") for an inbound message —
  /// idempotency key against webhook retries. Null for outbound messages.
  providerMessageId  String?               @map("provider_message_id")
  createdAt          DateTime              @default(now()) @map("created_at")

  organization Organization      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  lead         Lead?             @relation(fields: [leadId], references: [id], onDelete: Cascade)
  template     WhatsAppTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)

  @@index([orgId, leadId])
  @@unique([orgId, providerMessageId])
  @@map("whatsapp_messages")
}
```

- [ ] **Step 3: Run `prisma validate` and `db:generate`**

Run: `bun run db:generate`
Expected: succeeds, regenerates `@prisma/client` types including `OrgWhatsAppCredential` and the new `WhatsAppMessage.providerMessageId` field. (`db:generate` runs `prisma generate`, which validates the schema first and fails loudly on any error.)

- [ ] **Step 4: Write the migration**

Create `prisma/migrations/20260904000000_whatsapp_inbound_webhook/migration.sql`:

```sql
-- ============================================================================
-- WhatsApp inbound webhook + lead source tagging. See
-- docs/specs/08-whatsapp-inbound-webhook.md for the full design.
--
-- Unlike 20260826000000_meta_lead_ads_webhook, this does NOT add any new
-- anon INSERT/SELECT policies on contacts/leads/whatsapp_messages. A
-- WhatsApp number sends many messages over time (unlike one Meta Lead Ads
-- event per leadgen_id), so this needs find-existing-lead-or-create, which
-- would otherwise require an anon SELECT policy on contacts/leads to look
-- up an existing match — widening what an unauthenticated,
-- signature-verified-only caller can read. Instead, the whole find-or-
-- create-and-insert sequence lives inside one SECURITY DEFINER function
-- (app.record_inbound_whatsapp_message, below) that bypasses RLS
-- internally, the same mechanism app.org_id_for_meta_page() already uses.
-- anon gets EXECUTE on that one function and nothing else.
-- ============================================================================

-- AlterEnum — the existing queued/sent/delivered/read/failed values are all
-- outbound-lifecycle states; none fit a message the app received.
ALTER TYPE "whatsapp_message_status" ADD VALUE 'received';

-- CreateTable
CREATE TABLE "org_whatsapp_credentials" (
    "org_id" UUID NOT NULL,
    "whatsapp_phone_number_id" TEXT NOT NULL,
    "whatsapp_access_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_whatsapp_credentials_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_whatsapp_credentials_whatsapp_phone_number_id_key" ON "org_whatsapp_credentials"("whatsapp_phone_number_id");

-- AddForeignKey
ALTER TABLE "org_whatsapp_credentials" ADD CONSTRAINT "org_whatsapp_credentials_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN "provider_message_id" TEXT;

-- CreateIndex — idempotency, org-scoped: a retried webhook delivery for the
-- same WhatsApp message id is a no-op (see
-- app.record_inbound_whatsapp_message below), not a duplicate message. NULL
-- for every outbound message is unaffected (Postgres treats NULLs as
-- distinct in a unique index).
CREATE UNIQUE INDEX "whatsapp_messages_org_id_provider_message_id_key" ON "whatsapp_messages"("org_id", "provider_message_id");


-- ============================================================================
-- RLS: org_whatsapp_credentials — admin-only, same shape as
-- org_meta_credentials (no SELECT policy at all for plain members).
-- ============================================================================

ALTER TABLE public.org_whatsapp_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org admins can view their org's whatsapp credentials"
  ON public.org_whatsapp_credentials FOR SELECT
  USING (app.is_org_admin(org_id));

CREATE POLICY "org admins can create their org's whatsapp credentials"
  ON public.org_whatsapp_credentials FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update their org's whatsapp credentials"
  ON public.org_whatsapp_credentials FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete their org's whatsapp credentials"
  ON public.org_whatsapp_credentials FOR DELETE
  USING (app.is_org_admin(org_id));


-- ============================================================================
-- app.record_inbound_whatsapp_message — the one anon-callable entry point
-- for this whole feature. Resolves org from the request.whatsapp_phone_
-- number_id GUC (set by withAnonWhatsAppWebhookContext, src/lib/db.server.ts,
-- only ever after the webhook handler has verified the request's HMAC
-- signature), then:
--   1. If a message with this provider_message_id was already recorded for
--      that org, this is a retried delivery — return its existing lead_id,
--      write nothing else.
--   2. Else find an existing Contact by (org_id, phone = the caller's
--      request.whatsapp_from_number GUC), reusing its most recently
--      created Lead if found. Otherwise create a new Contact + Lead
--      (source 'WhatsApp', sub_source = phone_number_id). Source is set
--      only at Lead-creation time here — a later message from a number
--      that already has a Lead never overwrites it, same "first touch"
--      convention as every other attribution column on Lead.
--   3. Insert the whatsapp_messages row (direction inbound, status
--      received), attached to whichever lead_id step 2 resolved.
--
-- No org_id or phone number is ever passed in as a plain argument — both
-- come only from GUCs this function reads internally — closing off the
-- exact parameter-injection shape found and fixed once already in
-- app.meta_page_access_token_for_org() (task 1 review round 1, PR #59).
-- ============================================================================

CREATE OR REPLACE FUNCTION app.record_inbound_whatsapp_message(
  p_contact_name TEXT,
  p_provider_message_id TEXT,
  p_message_body TEXT,
  p_captured_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_number_id TEXT;
  v_from_number TEXT;
  v_org_id UUID;
  v_contact_id UUID;
  v_lead_id UUID;
BEGIN
  v_phone_number_id := NULLIF(current_setting('request.whatsapp_phone_number_id', true), '');
  v_from_number := NULLIF(current_setting('request.whatsapp_from_number', true), '');

  IF v_phone_number_id IS NULL OR v_from_number IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT org_id INTO v_org_id
  FROM public.org_whatsapp_credentials
  WHERE whatsapp_phone_number_id = v_phone_number_id;

  IF v_org_id IS NULL THEN
    RETURN NULL; -- unknown phone_number_id — logged by the caller, not here.
  END IF;

  -- Idempotency: a retried delivery for a message id already recorded for
  -- this org is a no-op.
  SELECT lead_id INTO v_lead_id
  FROM public.whatsapp_messages
  WHERE org_id = v_org_id AND provider_message_id = p_provider_message_id;

  IF FOUND THEN
    RETURN v_lead_id;
  END IF;

  -- Find an existing Contact by phone within this org; reuse its most
  -- recently created Lead.
  SELECT l.id, c.id INTO v_lead_id, v_contact_id
  FROM public.contacts c
  JOIN public.leads l ON l.contact_id = c.id
  WHERE c.org_id = v_org_id AND c.phone = v_from_number
  ORDER BY l.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    v_contact_id := gen_random_uuid();
    v_lead_id := gen_random_uuid();

    INSERT INTO public.contacts (id, org_id, full_name, phone)
    VALUES (v_contact_id, v_org_id, p_contact_name, v_from_number);

    INSERT INTO public.leads (id, org_id, contact_id, source, sub_source, captured_at)
    VALUES (v_lead_id, v_org_id, v_contact_id, 'WhatsApp', v_phone_number_id, p_captured_at);
  END IF;

  -- to_number holds phone_number_id (Meta's internal id for the receiving
  -- WhatsApp Business number), not a literal E.164 number — there's no
  -- other field carrying it, and the column has never meant anything more
  -- specific than "the number/identifier this message went to."
  INSERT INTO public.whatsapp_messages
    (org_id, lead_id, direction, from_number, to_number, body, status, provider_message_id)
  VALUES
    (v_org_id, v_lead_id, 'inbound', v_from_number, v_phone_number_id, p_message_body, 'received', p_provider_message_id);

  RETURN v_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app.record_inbound_whatsapp_message(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO anon;
```

- [ ] **Step 5: Apply the migration to the test database**

Run: `bun run test:db:setup`
Expected: succeeds — this applies `prisma/test-bootstrap.sql` plus every migration (including the new one) to `TEST_DATABASE_URL`. If it fails on the `ALTER TYPE ... ADD VALUE` or function body, fix the SQL and rerun.

- [ ] **Step 6: Add the `asAnonWithWhatsAppNumber` test helper**

In `tests/tenant-isolation.test.ts`, immediately after the `asAnonWithMetaPage` function (~line 85), add:

```ts
/**
 * Same idea, for the WhatsApp inbound webhook's anon write path (see
 * docs/specs/08-whatsapp-inbound-webhook.md). Sets both
 * "request.whatsapp_phone_number_id" and "request.whatsapp_from_number"
 * GUCs, which app.record_inbound_whatsapp_message()
 * (prisma/migrations/20260904000000_whatsapp_inbound_webhook) reads.
 * Mirrors withAnonWhatsAppWebhookContext in src/lib/db.server.ts exactly.
 */
async function asAnonWithWhatsAppNumber<T>(
  phoneNumberId: string,
  fromNumber: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
    await tx.$executeRawUnsafe(`SET LOCAL "request.whatsapp_phone_number_id" TO '${phoneNumberId}'`);
    await tx.$executeRawUnsafe(`SET LOCAL "request.whatsapp_from_number" TO '${fromNumber}'`);
    return fn(tx);
  });
}

/** Calls app.record_inbound_whatsapp_message() and returns the lead_id it resolved (or null). */
async function recordInboundWhatsAppMessage(
  phoneNumberId: string,
  fromNumber: string,
  args: { contactName: string; providerMessageId: string; body: string; capturedAt: Date },
): Promise<string | null> {
  const [row] = await asAnonWithWhatsAppNumber(phoneNumberId, fromNumber, (tx) =>
    tx.$queryRaw<{ lead_id: string | null }[]>`
      SELECT app.record_inbound_whatsapp_message(
        ${args.contactName}, ${args.providerMessageId}, ${args.body}, ${args.capturedAt}
      ) AS lead_id
    `,
  );
  return row?.lead_id ?? null;
}
```

- [ ] **Step 7: Write the DB-layer tests**

At the end of `tests/tenant-isolation.test.ts`, add:

```ts
// Regression tests for 20260904000000_whatsapp_inbound_webhook and
// src/lib/whatsapp.server.ts / whatsapp/webhook-handler.ts — WhatsApp
// inbound lead source tagging.
describe("org_whatsapp_credentials — admin-only", () => {
  const orgAPhoneNumberId = `whatsapp-phone-a-${run}`;

  it("an org admin CAN create their org's whatsapp credentials", async () => {
    const created = await asUser(userA.id, (tx) =>
      tx.orgWhatsAppCredential.create({
        data: {
          orgId: orgA.id,
          whatsappPhoneNumberId: orgAPhoneNumberId,
          whatsappAccessToken: "secret-token-a",
        },
      }),
    );
    expect(created.orgId).toBe(orgA.id);
  });

  it("a non-admin CANNOT create whatsapp credentials, even in their own org", async () => {
    await expect(
      asUser(agentX.id, (tx) =>
        tx.orgWhatsAppCredential.create({
          data: {
            orgId: orgA.id,
            whatsappPhoneNumberId: `rejected-${run}`,
            whatsappAccessToken: "nope",
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a non-admin CANNOT read whatsapp credentials, even in their own org", async () => {
    const seen = await asUser(agentX.id, (tx) => tx.orgWhatsAppCredential.findMany());
    expect(seen).toHaveLength(0);
  });

  it("anon has zero access to whatsapp credentials", async () => {
    const seen = await asAnon((tx) => tx.orgWhatsAppCredential.findMany());
    expect(seen).toHaveLength(0);
  });

  it("an org admin CANNOT write into another org's whatsapp credentials", async () => {
    const updateResult = await asUser(userB.id, (tx) =>
      tx.orgWhatsAppCredential.updateMany({
        where: { orgId: orgA.id },
        data: { whatsappAccessToken: "hijacked-cross-org" },
      }),
    );
    expect(updateResult.count).toBe(0);
  });
});

describe("whatsapp inbound webhook — record_inbound_whatsapp_message", () => {
  const orgAPhoneNumberId = `whatsapp-phone-inbound-a-${run}`;
  const orgBPhoneNumberId = `whatsapp-phone-inbound-b-${run}`;

  beforeAll(async () => {
    await prisma.orgWhatsAppCredential.upsert({
      where: { orgId: orgA.id },
      create: {
        orgId: orgA.id,
        whatsappPhoneNumberId: orgAPhoneNumberId,
        whatsappAccessToken: "webhook-test-token-a",
      },
      update: { whatsappPhoneNumberId: orgAPhoneNumberId, whatsappAccessToken: "webhook-test-token-a" },
    });
    await prisma.orgWhatsAppCredential.upsert({
      where: { orgId: orgB.id },
      create: {
        orgId: orgB.id,
        whatsappPhoneNumberId: orgBPhoneNumberId,
        whatsappAccessToken: "webhook-test-token-b",
      },
      update: { whatsappPhoneNumberId: orgBPhoneNumberId, whatsappAccessToken: "webhook-test-token-b" },
    });
  });

  it("an unknown phone number id resolves to no lead and writes nothing", async () => {
    const leadId = await recordInboundWhatsAppMessage(`unknown-phone-${run}`, "911111111", {
      contactName: "Nobody",
      providerMessageId: `wamid-unknown-${run}`,
      body: "Hello?",
      capturedAt: new Date(),
    });
    expect(leadId).toBeNull();
  });

  it("the first message from a number creates a Contact + Lead with source WhatsApp", async () => {
    const fromNumber = `919876${run}0`;
    const leadId = await recordInboundWhatsAppMessage(orgAPhoneNumberId, fromNumber, {
      contactName: "New WhatsApp Lead",
      providerMessageId: `wamid-first-${run}`,
      body: "Hi, interested in 2BHK",
      capturedAt: new Date(),
    });
    expect(leadId).not.toBeNull();

    const lead = await asUser(userA.id, (tx) => tx.lead.findUniqueOrThrow({ where: { id: leadId! } }));
    expect(lead.orgId).toBe(orgA.id);
    expect(lead.source).toBe("WhatsApp");
    expect(lead.subSource).toBe(orgAPhoneNumberId);

    const contact = await asUser(userA.id, (tx) =>
      tx.contact.findUniqueOrThrow({ where: { id: lead.contactId } }),
    );
    expect(contact.phone).toBe(fromNumber);
    expect(contact.fullName).toBe("New WhatsApp Lead");

    const message = await asUser(userA.id, (tx) =>
      tx.whatsAppMessage.findFirstOrThrow({ where: { providerMessageId: `wamid-first-${run}` } }),
    );
    expect(message.direction).toBe("inbound");
    expect(message.status).toBe("received");
    expect(message.leadId).toBe(leadId);
  });

  it("a second message from the same number attaches to the same Lead, no duplicate Contact", async () => {
    const fromNumber = `919876${run}1`;
    const firstLeadId = await recordInboundWhatsAppMessage(orgAPhoneNumberId, fromNumber, {
      contactName: "Repeat Contact",
      providerMessageId: `wamid-repeat-1-${run}`,
      body: "First message",
      capturedAt: new Date(),
    });
    const secondLeadId = await recordInboundWhatsAppMessage(orgAPhoneNumberId, fromNumber, {
      contactName: "Repeat Contact",
      providerMessageId: `wamid-repeat-2-${run}`,
      body: "Second message",
      capturedAt: new Date(),
    });
    expect(secondLeadId).toBe(firstLeadId);

    const contacts = await asUser(userA.id, (tx) =>
      tx.contact.findMany({ where: { phone: fromNumber } }),
    );
    expect(contacts).toHaveLength(1);

    const messages = await asUser(userA.id, (tx) =>
      tx.whatsAppMessage.findMany({ where: { leadId: firstLeadId! } }),
    );
    expect(messages).toHaveLength(2);
  });

  it("a retried delivery (same provider_message_id) is a no-op", async () => {
    const fromNumber = `919876${run}2`;
    const leadId = await recordInboundWhatsAppMessage(orgAPhoneNumberId, fromNumber, {
      contactName: "Retry Contact",
      providerMessageId: `wamid-retry-${run}`,
      body: "Original delivery",
      capturedAt: new Date(),
    });
    const retriedLeadId = await recordInboundWhatsAppMessage(orgAPhoneNumberId, fromNumber, {
      contactName: "Retry Contact",
      providerMessageId: `wamid-retry-${run}`,
      body: "Original delivery",
      capturedAt: new Date(),
    });
    expect(retriedLeadId).toBe(leadId);

    const messages = await asUser(userA.id, (tx) =>
      tx.whatsAppMessage.findMany({ where: { providerMessageId: `wamid-retry-${run}` } }),
    );
    expect(messages).toHaveLength(1);
  });

  it("org A's phone number id never attributes a lead to org B, and vice versa", async () => {
    const fromNumber = `919876${run}3`;
    const leadIdViaA = await recordInboundWhatsAppMessage(orgAPhoneNumberId, fromNumber, {
      contactName: "Org A Contact",
      providerMessageId: `wamid-org-a-${run}`,
      body: "To org A",
      capturedAt: new Date(),
    });
    const leadViaA = await asUser(userA.id, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: leadIdViaA! } }),
    );
    expect(leadViaA.orgId).toBe(orgA.id);

    // Same phone number messaging org B's number creates a separate Contact
    // in org B — never attached to org A's Lead.
    const leadIdViaB = await recordInboundWhatsAppMessage(orgBPhoneNumberId, fromNumber, {
      contactName: "Org B Contact",
      providerMessageId: `wamid-org-b-${run}`,
      body: "To org B",
      capturedAt: new Date(),
    });
    expect(leadIdViaB).not.toBe(leadIdViaA);
    const leadViaB = await asUser(userB.id, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: leadIdViaB! } }),
    );
    expect(leadViaB.orgId).toBe(orgB.id);
  });
});
```

- [ ] **Step 8: Run the tests and verify they pass**

Run: `bun run test -- tests/tenant-isolation.test.ts`
Expected: all tests pass, including the new `org_whatsapp_credentials` and `whatsapp inbound webhook` describe blocks.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260904000000_whatsapp_inbound_webhook tests/tenant-isolation.test.ts
git commit -m "Add WhatsApp inbound webhook DB layer: org_whatsapp_credentials, record_inbound_whatsapp_message (docs/specs/08-whatsapp-inbound-webhook.md)"
```

---

### Task 2: Admin credential-setting server function

**Files:**
- Modify: `src/lib/whatsapp.server.ts` (add after the existing `listTemplates` function, ~line 44)
- Test: extend `tests/tenant-isolation.test.ts`'s `org_whatsapp_credentials — admin-only` describe block from Task 1 — no new test file.

**Interfaces:**
- Consumes: `requireUserId`, `requirePrimaryOrgId` (`./current-user.server`), `withUserContext` (`./db.server`) — all already imported in this file.
- Produces: `setWhatsAppPhoneCredentials` — a `createServerFn` callable directly (no UI this slice), upserting one `OrgWhatsAppCredential` row per org.

- [ ] **Step 1: Add the server function**

In `src/lib/whatsapp.server.ts`, add after `listTemplates` (~line 44):

```ts
const setWhatsAppPhoneCredentialsSchema = z.object({
  whatsappPhoneNumberId: z.string().min(1),
  whatsappAccessToken: z.string().min(1),
});

/**
 * Admin-only — RLS gates this via org_whatsapp_credentials' write policies
 * (app.is_org_admin), same shape as setMetaPageCredentials
 * (src/lib/meta-lead-ads.server.ts). No app-level role check needed; a
 * non-admin's upsert is simply rejected by Postgres. No UI yet — callable
 * directly until an admin settings screen exists.
 *
 * ponytail: no phone-number ownership verification. whatsappPhoneNumberId
 * is globally unique and first-come-first-served — nothing here checks the
 * calling org actually controls the WhatsApp Business number being
 * registered, so an org admin could register another org's real number
 * first and misattribute their real inbound messages. Same accepted-gap
 * shape as setMetaPageCredentials; see docs/specs/08-whatsapp-inbound-webhook.md
 * ("Known limitation") — this must not be enabled for more than one org on
 * a shared deployment until a real WhatsApp Cloud API ownership check
 * exists.
 */
export const setWhatsAppPhoneCredentials = createServerFn({ method: "POST" })
  .validator(setWhatsAppPhoneCredentialsSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.orgWhatsAppCredential.upsert({
        where: { orgId },
        create: {
          orgId,
          whatsappPhoneNumberId: data.whatsappPhoneNumberId,
          whatsappAccessToken: data.whatsappAccessToken,
        },
        update: {
          whatsappPhoneNumberId: data.whatsappPhoneNumberId,
          whatsappAccessToken: data.whatsappAccessToken,
        },
      }),
    );
  });
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors — confirms `tx.orgWhatsAppCredential` resolves against the Prisma client generated in Task 1.

- [ ] **Step 3: Run the existing admin-only RLS tests from Task 1**

Run: `bun run test -- tests/tenant-isolation.test.ts -t "org_whatsapp_credentials"`
Expected: pass (these already exercise the RLS this function relies on; this step just confirms nothing in this task broke them).

- [ ] **Step 4: Commit**

```bash
git add src/lib/whatsapp.server.ts
git commit -m "Add setWhatsAppPhoneCredentials admin server function"
```

---

### Task 3: Webhook HTTP handler, GUC wrapper, and route wiring

**Files:**
- Modify: `src/lib/db.server.ts` (add after `withAnonMetaWebhookContext`, ~line 135)
- Create: `src/lib/whatsapp/webhook-handler.ts`
- Modify: `src/server.ts` (add a branch alongside the existing `/api/webhooks/meta-leads` one)
- Modify: `.env.example` (add after `META_WEBHOOK_VERIFY_TOKEN`)
- Test: `tests/whatsapp-inbound-webhook-handler.test.ts` (new)

**Interfaces:**
- Consumes: `app.record_inbound_whatsapp_message` (Task 1), `verifyMetaSignature` from `src/lib/meta-lead-ads/verify-signature.ts` (existing, unmodified), `prisma` export from `./db.server`.
- Produces: `withAnonWhatsAppWebhookContext<T>(phoneNumberId: string, fromNumber: string, fn: (tx: Tx) => Promise<T>): Promise<T>` in `db.server.ts`.
- Produces: `handleWhatsAppWebhook(request: Request): Promise<Response>` in `whatsapp/webhook-handler.ts`, wired into `src/server.ts`.

- [ ] **Step 1: Add `withAnonWhatsAppWebhookContext` to `db.server.ts`**

In `src/lib/db.server.ts`, add after `withAnonMetaWebhookContext` (~line 135):

```ts

/**
 * Same idea, for the WhatsApp inbound webhook's anon write path (see
 * docs/specs/08-whatsapp-inbound-webhook.md). Sets two GUCs —
 * "request.whatsapp_phone_number_id" and "request.whatsapp_from_number" —
 * which app.record_inbound_whatsapp_message() (added in
 * prisma/migrations/20260904000000_whatsapp_inbound_webhook) reads to
 * resolve org + find-or-create the Lead. Like pageId in
 * withAnonMetaWebhookContext, neither value needs to be a secret: the
 * webhook handler only calls this after verifying the request's HMAC
 * signature, which is what actually proves both values are genuine.
 */
export async function withAnonWhatsAppWebhookContext<T>(
  phoneNumberId: string,
  fromNumber: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
      const escapedPhoneNumberId = phoneNumberId.replace(/'/g, "''");
      const escapedFromNumber = fromNumber.replace(/'/g, "''");
      await tx.$executeRawUnsafe(
        `SET LOCAL "request.whatsapp_phone_number_id" TO '${escapedPhoneNumberId}'`,
      );
      await tx.$executeRawUnsafe(`SET LOCAL "request.whatsapp_from_number" TO '${escapedFromNumber}'`);
      return fn(tx);
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
  );
}
```

- [ ] **Step 2: Write the webhook handler**

Create `src/lib/whatsapp/webhook-handler.ts`:

```ts
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
      await withAnonWhatsAppWebhookContext(phoneNumberId, message.from, (tx) =>
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
```

- [ ] **Step 3: Wire the route into `src/server.ts`**

In `src/server.ts`, add the import alongside the existing one:

```ts
import { handleWhatsAppWebhook } from "./lib/whatsapp/webhook-handler";
```

And add a branch inside the existing `try` block, alongside the `meta-leads` one (~line 52):

```ts
      if (url.pathname === "/api/webhooks/meta-leads") {
        return await handleMetaLeadsWebhook(request);
      }
      if (url.pathname === "/api/webhooks/whatsapp") {
        return await handleWhatsAppWebhook(request);
      }
```

- [ ] **Step 4: Add the new env vars to `.env.example`**

In `.env.example`, add after `META_WEBHOOK_VERIFY_TOKEN` (~line 35):

```
WHATSAPP_APP_SECRET="<meta-app-secret-for-the-whatsapp-app>"
WHATSAPP_WEBHOOK_VERIFY_TOKEN="<any-string-you-choose-and-enter-in-meta-app-dashboard>"
```

- [ ] **Step 5: Write the failing handler tests**

Create `tests/whatsapp-inbound-webhook-handler.test.ts`:

```ts
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
                  { id: "wamid.image", from: "919999999999", timestamp: "1690000000", type: "image" },
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

  it("unsupported methods return 405", async () => {
    const response = await handleWhatsAppWebhook(
      new Request("http://localhost/api/webhooks/whatsapp", { method: "DELETE" }),
    );
    expect(response.status).toBe(405);
  });
});
```

Note: no test here sends a `type: "text"` message with a real `phone_number_id` — that path calls `withAnonWhatsAppWebhookContext`, which uses the shared `prisma` client pointed at `DATABASE_URL`, not the throwaway `TEST_DATABASE_URL` this suite otherwise uses. The full find-or-create/idempotency/attribution behavior is already covered against a real (test) database in Task 1's `tests/tenant-isolation.test.ts` additions, which call `app.record_inbound_whatsapp_message` directly. This file, like `tests/meta-lead-ads-webhook-handler.test.ts`, stays confined to signature/shape/routing behavior that never reaches the DB.

- [ ] **Step 6: Run the tests to verify they fail for the right reason first**

Run: `bun run test -- tests/whatsapp-inbound-webhook-handler.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/whatsapp/webhook-handler'` (file doesn't exist yet if you're executing steps out of order; if Step 2 already ran, skip this check and go straight to Step 7).

- [ ] **Step 7: Run the tests and verify they pass**

Run: `bun run test -- tests/whatsapp-inbound-webhook-handler.test.ts`
Expected: all tests pass.

- [ ] **Step 8: Run typecheck and the full test suite**

Run: `bun run typecheck && bun run test`
Expected: no type errors; every test file (including Task 1/2's additions to `tests/tenant-isolation.test.ts`) passes.

- [ ] **Step 9: Manual smoke test against a local dev server**

Run: `bun run dev` (separate terminal), then, with `WHATSAPP_APP_SECRET`/`WHATSAPP_WEBHOOK_VERIFY_TOKEN` set in your local `.env` and a phone-number-id credential seeded via `setWhatsAppPhoneCredentials`:

```bash
BODY='{"entry":[{"id":"waba","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"<your-seeded-id>"},"contacts":[{"profile":{"name":"Test User"}}],"messages":[{"id":"wamid.smoke1","from":"919876500000","timestamp":"1700000000","type":"text","text":{"body":"Hello from smoke test"}}]}}]}}'
SIG="sha256=$(node -e "console.log(require('crypto').createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(process.env.BODY).digest('hex'))")"
curl -i -X POST http://localhost:3000/api/webhooks/whatsapp -H "x-hub-signature-256: $SIG" -H "content-type: application/json" -d "$BODY"
```

Expected: `200 EVENT_RECEIVED`; a new Lead with `source: "WhatsApp"` visible for that org.

- [ ] **Step 10: Commit**

```bash
git add src/lib/db.server.ts src/lib/whatsapp/webhook-handler.ts src/server.ts .env.example tests/whatsapp-inbound-webhook-handler.test.ts
git commit -m "Add WhatsApp inbound webhook handler and route wiring"
```
