# 10 — Ad Spend Sync

Issues #27 (Meta Marketing API), #28 (Google Ads API), #29 (`ad_daily_stats`
table + rolling 28-day re-sync). The Phase 3.5 slice `05-ad-attribution.md`
explicitly deferred: "the nightly job that would actually populate these
tables from real ad accounts... blocked on real vendor credentials."

## What's in this slice vs. deferred

**In:**

- `ad_daily_stats` — one row per (ad, day) of impressions/clicks/spend.
- `AdSpendProvider` — the seam a real Meta Marketing API / Google Ads API
  client will implement later, same shape as `WhatsAppProvider`/
  `TelephonyProvider`. Two mock implementations (`MockMetaMarketingProvider`,
  `MockGoogleAdsProvider`) stand in until real vendor credentials exist.
- `syncAdSpend` — given one `ad_account_id`, walks its campaigns → ad sets →
  ads, fetches the trailing 28 days from the matching provider (by
  `ad_accounts.platform`), and upserts every (ad, day) pair. This *is* the
  "rolling 28-day re-sync" from issue #29 — every run re-fetches and
  overwrites the last 28 days, because ad platforms revise a day's own
  attributed numbers for days after it ends (a click today can still get
  attributed to yesterday's impression once the platform's own attribution
  window settles).
- `listAdDailyStats` — read-side, for whatever report consumes this later
  (issue #40, cost-per-lead/cost-per-booking leaderboard).

**Originally deferred, now resolved — see "What runs this nightly" below:**

- **What calls `syncAdSpend` nightly.** Vercel Cron + a fixed per-org
  system account, not a new background-job system — CLAUDE.md's "don't
  reach for Inngest or any queue prematurely" still applies, and one
  cron-triggered HTTP route firing once a day per environment doesn't need
  one.

**Also deferred (smaller, same shape as `05-ad-attribution.md`'s own
deferrals):**

- **Real Meta/Google API clients** — vendor-blocked, same as issue #31's
  WhatsApp Business API and issue #30's telephony provider.
- **Any UI** — no admin screen exists yet for the ad hierarchy itself
  (`ad-hierarchy.server.ts` has been backend-only since Phase 3), so a
  "Sync now" button or a spend dashboard would have nowhere to live without
  first building that. Out of scope here; a natural pairing with issue #40.
- **Per-ad-set/campaign/account rollups** — `ad_daily_stats` is leaf-level
  (per `ad`) only. A report needing campaign-level totals sums over its
  ads' rows rather than this slice maintaining a separate aggregate table.

## Why `ad_daily_stats` is leaf-level, one row per (ad, day)

Issue #29 says "so cost-per-lead/cost-per-booking can be computed per ad"
— the leaderboard report (#40) needs per-ad granularity, and every
coarser level (ad set, campaign, account) can be derived by summing over
`ad_id`s that share a parent, so there's no reason to also store
duplicated rollups that could drift out of sync with their own inputs.

## Data model

### `ad_daily_stats`

| column        | type        | notes                                          |
| ------------- | ----------- | ----------------------------------------------- |
| `id`          | uuid, pk    |                                                   |
| `org_id`      | uuid, fk     | → `organizations.id`                             |
| `ad_id`       | uuid, fk     | → `ads.id`, cascade delete                        |
| `date`        | date        | the platform's own reporting day                  |
| `impressions` | int         | default 0                                        |
| `clicks`      | int         | default 0                                        |
| `spend`       | decimal(14,2) | default 0 — money, does arithmetic later (issue #40), same reasoning as `CostSheet`/`PaymentMilestone` rather than `Unit.price`'s free-text style |
| `synced_at`   | timestamptz | `@updatedAt` — last time this row was (re-)written |

`UNIQUE (ad_id, date)` is the entire rolling-resync mechanism: `syncAdSpend`
upserts on this key every run.

## RLS

Same shape as `ad_accounts`/`campaigns`/`ad_sets`/`ads`
(`20260822130000_ad_hierarchy`): any org member can view (`SELECT`), only
org admins can write. Unlike those four tables, `ad_daily_stats` gets
`INSERT`+`UPDATE` policies but no `DELETE` — nothing in this slice removes
a stat row, and `org_id` is pinned immutable on `UPDATE` via the existing
`app.prevent_org_id_change()` trigger, same as every other tenant table.

`syncAdSpend` is a normal authenticated `createServerFn` (`requireUserId` +
`withUserContext`), not an anon webhook — no `SECURITY DEFINER` function
needed. It runs as whichever user calls it; RLS's admin-only `INSERT`/
`UPDATE` policies are what actually gate the write, same as the ad
hierarchy's own admin-gated creates.

**New migration + new RLS — flagging for explicit human review before
merge, per CLAUDE.md's review gates**, same as every prior migration here.

## New migration

`prisma/migrations/20260906020000_ad_daily_stats/migration.sql` —
hand-authored, same as every earlier migration in this repo (no network
path to the real Supabase DB from this sandbox... except this session did
have that access for the two WhatsApp migrations, with explicit sign-off,
after this slice's own migration file was already written. This one has
**not** been applied anywhere but validated via `prisma validate` +
`db:generate`.

## What runs this nightly — resolved

This app deploys on Vercel, so the nightly trigger is a Vercel Cron Job
(`vercel.json`) hitting `POST /api/cron/sync-ad-spend` once a day (`0 2 * *
*`, 2am UTC — arbitrary, adjust to taste). See
`src/lib/ad-spend/cron-handler.ts`.

The part that isn't just "pick a scheduler": `syncAdSpend`'s write is
RLS-gated to org admins, and a cron invocation has no logged-in user to be
one. Two ways to give it that authority were considered:

- **Service-role bypass** — the cron route uses the admin (service-role)
  Supabase client directly, like `signUp()`'s org creation does. Rejected:
  that client is meant to stay "the one audited admin path" (CLAUDE.md);
  giving a second, recurring code path the same bypass — for tenant data
  writes, not just pre-membership bootstrapping — is exactly the kind of
  quiet scope creep that rule exists to prevent.
- **Fixed per-org system account (chosen)** — a real Supabase Auth user
  (`scripts/setup-ad-spend-sync-system-user.ts`, run once per environment)
  seated as an `admin` `org_members` row in every org. The cron calls
  `runAdSpendSync` (the plain function `syncAdSpend` now delegates to)
  through `withUserContext(systemUserId, ...)` — the exact same path every
  other admin write in this app already goes through. Zero new RLS bypass
  surface; the cron is authorized by data (a membership row), not code.

New orgs get the system account automatically: `signUp()` seats it
alongside the new owner, in the same service-role call that already creates
the org (see `src/lib/auth.server.ts`) — not a new bypass, the existing one
doing one more insert.

Auth gating on the route itself: `CRON_SECRET`, compared against
`Authorization: Bearer <token>` — Vercel sends that header automatically
for its own Cron Job invocations once `CRON_SECRET` is set in the project's
env vars. See `.env.example` for both new env vars
(`CRON_SECRET`, `AD_SPEND_SYNC_SYSTEM_USER_ID`).

**Not applied anywhere yet**: this needs `scripts/setup-ad-spend-sync-
system-user.ts` run once against the real Supabase project (creates a real
Auth user + writes `org_members` rows — same "explicit sign-off" bar as
applying a migration, per CLAUDE.md's review gates) before
`AD_SPEND_SYNC_SYSTEM_USER_ID`/`CRON_SECRET` can be set in Vercel and the
cron can actually run.

## Testing plan

- `tests/tenant-isolation.test.ts`: RLS view/write isolation (org members
  view, admins-only write, cross-org isolation on both `ad_daily_stats`
  and the parent `ad_accounts` lookup `syncAdSpend` itself depends on), a
  full `syncAdSpend`-shaped run against the mock provider asserting 28 rows
  get upserted, and a dedicated re-sync test proving the upsert overwrites
  an existing day's row rather than duplicating it. Still a hand-mirrored
  copy of `runAdSpendSync`'s body, same as before the refactor — that
  function goes through `db.server.ts`'s shared `prisma` (bound to
  `DATABASE_URL`, the real Supabase project), which this test file's
  `TEST_DATABASE_URL`-bound client deliberately never touches.
- `tests/ad-spend-cron-handler.test.ts`: `handleAdSpendSyncCron`'s auth
  gating (missing/wrong `CRON_SECRET`, missing `AD_SPEND_SYNC_SYSTEM_USER_ID`).
  Doesn't exercise the fan-out loop itself end-to-end — same DATABASE_URL/
  TEST_DATABASE_URL split as above means that needs a real Supabase-shaped
  environment, not this test DB.
- `bun run typecheck` — clean.
- `bun run lint` — 0 errors (7 pre-existing warnings, unrelated).
- `bun run test:db:setup` / `bun run test` — **not run this session**, no
  docker/local Postgres in this sandbox (same gap noted on every recent PR
  here). Relying on GitHub Actions CI as the real gate.
