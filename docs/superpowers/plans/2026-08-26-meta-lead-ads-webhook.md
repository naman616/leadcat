# Meta Lead Ads Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Meta/Facebook Lead Ads submissions via an inbound webhook, creating a Contact + Lead per org, with no real Meta Business account required to build or test it.

**Architecture:** A raw HTTP endpoint (routed through the app's existing custom server entry, `src/server.ts` — there's no file-based "server route" API in this version of TanStack Start) verifies Meta's HMAC signature, resolves which org owns the sending Facebook Page via a new admin-only-readable credentials table + a `SECURITY DEFINER` Postgres function (mirroring the existing public-website-form pattern), fetches lead field data through a swappable `MetaLeadAdsProvider` (mocked for now, same seam as WhatsApp/SMS/email), and writes idempotently via `anon`-role RLS-gated inserts.

**Tech Stack:** TanStack Start (custom server entry, not a router-based API route), Prisma + Supabase Postgres RLS, Zod, `node:crypto` (HMAC, stdlib — no new dependency), Vitest.

**Spec:** `docs/specs/07-meta-lead-ads-webhook.md`

## Global Constraints

- Package manager is **bun** — run `bun run test`, `bun run typecheck`, `bun run db:generate`, `bun run test:db:setup`, not npm/pnpm/yarn.
- All input validation via Zod, on every `createServerFn`.
- No RLS bypass anywhere in this feature — every query touching `contacts`/`leads`/`org_meta_credentials` goes through `withUserContext`/`withAnonMetaWebhookContext`, never the raw `prisma` export.
- **Migrations are proposed, never applied to the real Mumbai Supabase DB by this plan.** Every step below runs `prisma migrate` tooling only against a local/test Postgres (`TEST_DATABASE_URL`). Applying to production is a separate, explicit sign-off step outside this plan.
- Auth/tenancy code (this entire feature) needs explicit human review before merge, per CLAUDE.md's review gates — flagged again at the end of this plan.
- No new dependencies — `node:crypto` for HMAC is stdlib.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | Modify: add `OrgMetaCredential` model, `orgMetaCredential` relation on `Organization`, `@unique` on `Lead.platformLeadId`. |
| `prisma/migrations/20260826000000_meta_lead_ads_webhook/migration.sql` | Create: the `org_meta_credentials` table + its RLS, the two new `SECURITY DEFINER` functions, the two new anon `INSERT` policies on `contacts`/`leads`, the unique index on `leads.platform_lead_id`. |
| `src/lib/meta-lead-ads.server.ts` | Create: `setMetaPageCredentials` — the one admin-only `createServerFn` for this feature. |
| `src/lib/meta-lead-ads/provider.ts` | Create: `MetaLeadAdsProvider` interface — the swap seam for the real Graph API call. |
| `src/lib/meta-lead-ads/mock-provider.ts` | Create: `MockMetaLeadAdsProvider` — the one actually wired up until real Meta credentials exist. |
| `src/lib/meta-lead-ads/verify-signature.ts` | Create: `verifyMetaSignature` — pure HMAC verification, no DB. |
| `src/lib/meta-lead-ads/webhook-handler.ts` | Create: `handleMetaLeadsWebhook` — GET verification handshake + POST lead-notification processing. |
| `src/lib/db.server.ts` | Modify: add `withAnonMetaWebhookContext`, mirroring `withAnonFormContext`. |
| `src/server.ts` | Modify: route `/api/webhooks/meta-leads` to the new handler before delegating to TanStack's SSR entry. |
| `.env.example` | Modify: add `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`. |
| `tests/tenant-isolation.test.ts` | Modify: add `asAnonWithMetaPage` helper + two new `describe` blocks (admin-only credentials, anon webhook write path). |
| `tests/meta-lead-ads-verify-signature.test.ts` | Create: unit tests for the HMAC helper. |
| `tests/meta-lead-ads-webhook-handler.test.ts` | Create: unit tests for the handler's non-DB-touching control flow (signature rejection, GET handshake, malformed JSON, empty/non-leadgen payloads). |

**Why the DB-touching webhook logic isn't unit-tested via `handleMetaLeadsWebhook` directly:** `tests/tenant-isolation.test.ts` deliberately uses its own `PrismaClient` pointed at `TEST_DATABASE_URL`, never importing `src/lib/db.server.ts`'s app-wired singleton (which reads `DATABASE_URL`) — that's why `asAnonWithFormToken` is a hand-duplicated helper in the test file rather than an import of `withAnonFormContext`. `handleMetaLeadsWebhook` internally uses `withAnonMetaWebhookContext` from `db.server.ts`, so exercising its DB-writing branch directly in a test would risk running against whatever `DATABASE_URL` happens to be in the test process's environment. Same split as `sendWhatsAppMessage` in this codebase: the RLS/write logic is verified by replicating the transaction body directly in `tenant-isolation.test.ts` (safe, uses `TEST_DATABASE_URL`); the handler's pure control flow (signature check, parsing, routing) is unit-tested directly since those paths never touch the DB when they reject early.

---

### Task 1: `org_meta_credentials` table, RLS, and the anon webhook write path

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260826000000_meta_lead_ads_webhook/migration.sql`
- Create: `src/lib/meta-lead-ads.server.ts`
- Modify: `tests/tenant-isolation.test.ts`

**Interfaces:**
- Produces: `app.org_id_for_meta_page()` (SQL function, no args, reads `request.meta_page_id` GUC, returns `UUID | NULL`), `app.meta_page_access_token_for_org(target_org_id UUID)` (SQL function, returns `TEXT | NULL`), Prisma model `OrgMetaCredential { orgId, metaPageId, metaPageAccessToken, createdAt, updatedAt }`, `setMetaPageCredentials({ metaPageId, metaPageAccessToken })` server fn.
- Consumes: `app.is_org_admin(UUID)` (existing, from `20260815054857_init`), `withUserContext` (existing, `src/lib/db.server.ts`), `requireUserId`/`requirePrimaryOrgId` (existing, `src/lib/current-user.server.ts`).

- [ ] **Step 1: Edit `prisma/schema.prisma` — add `@unique` to `Lead.platformLeadId`**

In the `Lead` model (around line 186), change:

```prisma
  platformLeadId String?   @map("platform_lead_id")
```

to:

```prisma
  platformLeadId String?   @unique @map("platform_lead_id")
```

- [ ] **Step 2: Edit `prisma/schema.prisma` — add the relation field to `Organization`**

In the `Organization` model's relation list, after the `whatsappMessages` line, add:

```prisma
  orgMetaCredential OrgMetaCredential?
```

- [ ] **Step 3: Edit `prisma/schema.prisma` — append the new model**

At the end of the file, after the `WhatsAppMessage` model, add:

```prisma
/// Which Facebook Page maps to which org (issue #24), and that page's
/// Graph API access token. Deliberately its own table, not columns on
/// Organization: organizations' SELECT policy is member-readable, but a
/// Page access token is a bearer credential for Meta's API — see
/// docs/specs/07-meta-lead-ads-webhook.md.
model OrgMetaCredential {
  orgId               String   @id @map("org_id") @db.Uuid
  metaPageId          String   @unique @map("meta_page_id")
  metaPageAccessToken String   @map("meta_page_access_token")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @default(now()) @updatedAt @map("updated_at")

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@map("org_meta_credentials")
}
```

- [ ] **Step 4: Run `bun run db:generate` to regenerate the Prisma client**

Run: `bun run db:generate`
Expected: succeeds, no errors. This regenerates `@prisma/client` types for `OrgMetaCredential` and the now-unique `platformLeadId` — needed before the next steps typecheck.

- [ ] **Step 5: Write the migration file**

Create `prisma/migrations/20260826000000_meta_lead_ads_webhook/migration.sql`:

```sql
-- ============================================================================
-- Meta Lead Ads webhook (issue #24). See
-- docs/specs/07-meta-lead-ads-webhook.md for the full design.
--
-- Two concerns in one migration, same as 20260822140000_whatsapp_core
-- bundling templates+messages:
--
-- 1. org_meta_credentials — which Facebook Page maps to which org, and
--    that page's Graph API access token. Its own table, not columns on
--    organizations: that table's SELECT policy is member-readable, but a
--    Page access token is a bearer credential for Meta's API — admin-only
--    here, via app.is_org_admin(), same gate as whatsapp_templates' writes,
--    but with no member-read exposure at all (unlike whatsapp_templates).
--
-- 2. The anon-writable webhook path into contacts/leads — mirrors
--    20260822080000_website_lead_form_token exactly, keyed by a
--    request.meta_page_id GUC instead of request.form_token. page_id
--    doesn't need to be a secret the way form_token does: the webhook
--    handler verifies Meta's HMAC signature before ever setting this GUC,
--    so by the time app.org_id_for_meta_page() runs, the caller is already
--    proven to be Meta itself.
-- ============================================================================

-- CreateTable
CREATE TABLE "org_meta_credentials" (
    "org_id" UUID NOT NULL,
    "meta_page_id" TEXT NOT NULL,
    "meta_page_access_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_meta_credentials_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_meta_credentials_meta_page_id_key" ON "org_meta_credentials"("meta_page_id");

-- AddForeignKey
ALTER TABLE "org_meta_credentials" ADD CONSTRAINT "org_meta_credentials_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable — idempotency: a retried webhook delivery for the same
-- leadgen_id is a no-op (see src/lib/meta-lead-ads/webhook-handler.ts's
-- skipDuplicates), not a duplicate Lead. Postgres unique indexes already
-- treat NULL as distinct from other NULLs, so no partial/WHERE clause is
-- needed — every non-Meta lead's NULL platform_lead_id is unaffected.
CREATE UNIQUE INDEX "leads_platform_lead_id_key" ON "leads"("platform_lead_id");


-- ============================================================================
-- RLS: org_meta_credentials — admin-only, full stop. No SELECT policy for
-- plain members at all (unlike whatsapp_templates, which is member-
-- readable but admin-writable) — the access token here is a bearer
-- credential for Meta's Graph API, a bigger blast radius than anything
-- else gated by app.is_org_admin() so far in this app.
-- ============================================================================

ALTER TABLE public.org_meta_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org admins can view their org's meta credentials"
  ON public.org_meta_credentials FOR SELECT
  USING (app.is_org_admin(org_id));

CREATE POLICY "org admins can create their org's meta credentials"
  ON public.org_meta_credentials FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update their org's meta credentials"
  ON public.org_meta_credentials FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete their org's meta credentials"
  ON public.org_meta_credentials FOR DELETE
  USING (app.is_org_admin(org_id));


-- ============================================================================
-- RLS helper: which org (if any) does the calling anon request's verified
-- Page ID authorize? Mirrors app.org_id_for_form_token() exactly
-- (20260822080000_website_lead_form_token) — SECURITY DEFINER + fixed
-- search_path so it can read org_meta_credentials regardless of that
-- table's own RLS (anon otherwise has zero access — see above). Reads a
-- session-local GUC, "request.meta_page_id", set by
-- withAnonMetaWebhookContext (src/lib/db.server.ts), only ever after the
-- webhook handler has verified Meta's HMAC signature.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.org_id_for_meta_page()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  raw_page_id TEXT;
  found_org_id UUID;
BEGIN
  raw_page_id := NULLIF(current_setting('request.meta_page_id', true), '');

  IF raw_page_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT org_id INTO found_org_id
  FROM public.org_meta_credentials
  WHERE meta_page_id = raw_page_id;

  RETURN found_org_id; -- NULL when nothing matches — never an error.
END;
$$;

GRANT EXECUTE ON FUNCTION app.org_id_for_meta_page() TO anon;

-- ============================================================================
-- Fetches a known org's Page access token, for the webhook handler's Graph
-- API call — called directly by application code (never inside an RLS
-- policy), after app.org_id_for_meta_page() has already resolved org_id.
-- Its own SECURITY DEFINER function rather than a SELECT grant on
-- org_meta_credentials, so anon's access stays limited to exactly this one
-- read shape (by org_id, not an open SELECT).
-- ============================================================================

CREATE OR REPLACE FUNCTION app.meta_page_access_token_for_org(target_org_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT meta_page_access_token
  FROM public.org_meta_credentials
  WHERE org_id = target_org_id;
$$;

GRANT EXECUTE ON FUNCTION app.meta_page_access_token_for_org(UUID) TO anon;


-- ============================================================================
-- anon INSERT policies for the webhook's own writes — additive, doesn't
-- touch the existing form-token policies from
-- 20260822080000_website_lead_form_token. Postgres allows multiple
-- permissive policies for the same command; a row is permitted if ANY of
-- them passes. Same "createMany, no RETURNING" requirement applies (see
-- src/lib/meta-lead-ads/webhook-handler.ts) — anon still has no SELECT
-- policy on contacts/leads.
-- ============================================================================

CREATE POLICY "meta webhook can create contacts"
  ON public.contacts FOR INSERT
  TO anon
  WITH CHECK (org_id = app.org_id_for_meta_page());

CREATE POLICY "meta webhook can create leads"
  ON public.leads FOR INSERT
  TO anon
  WITH CHECK (org_id = app.org_id_for_meta_page());
```

- [ ] **Step 6: Apply the migration to the local test database**

Run: `bun run test:db:setup`
Expected: succeeds, ending with the new migration folder listed as applied. Requires `TEST_DATABASE_URL` pointing at a throwaway local Postgres — if unset, the script throws with instructions (see `scripts/apply-test-schema.ts`).

- [ ] **Step 7: Write `src/lib/meta-lead-ads.server.ts`**

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";

const setMetaPageCredentialsSchema = z.object({
  metaPageId: z.string().min(1),
  metaPageAccessToken: z.string().min(1),
});

/**
 * Admin-only — RLS gates this via org_meta_credentials' write policies
 * (app.is_org_admin), same shape as createTemplate in whatsapp.server.ts.
 * No app-level role check needed; a non-admin's upsert is simply rejected
 * by Postgres. No UI yet (issue #24) — callable directly until an admin
 * settings screen exists.
 */
export const setMetaPageCredentials = createServerFn({ method: "POST" })
  .validator(setMetaPageCredentialsSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.orgMetaCredential.upsert({
        where: { orgId },
        create: {
          orgId,
          metaPageId: data.metaPageId,
          metaPageAccessToken: data.metaPageAccessToken,
        },
        update: {
          metaPageId: data.metaPageId,
          metaPageAccessToken: data.metaPageAccessToken,
        },
      }),
    );
  });
```

- [ ] **Step 8: Write the failing RLS tests**

In `tests/tenant-isolation.test.ts`, add a new helper right after `asAnonWithFormToken` (around line 68):

```ts
/**
 * Same idea, for the Meta Lead Ads webhook's anon write path (issue #24).
 * Sets a "request.meta_page_id" GUC, which app.org_id_for_meta_page()
 * (prisma/migrations/20260826000000_meta_lead_ads_webhook) reads to
 * resolve which org, if any, this Page ID authorizes an INSERT into.
 * Mirrors withAnonMetaWebhookContext in src/lib/db.server.ts exactly.
 */
async function asAnonWithMetaPage<T>(pageId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
    await tx.$executeRawUnsafe(`SET LOCAL "request.meta_page_id" TO '${pageId}'`);
    return fn(tx);
  });
}
```

Then, at the end of the file (after the WhatsApp `describe` block), add:

```ts
// Regression tests for 20260826000000_meta_lead_ads_webhook and
// src/lib/meta-lead-ads.server.ts / webhook-handler.ts — issue #24.
describe("org_meta_credentials — admin-only", () => {
  const orgAMetaPageId = `meta-page-a-${run}`;

  it("an org admin CAN create their org's meta credentials", async () => {
    const created = await asUser(userA.id, (tx) =>
      tx.orgMetaCredential.create({
        data: { orgId: orgA.id, metaPageId: orgAMetaPageId, metaPageAccessToken: "secret-token-a" },
      }),
    );
    expect(created.orgId).toBe(orgA.id);
  });

  it("a non-admin CANNOT create meta credentials, even in their own org", async () => {
    await expect(
      asUser(agentX.id, (tx) =>
        tx.orgMetaCredential.create({
          data: { orgId: orgA.id, metaPageId: `rejected-${run}`, metaPageAccessToken: "nope" },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a non-admin CANNOT read meta credentials, even in their own org", async () => {
    const seen = await asUser(agentX.id, (tx) => tx.orgMetaCredential.findMany());
    expect(seen).toHaveLength(0);
  });

  it("an org admin can read their own org's meta credentials, not another org's", async () => {
    await asUser(userB.id, (tx) =>
      tx.orgMetaCredential.create({
        data: { orgId: orgB.id, metaPageId: `meta-page-b-${run}`, metaPageAccessToken: "secret-token-b" },
      }),
    );

    const seenByA = await asUser(userA.id, (tx) => tx.orgMetaCredential.findMany());
    expect(seenByA.map((c) => c.orgId)).toEqual([orgA.id]);
  });

  it("anon has zero access to meta credentials", async () => {
    const seen = await asAnon((tx) => tx.orgMetaCredential.findMany());
    expect(seen).toHaveLength(0);
  });
});

describe("meta lead ads webhook — anon page-id write path", () => {
  const orgAMetaPageId = `meta-page-a-${run}`;

  // org_meta_credentials.org_id is a primary key — one row per org, so
  // this can't create a second row alongside the "org_meta_credentials —
  // admin-only" describe block above (which may or may not have run yet,
  // depending on file order). upsert makes this block self-sufficient
  // either way: idempotent whether that row already exists or not, so
  // this block's tests don't depend on sibling-describe execution order.
  // Seeded directly via the base prisma client (bypasses RLS), same as
  // the outer file's beforeAll seeding orgA/contactA/leadA.
  beforeAll(async () => {
    await prisma.orgMetaCredential.upsert({
      where: { orgId: orgA.id },
      create: { orgId: orgA.id, metaPageId: orgAMetaPageId, metaPageAccessToken: "webhook-test-token" },
      update: { metaPageId: orgAMetaPageId, metaPageAccessToken: "webhook-test-token" },
    });
  });

  it("a valid page id can create a contact + lead in its own org", async () => {
    const metaContactId = randomUUID();
    const metaLeadId = randomUUID();

    await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.contact.createMany({
        data: [{ id: metaContactId, orgId: orgA.id, fullName: "Meta Lead", phone: "9999999999" }],
      }),
    );
    await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.lead.createMany({
        data: [
          {
            id: metaLeadId,
            orgId: orgA.id,
            contactId: metaContactId,
            source: "Meta Lead Ads",
            platformLeadId: `leadgen-${run}-1`,
          },
        ],
      }),
    );

    const contact = await asUser(userA.id, (tx) =>
      tx.contact.findUniqueOrThrow({ where: { id: metaContactId } }),
    );
    expect(contact.orgId).toBe(orgA.id);

    const lead = await asUser(userA.id, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: metaLeadId } }),
    );
    expect(lead.orgId).toBe(orgA.id);
    expect(lead.platformLeadId).toBe(`leadgen-${run}-1`);
  });

  it("an unknown page id creates nothing — rejected, not silently attributed anywhere", async () => {
    await expect(
      asAnonWithMetaPage(`unknown-page-${run}`, (tx) =>
        tx.contact.create({ data: { orgId: orgA.id, fullName: "Should never exist" } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("org A's page id can never create data attributed to org B", async () => {
    await expect(
      asAnonWithMetaPage(orgAMetaPageId, (tx) =>
        tx.contact.create({ data: { orgId: orgB.id, fullName: "Cross-org attempt" } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a retried leadgen_id does not create a second lead (skipDuplicates)", async () => {
    const firstContactId = randomUUID();
    const firstLeadId = randomUUID();
    const leadgenId = `leadgen-${run}-retry`;

    await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.contact.createMany({ data: [{ id: firstContactId, orgId: orgA.id, fullName: "First Attempt" }] }),
    );
    await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.lead.createMany({
        data: [{ id: firstLeadId, orgId: orgA.id, contactId: firstContactId, platformLeadId: leadgenId }],
        skipDuplicates: true,
      }),
    );

    // Simulated retry: same leadgen_id, different generated row ids — a
    // fresh webhook delivery wouldn't know the first attempt's ids.
    const retryContactId = randomUUID();
    const retryLeadId = randomUUID();
    await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.contact.createMany({ data: [{ id: retryContactId, orgId: orgA.id, fullName: "Retry Attempt" }] }),
    );
    await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.lead.createMany({
        data: [{ id: retryLeadId, orgId: orgA.id, contactId: retryContactId, platformLeadId: leadgenId }],
        skipDuplicates: true,
      }),
    );

    const matchingLeads = await asUser(userA.id, (tx) =>
      tx.lead.findMany({ where: { platformLeadId: leadgenId } }),
    );
    expect(matchingLeads).toHaveLength(1);
    expect(matchingLeads[0]?.id).toBe(firstLeadId);
  });

  it("a valid page id grants INSERT only on contacts — never SELECT, UPDATE, or DELETE", async () => {
    const seen = await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.contact.findMany({ where: { orgId: orgA.id } }),
    );
    expect(seen).toHaveLength(0);

    const updated = await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.contact.updateMany({ where: { orgId: orgA.id }, data: { fullName: "Hijacked" } }),
    );
    expect(updated.count).toBe(0);

    const deleted = await asAnonWithMetaPage(orgAMetaPageId, (tx) =>
      tx.contact.deleteMany({ where: { orgId: orgA.id } }),
    );
    expect(deleted.count).toBe(0);
  });
});
```

- [ ] **Step 9: Run the tests to verify they fail correctly before Step 5/7 code exists**

(If Steps 5–7 above are already done by the time this is run, skip this verification — it only matters if you're executing steps out of order.)

Run: `bun run test tests/tenant-isolation.test.ts`
Expected: FAIL — `tx.orgMetaCredential` doesn't exist yet on the Prisma client, or the migration hasn't been applied. Confirms the tests actually exercise new code.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `bun run test tests/tenant-isolation.test.ts`
Expected: PASS — all new `it(...)` blocks green, full file still green (no regressions in the ~135 existing tests).

- [ ] **Step 11: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260826000000_meta_lead_ads_webhook src/lib/meta-lead-ads.server.ts tests/tenant-isolation.test.ts
git commit -m "Add org_meta_credentials table + anon webhook write path (issue #24)

Admin-only credentials table (Page ID + access token), keyed lookup via
a SECURITY DEFINER function mirroring the website lead form's token
pattern, and the anon-role INSERT policies the webhook handler will use."
```

---

### Task 2: `MetaLeadAdsProvider` seam

**Files:**
- Create: `src/lib/meta-lead-ads/provider.ts`
- Create: `src/lib/meta-lead-ads/mock-provider.ts`

**Interfaces:**
- Produces: `MetaLeadAdsProvider` interface, `MockMetaLeadAdsProvider` class — both consumed by Task 4's `webhook-handler.ts`.
- Consumes: nothing.

No dedicated test — this mirrors `src/lib/whatsapp/provider.ts` + `mock-provider.ts` exactly, which also have no test file in this codebase (trivial, no branching logic to break).

- [ ] **Step 1: Write `src/lib/meta-lead-ads/provider.ts`**

```ts
/**
 * Vendor-blocked (issue #24): no real Meta Graph API access exists yet.
 * This interface is the seam — the real call
 * (`GET /{leadgen-id}?access_token=...`) behind a swap-in implementation,
 * so wiring one up later is a single file (and a single import in
 * src/lib/meta-lead-ads/webhook-handler.ts), not a rewrite.
 */
export interface MetaLeadAdsProvider {
  fetchLeadFields(
    leadgenId: string,
    pageAccessToken: string,
  ): Promise<{ fullName: string; phone: string | null; email: string | null }>;
}
```

- [ ] **Step 2: Write `src/lib/meta-lead-ads/mock-provider.ts`**

```ts
import type { MetaLeadAdsProvider } from "./provider";

/**
 * Stand-in until a real Meta Graph API access token exists. No network
 * call — logs and resolves instantly with deterministic fake field data,
 * keyed off leadgenId. This is the one actually wired up in
 * src/lib/meta-lead-ads/webhook-handler.ts today.
 */
export class MockMetaLeadAdsProvider implements MetaLeadAdsProvider {
  async fetchLeadFields(
    leadgenId: string,
    pageAccessToken: string,
  ): Promise<{ fullName: string; phone: string | null; email: string | null }> {
    console.log(
      `[MockMetaLeadAdsProvider] fetching fields for leadgen ${leadgenId} ` +
        `(token ${pageAccessToken.slice(0, 6)}...)`,
    );
    return {
      fullName: `Mock Meta Lead ${leadgenId.slice(0, 8)}`,
      phone: "9999999999",
      email: null,
    };
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/meta-lead-ads/provider.ts src/lib/meta-lead-ads/mock-provider.ts
git commit -m "Add MetaLeadAdsProvider seam + mock implementation (issue #24)

Same swap-in-later pattern as WhatsAppProvider/SmsProvider/EmailProvider —
one interface, one mock, one documented line to change once real Meta
Graph API access exists."
```

---

### Task 3: HMAC signature verification

**Files:**
- Create: `src/lib/meta-lead-ads/verify-signature.ts`
- Test: `tests/meta-lead-ads-verify-signature.test.ts`

**Interfaces:**
- Produces: `verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean` — consumed by Task 4's `webhook-handler.ts`.
- Consumes: `node:crypto` (stdlib).

- [ ] **Step 1: Write the failing tests**

Create `tests/meta-lead-ads-verify-signature.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "../src/lib/meta-lead-ads/verify-signature";

const SECRET = "test-app-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyMetaSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ entry: [] });
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ entry: [] });
    const signature = sign(body);
    const tampered = JSON.stringify({ entry: ["injected"] });
    expect(verifyMetaSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = JSON.stringify({ entry: [] });
    expect(verifyMetaSignature(body, sign(body, "wrong-secret"), SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyMetaSignature("{}", null, SECRET)).toBe(false);
  });

  it("rejects a malformed signature header (no sha256= prefix)", () => {
    expect(verifyMetaSignature("{}", "not-a-valid-header", SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test tests/meta-lead-ads-verify-signature.test.ts`
Expected: FAIL — `verify-signature.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Write `src/lib/meta-lead-ads/verify-signature.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Meta's X-Hub-Signature-256 header: HMAC-SHA256 of the raw
 * request body, keyed with the app secret, hex-encoded and prefixed
 * "sha256=" (Meta's documented format). This is what proves a webhook
 * request actually came from Meta — see
 * docs/specs/07-meta-lead-ads-webhook.md.
 *
 * Takes the raw body string (not parsed JSON) — signature verification
 * must happen over the exact bytes Meta signed, before any JSON.parse.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");

  // Different lengths would make timingSafeEqual throw rather than return
  // false — reject up front instead of catching.
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test tests/meta-lead-ads-verify-signature.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/meta-lead-ads/verify-signature.ts tests/meta-lead-ads-verify-signature.test.ts
git commit -m "Add Meta webhook HMAC signature verification (issue #24)

Pure function, node:crypto only — proves a webhook request genuinely
came from Meta before any DB context is ever set up for it."
```

---

### Task 4: `withAnonMetaWebhookContext` + the webhook handler

**Files:**
- Modify: `src/lib/db.server.ts`
- Create: `src/lib/meta-lead-ads/webhook-handler.ts`
- Test: `tests/meta-lead-ads-webhook-handler.test.ts`

**Interfaces:**
- Consumes: `verifyMetaSignature` (Task 3), `MetaLeadAdsProvider`/`MockMetaLeadAdsProvider` (Task 2), `Tx` type + `prisma` export (existing, `db.server.ts`).
- Produces: `withAnonMetaWebhookContext<T>(pageId: string, fn: (tx: Tx) => Promise<T>): Promise<T>` (consumed only within this task's own file), `handleMetaLeadsWebhook(request: Request): Promise<Response>` — consumed by Task 5's `src/server.ts`.

- [ ] **Step 1: Edit `src/lib/db.server.ts` — add `withAnonMetaWebhookContext`**

After `withAnonFormContext` (the function ending at line 102), add:

```ts

/**
 * Same idea, for the Meta Lead Ads webhook's anon write path (issue #24).
 * Sets a "request.meta_page_id" GUC — exactly parallel to
 * withAnonFormContext's "request.form_token" — which
 * app.org_id_for_meta_page() (added in
 * prisma/migrations/20260826000000_meta_lead_ads_webhook) reads to decide
 * which org's contacts/leads, if any, this Page ID may INSERT into.
 *
 * Unlike withAnonFormContext, pageId is NOT itself a secret — the caller
 * (src/lib/meta-lead-ads/webhook-handler.ts) only calls this after
 * verifying Meta's HMAC signature over the whole request, which is what
 * actually proves the request (and its page_id) is genuine. See
 * docs/specs/07-meta-lead-ads-webhook.md.
 */
export async function withAnonMetaWebhookContext<T>(
  pageId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
      // pageId is Meta's own external Page ID (not a UUID, so no UUID_RE
      // check applies here the way it does for formToken/userId above) —
      // still escape single quotes defensively before string-interpolating
      // into raw SQL (SET LOCAL doesn't support bind parameters).
      const escaped = pageId.replace(/'/g, "''");
      await tx.$executeRawUnsafe(`SET LOCAL "request.meta_page_id" TO '${escaped}'`);
      return fn(tx);
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
  );
}
```

- [ ] **Step 2: Write the failing handler tests (non-DB-touching paths only)**

Create `tests/meta-lead-ads-webhook-handler.test.ts`:

```ts
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
```

Every case above either rejects before any DB access (bad/missing signature, wrong verify token, malformed JSON) or has an empty/non-matching payload that never reaches `processLeadgenChange` — none of them exercise `withAnonMetaWebhookContext`, so this file never needs `TEST_DATABASE_URL`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run test tests/meta-lead-ads-webhook-handler.test.ts`
Expected: FAIL — `webhook-handler.ts` doesn't exist yet.

- [ ] **Step 4: Write `src/lib/meta-lead-ads/webhook-handler.ts`**

```ts
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
      SELECT app.meta_page_access_token_for_org(${orgId}::uuid) AS token
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test tests/meta-lead-ads-webhook-handler.test.ts`
Expected: PASS — all 8 cases green.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `bun run test`
Expected: PASS — every existing test still green, plus this task's new ones.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db.server.ts src/lib/meta-lead-ads/webhook-handler.ts tests/meta-lead-ads-webhook-handler.test.ts
git commit -m "Add withAnonMetaWebhookContext + the webhook handler (issue #24)

GET handles Meta's verification handshake; POST verifies the HMAC
signature, resolves org via the anon+SECURITY DEFINER path from the
previous commit, fetches field data through the mock provider, and
writes idempotently. Handler's control flow is unit-tested directly;
its DB-writing branch is covered by tenant-isolation.test.ts instead
(see this plan's File Structure note on why)."
```

---

### Task 5: Wire the route + env vars

**Files:**
- Modify: `src/server.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `handleMetaLeadsWebhook` (Task 4).

- [ ] **Step 1: Edit `src/server.ts` — import the handler**

At the top of the file, after the existing imports:

```ts
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleMetaLeadsWebhook } from "./lib/meta-lead-ads/webhook-handler";
```

- [ ] **Step 2: Edit `src/server.ts` — route the webhook path before SSR delegation**

Change the exported `fetch`:

```ts
export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    if (url.pathname === "/api/webhooks/meta-leads") {
      return handleMetaLeadsWebhook(request);
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
```

Everything else in the file (`getServerEntry`, `normalizeCatastrophicSsrResponse`, `isH3SwallowedErrorBody`) is unchanged.

- [ ] **Step 3: Add the new env vars to `.env.example`**

Append (near the other integration-style vars, or at the end):

```
# Meta Lead Ads webhook (issue #24) — app-level, one Meta App per
# deployment. Per-org Page ID + access token live in the
# org_meta_credentials table instead (set via setMetaPageCredentials).
META_APP_SECRET="<meta-app-secret>"
META_WEBHOOK_VERIFY_TOKEN="<any-string-you-choose-and-enter-in-meta-app-dashboard>"
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Run the full test suite**

Run: `bun run test`
Expected: PASS — no regressions from the routing change (existing SSR paths are untouched; the new branch only fires for the exact webhook pathname).

- [ ] **Step 6: Manual smoke test against the dev server**

No real Meta account exists to test against end-to-end, so this is a manual `curl` check that the route is actually wired up:

```bash
bun run dev &
sleep 3
export META_APP_SECRET="local-test-secret"
export META_WEBHOOK_VERIFY_TOKEN="local-test-token"
curl -s "http://localhost:3000/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=local-test-token&hub.challenge=hello"
# Expected output: hello
BODY='{"entry":[]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //')"
curl -s -X POST "http://localhost:3000/api/webhooks/meta-leads" \
  -H "x-hub-signature-256: $SIG" -H "content-type: application/json" -d "$BODY"
# Expected output: EVENT_RECEIVED
```

(Adjust the port/env-loading if the dev server reads `.env` differently in your setup — the point is confirming both branches respond as designed, not exercising the DB-writing path, which is already covered by Task 1's tests.)

- [ ] **Step 7: Commit**

```bash
git add src/server.ts .env.example
git commit -m "Wire /api/webhooks/meta-leads into the custom server entry (issue #24)

Routes the webhook path before TanStack's SSR delegation, since this
version of TanStack Start has no file-based server-route API. Adds the
two app-level env vars the handler reads."
```

---

## Review flag

This entire feature is a second unauthenticated-writable path into `contacts`/`leads` (the first being the public website lead-capture form), and it adds a new admin-only-readable credentials table storing a third-party bearer token. Per CLAUDE.md's review gates, **this needs explicit human review before merging to `main`** — the RLS policies in Task 1's migration especially, since that's the actual tenancy boundary. Applying the migration to the real Mumbai Supabase DB is a separate, later, explicitly-approved step — not part of this plan.
