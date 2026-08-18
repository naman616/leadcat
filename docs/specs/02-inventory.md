# 02 — Inventory Core

Status: proposed, not yet built. Per the same "spec before code" discipline
as `01-leads.md`, this needs your sign-off before any migration runs —
especially since this repo's `DATABASE_URL`/`DIRECT_URL` point at a real
Supabase project, not a throwaway one.

## What's in this slice vs. deferred

The full build plan's Phase 2 (`projects → towers → units, availability,
media, price history`) is scoped for ~2 weeks. Same reasoning as
`01-leads.md`: shipping all of it unreviewed in one session risks an
unreviewable surface. Proposed split:

**This slice (now):**

- `projects`, `towers`, `units` tables, org-scoped, RLS from the migration
  that creates them (same discipline as Phase 0/1).
- Unit availability states: Available / Blocked / Booked / Registered —
  matches the existing mock UI in `properties.tsx` exactly.
- Server functions: create/list projects, create/list towers per project,
  create/list units (with project + tower joined in), change a unit's
  status.
- The existing `/projects` and `/properties` UI gets rewired to these real
  server functions. `/properties` currently renders the fully-generic
  `ModulePage` mock component (still used by `/attendance`, `/data`,
  `/invoice` — untouched) and becomes a bespoke page, matching how
  `/leads` was rewired in Phase 1.

**Explicitly deferred to a later session:**

- **`project_media`** (brochures, floor plans, RERA docs) — needs file
  storage, and Storage/R2 isn't set up anywhere in this repo yet. That's
  an infra decision bigger than this slice.
- **`unit_price_history`** (price versioning) — a real feature in its own
  right (mirrors why `lead_assignments` is a history table, not a column),
  deserves its own spec rather than being squeezed in here.
- **A `developers` entity** distinct from `Organization` — nothing in the
  current product needs a broker/CP org to model *multiple* developers
  under one tenant yet; `Organization` already is the tenant boundary.
  Adding this speculatively would be exactly the kind of premature
  abstraction CLAUDE.md warns against.
- **Real delete** for projects/towers/units — the mock UI's Delete icon
  stays a decorative toast, same as the Call/WhatsApp/Email buttons
  already are on `/leads`. Deleting inventory that might already be
  referenced by leads/bookings needs its own thought-through cascade
  story; not blocking this slice.
- **A `towers` management screen** — towers are real rows (cheap to model
  now, painful to retrofit later, same reasoning as leads' attribution
  columns), but this slice only lets you create one inline from the
  Add Unit dialog, not manage them separately.
- **Linking `leads.project` (free text) to a real `projects.id`** — leads
  already ships with a free-text `project` field from Phase 1. This slice
  does *not* migrate that to a foreign key; "matching leads" for a project
  is computed by a case-insensitive text match against `leads.project`,
  same as today's mock, just backed by real data instead of a random
  number. A real FK is a natural follow-up once both sides exist, but
  changing `leads`' schema is out of scope for an inventory slice.

## Data model

### `projects`

| column                | type        | notes                                              |
| ---------------------- | ----------- | --------------------------------------------------- |
| `id`                  | uuid, pk    |                                                       |
| `org_id`              | uuid, fk    | → `organizations.id`                                |
| `name`                | text        |                                                       |
| `city`                | text        |                                                       |
| `type`                | enum        | `Residential` / `Commercial` / `Agricultural` — matches the existing mock |
| `starting_price`      | text        | nullable, free text (e.g. "₹ 75L onwards") — matches existing mock display, not a real numeric field yet |
| `unit_config_summary` | text        | nullable, free text (e.g. "2 & 3 BHK") — display-only summary, not derived from real units in this slice |
| `created_at`          | timestamptz |                                                       |

### `towers`

| column       | type        | notes                          |
| ------------ | ----------- | -------------------------------- |
| `id`         | uuid, pk    |                                   |
| `org_id`     | uuid, fk    |                                   |
| `project_id` | uuid, fk    | → `projects.id`                  |
| `name`       | text        |                                   |
| `created_at` | timestamptz |                                   |

### `units`

| column          | type        | notes                                                        |
| ---------------- | ----------- | --------------------------------------------------------------- |
| `id`            | uuid, pk    |                                                                   |
| `org_id`        | uuid, fk    |                                                                   |
| `project_id`    | uuid, fk    | → `projects.id`                                                 |
| `tower_id`      | uuid, fk    | nullable — plotted/villa-style projects may have no tower       |
| `unit_number`   | text        | e.g. "B-1204"                                                    |
| `configuration` | text        | nullable, free text (e.g. "2BHK") — matches existing mock        |
| `floor`         | text        | nullable, free text (not numeric — "Ground", "Terrace" happen)  |
| `area`          | text        | nullable, free text — one field, not the full carpet/built-up/super split from the build plan §1.1.C; that precision isn't needed until someone asks for it |
| `price`         | text        | nullable, free text — matches existing mock display style        |
| `status`        | enum        | `Available` / `Blocked` / `Booked` / `Registered`, default `Available` |
| `created_at`    | timestamptz |                                                                   |

## RLS

Same shape as Phase 0/1: `org_id` + RLS enabled in the migration that
creates each table, policies built on `app.is_org_member(org_id)`.
Unlike `leads` (which gates reassignment through `app.can_manage_lead`),
inventory has no per-row ownership concept — any org member can create,
read, and update projects/towers/units, same openness as `contacts` in
Phase 1. No DELETE policy on any of the three tables in this slice (see
"explicitly deferred" above) — an attempted delete fails closed, same as
any other RLS-blocked write in this app.

## UI changes worth flagging explicitly

- **`/projects`' per-project "Availability" toggle becomes a computed,
  read-only badge** (e.g. "12 available" / "Sold out") instead of a
  manually-flipped boolean. The mock toggle has no real unit data behind
  it today; once real units exist, a hand-toggled switch that can
  disagree with actual unit availability would just be a second, wrong
  source of truth. This mirrors `dashboard.server.ts`'s existing rule of
  dropping mock metrics with no real backing rather than faking them.
- **`/projects`' "Data Count" column becomes "Units"** — same number
  (a real unit count now, previously an arbitrary mock number), clearer
  label.
- **"Matching Leads"** becomes a real count (case-insensitive match on
  `leads.project`), replacing the mock's random number.

## Open question for you

Same shape as the leads slice: is this — projects + towers + units, real
CRUD, unit-level availability, both pages rewired — the right size for
now, or do you want it narrower (e.g. skip towers entirely for this pass)
or wider (e.g. pull in price history now)?
