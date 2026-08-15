# 01 — Lead Management Core

Status: proposed, not yet built. Per the build plan's own rule ("spec
before code"), this needs your sign-off before I start migrations.

## What's in this slice vs. deferred

The full-build-plan Phase 1 is a ~3-week epic: leads CRUD, contacts,
timeline, statuses, **assignment rules**, follow-ups, tasks, **bulk
Excel upload**, attribution columns. Building all of it unreviewed in
one session risks the same thing Phase 0 was designed to avoid —
a large, unreviewable surface. Proposed split:

**This slice (now):**
- `contacts` and `leads` tables, org-scoped, RLS from the migration
  that creates them (same discipline as Phase 0)
- `lead_activities` — the timeline (notes, status changes, calls —
  logged, not yet auto-generated from real calls/WhatsApp, since
  telephony integration is Phase 4)
- `lead_assignments` — a history table, not a column (per the build
  plan's own explicit note: "who had this lead in March" needs to be
  answerable)
- Attribution columns on `leads`, nullable and unpopulated (per the
  build plan's Phase 1 line item — cheap to add now, painful to
  retrofit onto live data later)
- Server functions: create lead, list/filter leads, get one lead,
  change status, add a note, **manually** reassign
- The existing `/leads` UI (built earlier against mock data) gets
  rewired to these real server functions instead of local React state

**Explicitly deferred to a later session:**
- **Auto-assignment rules** (round-robin / load-balanced / by
  project-budget-location-language) — this slice ships *manual*
  assignment only. Auto-rules need real usage data to design sensibly
  and are a meaningfully separate feature.
- **Bulk Excel upload** — separate feature, separate spec.
- **Dedup engine** (merge on phone/email) — needs real duplicate
  leads to test against meaningfully; premature with zero real data.
- **Follow-up scheduling with escalation** — needs the Tasks module
  design, not just the Leads one.
- The ad hierarchy (`ad_accounts` → `campaigns` → `ad_sets` → `ads`)
  behind the attribution columns — Phase 3 per the build plan. This
  slice only adds the nullable columns on `leads` themselves.

## Data model

### `contacts`

A person, distinct from a lead — one person can be three leads across
three projects/sources (the build plan is explicit that merging these
is "the #1 CRM schema regret").

| column       | type        | notes                          |
| ------------ | ----------- | ------------------------------- |
| `id`         | uuid, pk    |                                  |
| `org_id`     | uuid, fk    | → `organizations.id`             |
| `full_name`  | text        |                                  |
| `phone`      | text        | nullable — some leads are email-only |
| `email`      | text        | nullable                        |
| `city`       | text        | nullable                        |
| `created_at` | timestamptz |                                  |

### `leads`

The enquiry itself.

| column               | type        | notes                                          |
| -------------------- | ----------- | ----------------------------------------------- |
| `id`                 | uuid, pk    |                                                   |
| `org_id`             | uuid, fk    | → `organizations.id`                             |
| `contact_id`         | uuid, fk    | → `contacts.id`                                  |
| `assigned_to`        | uuid, fk    | → `users.id`, nullable (unassigned)              |
| `status`              | enum        | New / Callback / Follow Up / Site Visit / Booked / Dropped (matches the existing mock UI) |
| `sub_status`          | text        | free text, matches existing UI                   |
| `source`              | text        |                                                   |
| `sub_source`          | text        |                                                   |
| `project`             | text        | free text for now — a real `projects` table is a separate slice |
| `budget`              | text        |                                                   |
| `requirement`         | text        |                                                   |
| `city`                | text        |                                                   |
| `next_action_at`      | timestamptz | nullable                                         |
| `created_at`          | timestamptz |                                                   |
| — attribution (all nullable, §3.5.2) — |||
| `source_id`, `ad_id`, `ad_set_id`, `campaign_id` | uuid | FKs to future tables — nullable, unenforced until Phase 3 |
| `creative_id`, `form_id`, `platform_lead_id`, `click_id` | text | |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | text | |
| `landing_page_url`, `referrer_url` | text | |
| `first_touch_ad_id`  | uuid        | nullable                                         |
| `raw_payload`        | jsonb       | nullable                                         |
| `captured_at`        | timestamptz | nullable                                         |

### `lead_activities`

The timeline. One polymorphic-ish table rather than separate ones per
type, matching the existing UI's "History" tab.

| column       | type        | notes                                    |
| ------------ | ----------- | ------------------------------------------ |
| `id`         | uuid, pk    |                                              |
| `org_id`     | uuid, fk    |                                              |
| `lead_id`    | uuid, fk    | → `leads.id`                                |
| `type`       | enum        | note / status_change / call / whatsapp / email / system |
| `body`       | text        |                                              |
| `created_by` | uuid, fk    | → `users.id`, nullable (system-generated)   |
| `created_at` | timestamptz |                                              |

### `lead_assignments`

History, not a column.

| column        | type        | notes                          |
| ------------- | ----------- | -------------------------------- |
| `id`          | uuid, pk    |                                   |
| `org_id`      | uuid, fk    |                                   |
| `lead_id`     | uuid, fk    | → `leads.id`                     |
| `assigned_to` | uuid, fk    | → `users.id`                     |
| `assigned_by` | uuid, fk    | → `users.id`, nullable (system)  |
| `assigned_at` | timestamptz |                                   |

## RLS

Same shape as Phase 0: every table above gets `org_id`, RLS enabled
in the migration that creates it, policies built on
`app.is_org_member(org_id)` for reads. `contacts` and
`lead_activities`/`lead_assignments` (append-only — no UPDATE/DELETE
policy on the latter two, matching "an audit log you can edit isn't
one") allow any org member to write. `leads` updates (including
reassignment, via a new `app.can_manage_lead(lead_id)` helper) require
org-admin, the lead's current assignee, or the lead being unclaimed.

`can_manage_lead` needs `app.is_org_member(org_id)` checked
**explicitly and first** — an earlier draft of this function checked
only "admin OR assignee OR unassigned" without first confirming org
membership at all, which meant a user from a *different org entirely*
could satisfy "unassigned" and claim someone else's unclaimed lead.
Caught while extending `tests/tenant-isolation.test.ts` to cover
leads, before the migration was ever applied anywhere — exactly the
kind of bug that class of test exists to catch.

## Open question for you

Is this slice — leads + contacts + timeline + assignment history +
manual (not auto) assignment, real UI wired up — the right size for
now, or do you want a narrower/wider first cut?
