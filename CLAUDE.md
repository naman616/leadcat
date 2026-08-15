# Working rules for this repo (LeadCat CRM)

These rules are binding. If a task seems to require breaking one of
them, stop and ask rather than working around it.

## Stack — do not change without discussing first

- Frontend: TanStack Start (React 19, TanStack Router, TanStack Query)
- Styling: Tailwind v4 + Radix/shadcn
- Package manager: **bun** (not npm/pnpm/yarn — this repo has a `bun.lock`)
- Backend/API: TanStack Start server functions (`createServerFn`), Zod
  for all input validation
- Database + Auth + Storage + Realtime: Supabase
- ORM: Prisma
- Background jobs: none yet. Flag if a feature seems to need one —
  don't reach for Inngest or any queue prematurely.

This is **TanStack Start on Supabase, not Next.js.** Don't introduce
Next.js patterns (`app/` router conventions, `next/*` imports,
Next-specific auth helpers) or suggest migrating frameworks.

## Multi-tenancy and RLS — non-negotiable

- Every tenant-scoped table has `org_id UUID NOT NULL` and Row Level
  Security **enabled**, from the migration that creates it.
- Never write a query that bypasses RLS (e.g. via the Supabase service
  role key) outside of a single, clearly audited admin path.
- Never disable RLS "temporarily" to make a bug go away. If RLS is
  blocking something, the policy or the calling context is wrong —
  fix that, don't turn off the guard.
- A query issued without correct org context must return **zero
  rows**, never an error and never another tenant's data.

## Prisma connection strings

- The app **always** uses the pooled connection string
  (`DATABASE_URL`, pgbouncer, port 6543) at runtime.
- Migrations **always** use the direct connection string
  (`DIRECT_URL`, port 5432).
- Never swap these. Using the direct string at runtime causes
  connection exhaustion under load — it looks like "Supabase is slow"
  but is actually this misconfiguration.
- `DIRECT_URL` is the **Session Pooler** (pooler host, port 5432), not
  the dashboard's literal "Direct connection" host
  (`db.<ref>.supabase.co`). That host is IPv6-only since Jan 2024 and
  fails with Prisma error P1001 ("Can't reach database server") on
  any IPv4-only network — which is most home/ISP connections. Don't
  "fix" a P1001 on `DIRECT_URL` by switching to the literal direct
  host; that's the thing that doesn't work here.
- `DATABASE_URL` authenticates as `app_user` (see
  `prisma/migrations/*_app_role`), **never** `postgres`. `postgres` is
  a superuser and bypasses RLS unconditionally — if the app's Prisma
  connection ever authenticates as `postgres`, every RLS policy in
  this project becomes dead code for real requests, silently. This is
  the single easiest way to defeat the entire tenancy model without
  any error or warning, so treat any PR that touches `DATABASE_URL`'s
  role as tenancy-critical (see Review gates below).
- Every query that touches a tenant table must go through
  `withUserContext`/`withAnonContext` in `src/lib/db.server.ts` (or
  their equivalent), which `SET LOCAL ROLE authenticated`/`anon` +
  the caller's verified JWT claims before querying. A raw
  `prisma.<model>.findMany()` call outside one of these — using the
  shared `prisma` export directly — runs as `app_user` with no role
  switched, which has no table grants of its own and will simply
  fail, not silently bypass RLS. That failure is the intended
  guardrail; fix the call site to go through the wrapper rather than
  finding a way around it.
- `service_role` (the one RLS bypass — see Multi-tenancy above) is
  only ever reached via `src/lib/supabase/admin.server.ts`, which uses
  the Supabase JS client with the service-role key, **not** Prisma.
  `app_user` is deliberately not a member of the `service_role`
  Postgres role, so this isn't just convention — Prisma queries
  structurally cannot escalate to it even if code tried.

## Review gates

- Auth, tenancy, and billing code must be flagged for explicit human
  review before merging, even when tests pass.
- New DB migrations are proposed, never auto-applied to anything but
  a local/dev database. Applying a migration to a shared or production
  database requires explicit sign-off.

## Code conventions

- Use existing shadcn/Radix components in `src/components/ui` before
  creating new ones.
- Ask before adding new dependencies.
- Don't introduce a new state-management library — TanStack Query
  (server state) plus component-local `useState` is the pattern here.
