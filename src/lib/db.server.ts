import { PrismaClient, type Prisma } from "@prisma/client";

// DATABASE_URL connects as app_user (see prisma/migrations/*_app_role) — a
// non-superuser role that is a member of `authenticated` and `anon` only,
// never `service_role`. It has no direct table grants; every query below
// explicitly SET LOCAL ROLEs into one of those two before touching any
// tenant table, which is what makes RLS actually apply to real app queries
// instead of just to prisma/schema.prisma's own migration connection.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` with the Postgres session set up the way a real authenticated
 * Supabase request is: ROLE authenticated + request.jwt.claims resolving
 * auth.uid() to `userId`. userId must come from a verified Supabase session
 * (supabase.auth.getUser()/getClaims() server-side) — never from a raw,
 * unverified client-supplied value. Mirrors tests/tenant-isolation.test.ts
 * exactly, since that's what proved this pattern actually enforces RLS.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prisma's interactive-transaction default is 5000ms (maxWait 2000ms) —
// tuned for a same-region app-to-DB hop, not a pooled connection over a
// slow/high-latency path (a VPN, a distant Supabase region, campus wifi).
// Under those conditions the *query* isn't actually hanging — the round
// trips just legitimately take longer than 5s cumulative — so Prisma's own
// bookkeeping aborted a transaction that would otherwise have finished,
// surfacing as "Transaction already closed" rather than any RLS or query
// bug. This is generous on purpose: it should never be the thing that
// fails on a normal connection, only ever a backstop against a truly
// hung query.
const TRANSACTION_TIMEOUT_MS = 20_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export async function withUserContext<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  // userId is string-interpolated into raw SQL below (SET LOCAL doesn't
  // support bind parameters). Supabase's auth.uid() is always a UUID, so
  // this is a correctness guard as much as a safety one — anything that
  // fails this was never a valid user id to begin with.
  if (!UUID_RE.test(userId)) {
    throw new Error(`withUserContext: "${userId}" is not a valid UUID`);
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
      await tx.$executeRawUnsafe(
        `SET LOCAL "request.jwt.claims" TO '${JSON.stringify({ sub: userId, role: "authenticated" })}'`,
      );
      return fn(tx);
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
  );
}

/** Same idea, for a request with no authenticated user. */
export async function withAnonContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
      return fn(tx);
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
  );
}

/**
 * Same idea, for the one anon path that's allowed to *write*: the public
 * website lead-capture form (issue #22). Sets a "request.form_token" GUC —
 * exactly parallel to how withUserContext sets "request.jwt.claims" for
 * auth.uid() — which app.org_id_for_form_token() (added in
 * prisma/migrations/20260822080000_website_lead_form_token) reads to decide
 * which org's contacts/leads, if any, this token may INSERT into. See that
 * migration for why organizations.id/slug can't be used for this instead.
 *
 * formToken must already be Zod-validated as a UUID by the caller; the
 * regex check here is defense in depth against SQL injection, same reason
 * withUserContext checks userId — SET LOCAL doesn't support bind params, so
 * this value is string-interpolated into raw SQL below.
 */
export async function withAnonFormContext<T>(
  formToken: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(formToken)) {
    throw new Error(`withAnonFormContext: "${formToken}" is not a valid UUID`);
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
      await tx.$executeRawUnsafe(`SET LOCAL "request.form_token" TO '${formToken}'`);
      return fn(tx);
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
  );
}

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
