// Proves the RLS-based multi-tenancy boundary: two orgs, two users, and a
// user from org B must get zero rows — not an error, not org A's data —
// when reading anything scoped to org A. See docs/specs/00-overview.md.
//
// Runs only against a throwaway local/CI Postgres bootstrapped via
// prisma/test-bootstrap.sql + prisma/migrations (see scripts/apply-test-schema.ts).
// Never against the real Supabase project — guarded below.
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Run scripts/apply-test-schema.ts against a throwaway " +
      "Postgres instance first, then point TEST_DATABASE_URL at it.",
  );
}
if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must not equal DATABASE_URL — refusing to run tenant-isolation tests " +
      "against what looks like the real Supabase project.",
  );
}

const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });

type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` inside a transaction with the Postgres session set up exactly
 * the way a real authenticated Supabase request is: ROLE authenticated,
 * plus a request.jwt.claims GUC whose "sub" is userId — which is what the
 * real auth.uid() (and our test-bootstrap.sql stand-in) reads. SET LOCAL is
 * transaction-scoped, so this must all happen in one transaction.
 */
async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
    await tx.$executeRawUnsafe(
      `SET LOCAL "request.jwt.claims" TO '${JSON.stringify({ sub: userId, role: "authenticated" })}'`,
    );
    return fn(tx);
  });
}

/** Same idea, but for a fully unauthenticated request (no resolvable user). */
async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
    return fn(tx);
  });
}

const run = randomUUID().slice(0, 8);

const orgA = { id: randomUUID(), name: "Org A Realty", slug: `org-a-${run}` };
const orgB = { id: randomUUID(), name: "Org B Realty", slug: `org-b-${run}` };
const userA = { id: randomUUID(), email: `user-a-${run}@example.com` };
const userB = { id: randomUUID(), email: `user-b-${run}@example.com` };

beforeAll(async () => {
  // Seeded as the connection's base role (postgres superuser in the test
  // container), which bypasses RLS — the equivalent of the one audited
  // service-role admin path in real Supabase.
  await prisma.$executeRawUnsafe(
    `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2), ($3::uuid, $4)`,
    userA.id,
    userA.email,
    userB.id,
    userB.email,
  );

  await prisma.organization.createMany({ data: [orgA, orgB] });

  await prisma.orgMember.createMany({
    data: [
      { orgId: orgA.id, userId: userA.id, role: "owner" },
      { orgId: orgB.id, userId: userB.id, role: "owner" },
    ],
  });
});

afterAll(async () => {
  // auth.users FK is ON DELETE CASCADE into public.users/org_members.
  await prisma.$executeRawUnsafe(
    `DELETE FROM auth.users WHERE id IN ($1::uuid, $2::uuid)`,
    userA.id,
    userB.id,
  );
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

describe("tenant isolation", () => {
  it("lets a user see their own org, not the other org", async () => {
    const seenByA = await asUser(userA.id, (tx) => tx.organization.findMany());
    expect(seenByA.map((o) => o.id)).toEqual([orgA.id]);

    const seenByB = await asUser(userB.id, (tx) => tx.organization.findMany());
    expect(seenByB.map((o) => o.id)).toEqual([orgB.id]);
  });

  it("returns zero rows, not an error, for a direct lookup of another org's row", async () => {
    const result = await asUser(userB.id, (tx) =>
      tx.organization.findUnique({ where: { id: orgA.id } }),
    );
    expect(result).toBeNull();
  });

  it("isolates org_members the same way", async () => {
    const seenByB = await asUser(userB.id, (tx) => tx.orgMember.findMany());
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]?.orgId).toBe(orgB.id);

    const crossOrgLookup = await asUser(userB.id, (tx) =>
      tx.orgMember.findMany({ where: { orgId: orgA.id } }),
    );
    expect(crossOrgLookup).toHaveLength(0);
  });

  it("isolates the users table — a user cannot see a stranger from another org", async () => {
    const seenByA = await asUser(userA.id, (tx) => tx.user.findMany());
    const idsSeenByA = seenByA.map((u) => u.id);
    expect(idsSeenByA).toContain(userA.id);
    expect(idsSeenByA).not.toContain(userB.id);
  });

  it("returns zero rows for a fully unauthenticated (anon) request", async () => {
    const orgs = await asAnon((tx) => tx.organization.findMany());
    const members = await asAnon((tx) => tx.orgMember.findMany());
    const users = await asAnon((tx) => tx.user.findMany());

    expect(orgs).toHaveLength(0);
    expect(members).toHaveLength(0);
    expect(users).toHaveLength(0);
  });

  it("returns zero rows for an authenticated request with no resolvable membership", async () => {
    // authenticated role, but auth.uid() has nothing to resolve — a user
    // with a valid session and zero org memberships.
    const orphanId = randomUUID();
    const orgs = await asUser(orphanId, (tx) => tx.organization.findMany());
    expect(orgs).toHaveLength(0);
  });
});
