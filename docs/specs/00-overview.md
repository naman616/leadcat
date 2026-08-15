# 00 — Foundations: Multi-Tenancy & Auth

Status: Phase 0 (this session). Scope: `organizations`, `users`,
`org_members` only. Leads, contacts, inventory, pipeline are explicitly
out of scope here — they land in Phase 1 on top of this foundation.

## Why this exists

Every feature we build after this session — leads, contacts,
inventory, invoices — lives inside an organization and must never be
visible to a different organization. Getting that boundary right once,
enforced at the database level, is cheaper than retrofitting it after
there's real data and paying customers. This doc is the shared
reference for that boundary so future sessions build against it
instead of re-deriving it.

## Core entities

### `organizations`

One row per tenant (a brokerage, a developer's sales org, a channel
partner firm). Everything tenant-scoped hangs off `org_id`.

| column       | type        | notes                              |
| ------------ | ----------- | ----------------------------------- |
| `id`         | uuid, pk    | `gen_random_uuid()`                 |
| `name`       | text        | display name                        |
| `slug`       | text unique | url-safe identifier, for future use |
| `created_at` | timestamptz | default now()                       |

### `users`

A **mirror** of `auth.users` (Supabase Auth owns the real identity —
email, password hash, session tokens). We don't duplicate credentials
here; this table exists so we have a first-class row to attach
application data (name, avatar, etc.) to and to join against from
other tables without reaching into the `auth` schema everywhere.

| column       | type        | notes                                   |
| ------------ | ----------- | ---------------------------------------- |
| `id`         | uuid, pk    | **same value as** `auth.users.id`        |
| `email`      | text        | denormalized copy, kept in sync on signup |
| `full_name`  | text        | nullable, user-editable                  |
| `created_at` | timestamptz | default now()                            |

A user can belong to **more than one organization** (e.g. a channel
partner agent who works with two developers), so org membership is
its own table rather than a column on `users`.

### `org_members`

The join table that answers "which orgs does this user belong to, and
with what role." This is also where RLS gets its answer to "what's
this caller's org_id" from.

| column       | type        | notes                                       |
| ------------ | ----------- | -------------------------------------------- |
| `id`         | uuid, pk    | `gen_random_uuid()`                          |
| `org_id`     | uuid, fk    | → `organizations.id`                         |
| `user_id`    | uuid, fk    | → `users.id`                                 |
| `role`       | enum        | see below                                    |
| `created_at` | timestamptz | default now()                                |

Unique constraint on `(org_id, user_id)` — a user has exactly one role
per org.

### Role enum

```
owner     — full control of the org, including billing (later) and member management
admin     — manages users, config, and all data within the org
agent     — sales rep; own leads + whatever the org's assignment rules expose
cp_admin  — channel partner admin; manages their CP's own agents and sees only their CP's attributed leads
cp_agent  — channel partner agent; sees only their own leads
```

This mirrors the RBAC note in the build plan: *"a CP admin must never
see another CP's leads."* The five roles above are what future RLS
policies (Phase 1+) will branch on once `leads`/`contacts` exist. This
session only needs the enum to exist and be attached to
`org_members.role` — no policy yet depends on the distinction between
`agent` and `cp_agent` because there's no lead data yet.

## Multi-tenancy enforcement

Rule, from `CLAUDE.md`: **every tenant-scoped table has `org_id UUID
NOT NULL`, and RLS is enabled from the migration that creates the
table** — not added later. `org_members` and any future tenant table
(`leads`, `contacts`, ...) follow this from day one, even before they
have real product logic.

Enforcement mechanism — refined while writing the actual migration SQL
from the scalar-`current_org_id()` sketch above to a set-membership
check, because it handles multi-org users correctly with no extra
session state and is the pattern Supabase's own docs recommend:

1. Three `SECURITY DEFINER` helper functions in a dedicated `app`
   schema (not `public`, so PostgREST doesn't expose them as RPC
   endpoints) — `app.is_org_member(org_id)`, `app.is_org_admin(org_id)`,
   and `app.shares_org_with(user_id)`. Each does one `EXISTS` query
   against `org_members` filtered by `auth.uid()`.
2. `SECURITY DEFINER`, owned by the migration role, means these
   bypass RLS *internally* when they query `org_members` — necessary,
   because otherwise a policy calling one of these would recurse into
   the very policy it's evaluating. This is the standard, documented
   Supabase pattern for RLS helper functions, not a workaround.
3. Every tenant table's RLS policy calls the relevant helper in its
   `USING` (and `WITH CHECK` for writes) clause — e.g.
   `USING (app.is_org_member(id))` on `organizations`.
4. A user belonging to multiple orgs just works — each row is checked
   against "is the caller a member of *this row's* org," so there's no
   "active org" session concept to design for Phase 0. An org-switcher
   UI remains a later concern, but only as UX, not as a security gap.
5. If the calling context has no resolvable membership
   (unauthenticated, or a user with zero memberships), every helper's
   `EXISTS` returns `false`, so the query returns **zero rows** —
   never an error, never another tenant's data. This is the property
   the isolation test in this session proves directly.

`organizations` itself does not have an `org_id` column (it *is* the
tenant) — its RLS policy instead checks that the row's `id` appears in
the caller's `org_members`.

## Auth

Supabase Auth is the source of truth for identity (email/password to
start — OAuth providers are a later decision, not this session).
`src/lib/supabase/server.ts` creates a fresh Supabase server client per
request, reading/writing the session from cookies via `@supabase/ssr`
and TanStack Start's `getCookie`/`setCookie` (the h3-style helpers
`@tanstack/react-start/server` exposes — not a Next.js pattern).
`src/routes/sign-in.tsx` / `sign-up.tsx` and the `signUp`/`signIn`/
`signOut`/`getCurrentUser` server functions in `src/lib/auth.server.ts`
are the working primitives from this session. What's *not* done: the
rest of the app's UI (dashboard, leads, team, ...) still displays the
static mock data and mock "current user" from `src/data/crm.ts` — none
of it reads the real session yet. Wiring that through every screen is
Phase 1+ integration work, not this session's scope; the boundary
struck here was "the auth primitives work and are testable," not
"the whole app requires login."

Because RLS checks membership per-row rather than against a single
"current org," the session itself doesn't need to carry an active org
for the security boundary to work — a multi-org user's queries are
correctly scoped either way. What's still deferred to a later session
is purely UX: which org a multi-org user is *looking at* in the UI
(an org switcher), since that's a product decision, not a tenancy one.

### Making RLS apply to real queries, not just the isolation test

Prisma's own migration connection (`DIRECT_URL`) authenticates as
`postgres` — a superuser, which bypasses RLS unconditionally. That's
fine for migrations, but if the *app's* queries also went through a
`postgres`-authenticated connection, every RLS policy above would be
dead code for real traffic: only ever exercised by tests that
explicitly `SET ROLE`, never by the app itself. This is a well-known
footgun in Prisma+Supabase setups (confirmed while researching this
session — see the session's own log for sources), not a hypothetical.

The fix, `prisma/migrations/*_app_role`: a dedicated, non-superuser
Postgres role, `app_user`, is what `DATABASE_URL` authenticates as.
`app_user` has no table grants of its own — it's only a member of the
`authenticated` and `anon` Postgres roles (never `service_role`), so
every request must explicitly `SET LOCAL ROLE authenticated` (or
`anon`) plus the caller's JWT claims before a query can see anything —
exactly what `src/lib/db.server.ts`'s `withUserContext`/
`withAnonContext` do, and exactly the pattern
`tests/tenant-isolation.test.ts` uses (that test is what proved the
pattern actually works before it got built into real server
functions). A server function that forgets this wrapper doesn't
silently bypass RLS — `app_user` alone has no grants, so the query
just fails. Fail closed, not fail open.

The one legitimate RLS bypass — creating an org on signup, before that
user has any `org_members` row for RLS to key off — goes through
`src/lib/supabase/admin.server.ts`'s service-role Supabase client
instead, deliberately *not* through Prisma at all. `app_user` isn't a
member of `service_role`, so this isn't just a convention someone
could accidentally violate from the Prisma side — it's structurally
a different code path, reachable only by importing that one file.

## What's deliberately not here yet

- `leads`, `contacts`, `projects`, `units`, `bookings`, and everything
  else in the full build plan's data model — Phase 1 onward.
- Billing / Stripe-Razorpay — not until Phase 9 per the roadmap.
- Org-switcher UI for multi-org users.
- Invite flow for adding a member to an org (this session proves
  tenancy with memberships created directly for the test; a real
  "invite a teammate" flow is product work for a later session).
