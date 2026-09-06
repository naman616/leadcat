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

**Deferred — see "Open question for you" below, this is the one that
actually matters:**

- **What calls `syncAdSpend` nightly.** This slice ships the sync logic
  itself as a normal admin-triggered `createServerFn` — it does not decide
  or build *how* it runs on a schedule. CLAUDE.md is explicit that
  background jobs are "none yet... flag if a feature seems to need one —
  don't reach for Inngest or any queue prematurely," and picking a
  scheduler is exactly the kind of stack decision that section asks to be
  discussed first, not decided mid-implementation. See below.

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

## Open question for you: what actually runs this nightly?

This is the one decision this slice deliberately does not make.
`syncAdSpend` is written as a plain admin-triggered action (call it, it
syncs one ad account, once). Turning that into "runs automatically every
night for every ad account" needs one of:

- A scheduled serverless function (Vercel Cron, if this deploys there) that
  calls `syncAdSpend` for every `ad_account` once a day.
- A lightweight external cron (e.g. GitHub Actions on a schedule, or an
  outside uptime-ping-style service) hitting an authenticated endpoint that
  fans out to every ad account.
- A real background-job system (Inngest, a queue) — the heavier option
  CLAUDE.md says not to reach for prematurely, and probably overkill for
  "call one function once a day per org."

No answer is baked into this PR. Whichever you pick, the actual sync logic
(`syncAdSpend`) doesn't need to change — only what calls it and how often.

## Testing plan

- `tests/tenant-isolation.test.ts`: RLS view/write isolation (org members
  view, admins-only write, cross-org isolation on both `ad_daily_stats`
  and the parent `ad_accounts` lookup `syncAdSpend` itself depends on), a
  full `syncAdSpend`-shaped run against the mock provider asserting 28 rows
  get upserted, and a dedicated re-sync test proving the upsert overwrites
  an existing day's row rather than duplicating it.
- `bun run typecheck` — clean.
- `bun run lint` — 0 errors (7 pre-existing warnings, unrelated).
- `bun run test:db:setup` / `bun run test` — **not run this session**, no
  docker/local Postgres in this sandbox (same gap noted on every recent PR
  here). Relying on GitHub Actions CI as the real gate.
