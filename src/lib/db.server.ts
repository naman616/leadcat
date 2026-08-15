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

export async function withUserContext<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  // userId is string-interpolated into raw SQL below (SET LOCAL doesn't
  // support bind parameters). Supabase's auth.uid() is always a UUID, so
  // this is a correctness guard as much as a safety one — anything that
  // fails this was never a valid user id to begin with.
  if (!UUID_RE.test(userId)) {
    throw new Error(`withUserContext: "${userId}" is not a valid UUID`);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
    await tx.$executeRawUnsafe(
      `SET LOCAL "request.jwt.claims" TO '${JSON.stringify({ sub: userId, role: "authenticated" })}'`,
    );
    return fn(tx);
  });
}

/** Same idea, for a request with no authenticated user. */
export async function withAnonContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
    return fn(tx);
  });
}
