# 03 — Contact Dedup Engine

Status: proposed, not yet built. Same "spec before code" discipline as
`01-leads.md` and `02-inventory.md` — flagging for review rather than
blocking on it, since this session can't pause mid-task for sign-off, but
nothing here should be treated as pre-approved.

## What's in this slice vs. deferred

`01-leads.md` deferred this with: "needs real duplicate leads to test
against meaningfully; premature with zero real data." That's still true
in the sense that this slice's *detection heuristic* hasn't been tuned
against real data — it can't be, there isn't any yet — but the mechanism
(detect, review, merge) doesn't need real data to build correctly, only
to calibrate later. Proposed split:

**This slice (now):**

- Duplicate **detection** across `contacts` within an org: two contacts
  match if they share a normalized phone number OR a normalized email
  (see "Normalization" below). Computed at read time from existing data
  — no new table, no stored "duplicate" state to keep in sync.
- A **merge** action: pick one contact in a group as canonical, every
  other contact in the group is merged into it — their leads get
  reassigned to the canonical contact (with a `lead_activities` note
  logged on each affected lead), then the duplicate contact rows are
  deleted.
- A `contacts` RLS DELETE policy — didn't exist before this slice
  (`01-leads.md`: "No DELETE policy yet — not exposed until there's a
  real need for it"). Merge is that real need.
- A "Duplicates" panel on `/leads`, listing groups and letting an org
  admin/owner pick the canonical contact and confirm a merge.
- Server functions: `findDuplicateContacts` (detect), `mergeContacts`
  (merge).

**Explicitly deferred to a later session:**

- **Automatic/background dedup** — this slice is entirely on-demand
  (open the panel, see current groups). No job re-scans on a schedule;
  this repo has no background-job infra yet (CLAUDE.md: "flag if a
  feature seems to need one — don't reach for Inngest prematurely"), and
  a merge tool doesn't need one — it's fine for this to be something a
  human opens and reviews periodically.
- **Field-level merge (backfilling the canonical contact's blank fields
  from a duplicate)** — e.g. if the canonical contact has no email but a
  duplicate does. This slice does not touch the canonical contact's own
  columns at all; the person doing the merge picks whichever contact
  already has the data they want as canonical. Auto-merging fields adds
  real complexity (which duplicate wins on a conflict?) for a case the
  UI's "pick the right one as canonical" already covers.
- **Fuzzy/near-duplicate matching** (similar names, transposed digits,
  `+91` vs `0` vs no prefix handled beyond the last-10-digits heuristic
  below, common misspellings) — exact normalized-key matching only.
  Real duplicate data will tell us whether fuzzy matching is worth the
  false-positive risk; guessing now isn't.
- **Undo a merge** — deletion is real and immediate once confirmed.
  A soft-delete / restore window is a reasonable follow-up once this is
  used against real data, not a first-cut requirement.
- **Leads dedup directly** (two `leads` rows that are actually the same
  enquiry, as opposed to two `contacts` rows that are the same person) —
  out of scope. `leads` intentionally allows one contact to have several
  leads (different projects/sources) per `01-leads.md`; conflating that
  with contact-level dedup would undermine the exact design choice that
  doc calls out as "the #1 CRM schema regret" to get wrong.

## Normalization

Two contacts are considered a duplicate pair if their normalized phone
numbers match, OR their normalized emails match (an "or," not an "and"
— a shared phone with different emails is still worth surfacing, and
vice versa). Groups are transitive: if A matches B on phone and B
matches C on email, A/B/C land in one group together, not two separate
pairs.

- **Email**: trimmed and lowercased. `Asha@Example.com` and
  ` asha@example.com ` normalize to the same key.
- **Phone**: every non-digit character stripped, then only the **last
  10 digits** kept as the match key. This is an explicit, India-specific
  heuristic (this repo's primary market — see `CLAUDE.md`/the build
  plan) so `+91 98765 43210`, `091-98765-43210`, and `9876543210` all
  normalize to the same key. A number that strips down to fewer than 10
  digits produces **no** match key at all (rather than matching on a
  short, low-entropy string) — a placeholder like "0000" or a typo'd
  6-digit landline extension shouldn't false-positive-collide contacts
  that aren't actually the same person. This heuristic is wrong for
  UAE numbers (the build plan's secondary market) and will need
  revisiting before this repo takes on real UAE data — flagging that
  explicitly rather than silently shipping a heuristic that only works
  for one of the two stated markets.

Both functions are pure and live in `src/lib/dedup.ts` (client-safe, no
Prisma import), unit-tested directly — see `tests/dedup.test.ts`.

## Detection mechanism

`findDuplicateContacts` fetches every contact in the caller's org (via
`withUserContext`, RLS-scoped) with its lead count, then groups them
in-memory with a union-find over the two normalized keys. No raw SQL,
no computed-expression `GROUP BY` — an org's contact list is not
expected to be large enough that fetch-then-group-in-JS is a real cost
(the same pattern `listProjects`' matching-leads count in
`02-inventory.md` already uses), and an in-memory pure function is
something this session can actually unit-test without a live database,
unlike a hand-authored raw-SQL grouping query.

## Merge mechanism

`mergeContacts(canonicalContactId, duplicateContactIds[])`:

1. App-level role check: caller must be an org owner or admin (see
   "RLS" below for why this is checked explicitly here too, not just
   left to RLS).
2. For each duplicate contact: reassign every `lead` currently pointing
   at it to the canonical contact, logging a `system`-type
   `lead_activities` entry on each ("Contact merged from a duplicate")
   — same audit-trail instinct as every other mutation in this app.
3. Delete the duplicate contact row.
4. All of the above inside one transaction (`withUserContext` already
   wraps the whole handler in one, same as `bulkCreateLeads` in
   `01-leads.md`) — a merge either fully lands or fully doesn't.

Canonical contact selection is entirely the caller's choice — the panel
shows both contacts side by side so a human picks which one has the
data worth keeping. Nothing here inspects field completeness or picks
automatically.

## RLS

- `contacts` gets a new DELETE policy: `app.is_org_admin(org_id)` —
  reusing the existing Phase 0 helper, not a new one. Any org member can
  still view/create/update contacts as before; only an admin/owner can
  delete one, which in practice means only an admin/owner can complete
  a merge (the last step is a delete).
- No RLS changes needed on `leads` or `lead_activities` — merge
  reassigns `leads.contact_id` and inserts `lead_activities` rows, and
  both of those are already permitted for an org admin under the
  existing Phase 1 policies (`can_manage_lead`'s admin branch, and
  "any org member can add lead activities" respectively).
- **Why `mergeContacts` also checks the caller's role explicitly**,
  not just relying on the DELETE policy catching an unauthorized
  attempt: the same reasoning as `addOrgMemberByEmail` in
  `00-overview.md` — checking late means a non-admin's merge attempt
  would reassign every affected lead's `contact_id` and write activity
  log entries, and only then fail at the final `DELETE`, leaving leads
  reassigned to a "canonical" contact with no actual merge completed
  and a misleading activity trail. Checking role first, before any
  write, keeps a rejected merge attempt a true no-op.

## New migration

`prisma/migrations/<timestamp>_contacts_dedup/migration.sql` — one
`CREATE POLICY` for `contacts` DELETE, in the same style as the
existing migrations. Hand-authored, not generated by
`prisma migrate dev`, because this sandbox has no network path to the
real Supabase database (confirmed while building `02-inventory.md`'s
migration) — verified only via `prisma validate` +
`db:generate`, never applied. **Needs `prisma migrate deploy` (or the
SQL run directly) from a machine with real database access before the
Duplicates panel will work — same closing step as the inventory
migration.**

## Open questions for you

- Is admin/owner-only merge the right bar, or should any org member be
  able to merge (contacts/leads themselves are editable by any member
  today)? I chose admin/owner because a merge is destructive
  (deletes rows) in a way a normal contact edit isn't — matching the
  bar this repo already sets for other destructive-ish org actions
  (removing a member, changing roles), not the bar for ordinary CRUD.
- Is last-10-digits-only phone normalization acceptable for now, given
  it's explicitly wrong for the UAE market? Flagging rather than
  guessing at a UAE-specific rule with zero real UAE data to check it
  against.
