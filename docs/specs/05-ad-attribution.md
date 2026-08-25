# 05 — Ad Hierarchy (Attribution Tables)

Status: proposed, not yet built beyond this slice. Same "spec before code"
discipline as the earlier docs — flagging for review rather than blocking on
it, since this session can't pause mid-task for sign-off, but nothing here
is pre-approved. Corresponds to GitHub issue #25 (Phase 3).

## What's in this slice vs. deferred

`01-leads.md` added `leads`' attribution columns (`source_id`, `ad_id`,
`ad_set_id`, `campaign_id`, `utm_*`, `click_id`, etc.) nullable and
unpopulated, and explicitly deferred "the ad hierarchy (`ad_accounts` ->
`campaigns` -> `ad_sets` -> `ads`) behind the attribution columns" to Phase
3. This is that slice.

**This slice (now):**

- Four org-scoped tables: `ad_accounts` -> `campaigns` -> `ad_sets` -> `ads`,
  each a child of the one above via a cascading FK.
- Manual admin CRUD: `src/lib/ad-hierarchy.server.ts` — list+create at
  every level, delete on the leaf (`ads`) level only.
- RLS: any org member can view; only org admins can write (create, update,
  delete) on all four tables.

**Explicitly deferred:**

- **Real Meta/Google API sync** — the nightly job that would actually
  populate these tables from real ad accounts is Phase 3.5 (issues
  #27-29), blocked on real vendor credentials. This slice exists so an org
  admin can hand-enter ad campaign info even before that sync exists —
  e.g. to backfill a small number of known campaigns, or to test the
  attribution UI end to end before the sync is built.
- **UTM/click-ID capture script** (a website snippet that would populate
  `leads.utm_source`/`click_id`/etc. at the point a lead comes in through
  the public form) — this is a frontend/marketing-site concern, not a
  backend one. Out of scope for this ticket.
- **Update/delete on `ad_accounts`/`campaigns`/`ad_sets`** — RLS supports
  it (see below), but no server function exposes it yet. Admins fixing a
  mis-typed name at those levels can leave the stray row for now (harmless,
  org-scoped, nothing else points at it); add the server functions if that
  turns out to matter in practice.
- **A FK from `Lead` to any of these four tables** — see "Why no FK from
  Lead" below.

## Data model

### `ad_accounts`

| column                | type        | notes                              |
| --------------------- | ----------- | ------------------------------------ |
| `id`                  | uuid, pk    |                                       |
| `org_id`              | uuid, fk     | -> `organizations.id`                 |
| `platform`            | enum        | `meta` / `google`                     |
| `external_account_id` | text        | the platform's own account id         |
| `name`                | text        |                                       |
| `created_at`          | timestamptz |                                       |

### `campaigns`

| column                 | type        | notes                              |
| ---------------------- | ----------- | ------------------------------------ |
| `id`                   | uuid, pk    |                                       |
| `org_id`               | uuid, fk     |                                       |
| `ad_account_id`        | uuid, fk     | -> `ad_accounts.id`, cascade delete    |
| `external_campaign_id` | text        | the platform's own campaign id        |
| `name`                 | text        |                                       |
| `created_at`           | timestamptz |                                       |

### `ad_sets`

| column               | type        | notes                              |
| -------------------- | ----------- | ------------------------------------ |
| `id`                 | uuid, pk    |                                       |
| `org_id`             | uuid, fk     |                                       |
| `campaign_id`        | uuid, fk     | -> `campaigns.id`, cascade delete      |
| `external_ad_set_id` | text        | the platform's own ad set id          |
| `name`               | text        |                                       |
| `created_at`         | timestamptz |                                       |

### `ads`

| column           | type        | notes                              |
| ---------------- | ----------- | ------------------------------------ |
| `id`             | uuid, pk    |                                       |
| `org_id`         | uuid, fk     |                                       |
| `ad_set_id`      | uuid, fk     | -> `ad_sets.id`, cascade delete        |
| `external_ad_id` | text        | the platform's own ad id              |
| `name`           | text        |                                       |
| `created_at`     | timestamptz |                                       |

Every level cascades: deleting an `ad_account` deletes its `campaigns`,
which deletes their `ad_sets`, which deletes their `ads` — same shape as
`projects` -> `towers` -> `units` in `02-inventory.md`.

## Why no FK from `Lead`

`Lead.ad_id` / `ad_set_id` / `campaign_id` / `source_id` (added in
`01-leads.md`, still nullable and unpopulated) deliberately stay plain
UUID columns, not foreign keys into these new tables. A lead's attribution
data can arrive — once the Phase 3 capture path is built — via a webhook
from Meta/Google at essentially any time relative to this org's own sync
of that ad's metadata. If `leads.ad_id` were FK-constrained, a lead insert
would fail outright whenever the webhook beats the nightly sync to a brand
new ad, which is an ordinary and expected race, not an error condition.
Keeping the columns unconstrained means a lead can always be captured with
whatever attribution IDs it arrives with; a later join against `ads` for
display purposes just returns nothing until (if ever) that ad gets synced
in. This is the same reasoning `leads.project` (free text, not yet an FK
to `projects.id`) already uses in `02-inventory.md`.

## RLS

Same shape as `project_media` in `02-inventory.md`/`20260819010000_project_media`:
any org member can view; only `app.is_org_admin(org_id)` can write. Unlike
`project_media`, all four tables here get full INSERT/UPDATE/DELETE
policies (not just INSERT/DELETE), since a hand-entered campaign name is
more likely to need a correction than a media file is — and `org_id` is
pinned immutable on UPDATE via the existing `app.prevent_org_id_change()`
trigger (same as `leads`/`contacts`/`projects`/`towers`/`units`), so a
multi-org admin can't move a row between orgs they administer.

**New tables + new RLS policies — flagging for explicit human review
before merge, per CLAUDE.md's review gates.**

## New migration

`prisma/migrations/20260822130000_ad_hierarchy/migration.sql` —
hand-authored, not generated by `prisma migrate dev` (no network path to
the real Supabase database from this sandbox, same as every earlier
migration in this repo). Verified only via `prisma validate` + `db:generate`
and against a local throwaway Postgres container, never applied to any
real database. **Needs `prisma migrate deploy` (or the SQL run directly)
from a machine with real database access before the admin CRUD UI (not
built in this slice) would have real data to show.**

## Open questions for you

- Is list+create at every level, delete only on `ads`, the right cut for
  "admin can hand-enter the hierarchy," or do you want update/delete
  exposed on `ad_accounts`/`campaigns`/`ad_sets` too before this ships? RLS
  already supports it either way.
- Any preference on how `external_account_id`/`external_campaign_id`/etc.
  should be validated (e.g. Meta account IDs are typically numeric,
  Google's have a specific format)? This slice accepts any non-empty
  string, since real values will only start flowing in once Phase 3.5's
  sync exists to check them against.
