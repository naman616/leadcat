# 04 — Tasks Module

Status: proposed, not yet built beyond this slice. Same "spec before code"
discipline as `01-leads.md` / `02-inventory.md` / `03-dedup.md` — this
needs sign-off before the migration is applied anywhere beyond a local
throwaway database.

This closes out the Phase 1 line item the leads-core slice explicitly
deferred: `01-leads.md` listed "Follow-up scheduling with escalation" as
needing "the Tasks module design, not just the Leads one" — `leads.nextActionAt`
(the existing `/tasks` page, `src/lib/tasks.server.ts`'s `getTasks`) covers
lead-linked follow-ups only. This slice adds a real `Task` row: something
that isn't necessarily about a lead at all, and that can be assigned,
completed, and reopened independently of any single lead's status.

## What's in this slice vs. deferred

**This slice (now):**

- A `tasks` table, org-scoped, RLS enabled in the same migration that
  creates it (same discipline as every tenant table before it).
- A task is optionally linked to a lead (`lead_id`, nullable — a follow-up
  call, a document to chase) or general (an org-wide chore, `lead_id`
  null).
- Basic lifecycle only: create, list, complete, reopen, reassign. No
  editing title/due date/lead link after creation in this slice — if that
  turns out to be needed day-to-day, it's a small follow-up, not a design
  change.
- Server functions in `src/lib/tasks.server.ts`: `createTask`, `listTasks`
  (optionally filtered by `leadId`), `completeTask`, `reopenTask`,
  `reassignTask`.

**Explicitly deferred to a later session:**

- **Recurring tasks.** No `recurrence` rule, no "spawn the next occurrence
  on completion." Needs real usage data on what recurrence patterns people
  actually want before designing one.
- **Notifications / reminders.** This repo has no background-job infra yet
  (`CLAUDE.md`: "flag if a feature seems to need one — don't reach for
  Inngest prematurely"), and a reminder needs one (a scheduled check
  against `due_at`, at minimum). A task list you have to open and look at
  is this slice's whole interaction model, same spirit as the dedup
  engine's "on-demand, no background scan."
- **Editing a task's title/due date/lead link after creation.** Only
  create/list/complete/reopen/reassign exist. Cheap to add a generic
  `updateTask` later; not adding it speculatively now.
- **A `task_activities`-style history** (who reassigned/completed/reopened
  a task, and when) mirroring `lead_assignments`. `leads.md`'s reasoning
  for that table was "who had this lead in March needs to be answerable in
  a brokerage dispute" — a task doesn't carry that kind of dispute risk;
  `updated_at`-less, "currently assigned to X, completed at Y or still
  open" is enough for this slice. Revisit if that assumption turns out
  wrong.
- **Deleting a task.** No DELETE policy, no server function — same
  reasoning `01-leads.md` gave for `contacts` before the dedup engine:
  not exposed until there's a real need for it.
- **Task priority, tags, or categories.** Nothing in the current product
  asks for these; adding them speculatively is exactly the kind of
  premature abstraction `CLAUDE.md` and `02-inventory.md`'s "no
  `developers` entity yet" both warn against.

## Data model

### `tasks`

| column         | type        | notes                                                                |
| -------------- | ----------- | --------------------------------------------------------------------- |
| `id`           | uuid, pk    |                                                                         |
| `org_id`       | uuid, fk    | → `organizations.id`                                                   |
| `lead_id`      | uuid, fk    | → `leads.id`, nullable — a task can be lead-linked or general          |
| `title`        | text        |                                                                         |
| `due_at`       | timestamptz | nullable                                                               |
| `assigned_to`  | uuid, fk    | → `users.id`, nullable — unassigned tasks are allowed                  |
| `completed_at` | timestamptz | nullable — null means open, a timestamp means done; no separate status enum |
| `created_by`   | uuid, fk    | → `users.id`, **not** nullable — every task is created by a real authenticated user via `createTask`, never system-generated |
| `created_at`   | timestamptz |                                                                         |

`created_by` being `NOT NULL` (unlike `lead_activities.created_by`, which
is nullable for system-generated timeline entries) means its FK uses
`ON DELETE CASCADE`, mirroring `lead_assignments.assigned_to` — the other
NOT NULL user FK in this schema — rather than `lead_activities`' `SET
NULL`, which exists specifically to support nullable system rows this
table doesn't have.

## RLS

Same shape as every table before it: `org_id` + RLS enabled in the
migration that creates the table.

- **View / create**: any org member — mirrors how `leads` visibility
  works (`app.is_org_member(org_id)`). A task isn't a sensitive record;
  anyone on the team should be able to see and add one.
- **Update** (which covers completing, reopening, and reassigning — all
  three are just a column update via `src/lib/tasks.server.ts`, not
  separate RLS surfaces): gated by a new `app.can_manage_task(check_task_id)`
  helper, same shape as `app.can_manage_lead` — org admins always;
  otherwise only the task's current **assignee** or its **creator**.
- **No DELETE policy** — not exposed this slice, same as `contacts` before
  the dedup engine.

### Why `can_manage_task` has no "unclaimed = anyone" branch

`can_manage_lead` lets *any* org member update a lead that's currently
unassigned — "picking up an unclaimed lead" is a normal, expected action
in that flow. Tasks don't have an equivalent concept: an unassigned task
is still somebody's task to complete once picked up in conversation, not
a shared queue anyone grabs from. Only the assignee, the creator, or an
admin may touch it, whether or not it's currently assigned to anyone. If
"claim an unassigned task" turns out to be a real workflow, it's a
one-line addition to the helper (`OR assigned_to IS NULL`) — not added
speculatively now.

### org_id pinning

`leads`/`contacts` needed a follow-up migration
(`20260815143031_fix_role_escalation_and_org_pinning`) to make `org_id`
immutable after insert, once an independent review found a multi-org
member could otherwise move a row between their own orgs. `tasks` starts
out with a mutable `UPDATE` policy from day one (reassignment, completion,
reopening), so this migration reuses that same
`app.prevent_org_id_change()` trigger function up front rather than
waiting for the same class of bug to be found again later.

## Server functions (`src/lib/tasks.server.ts`)

- `createTask({ title, leadId?, dueAt?, assignedTo? })` — creates an
  always-open task (`completedAt: null`) in the caller's primary org.
  Validates `assignedTo` is an actual member of that org before writing
  (reusing `requireOrgMember`, exported from `leads.server.ts`, same as
  `createLead`/`reassignLead`), and that `leadId`, if given, resolves to a
  lead the caller can see (RLS-scoped `findUniqueOrThrow`).
- `listTasks({ leadId? })` — every task visible under RLS, optionally
  narrowed to one lead's tasks (e.g. a "Tasks" tab on the lead detail
  view). No status/assignee filter in this slice — narrow scope per the
  brief; add if the UI needs it.
- `completeTask({ taskId })` / `reopenTask({ taskId })` — set/clear
  `completedAt`. Permission is enforced entirely by RLS's
  `can_manage_task`; nothing extra checked in application code.
- `reassignTask({ taskId, assignedTo })` — sets `assignedTo` (or clears it
  with `null`). Validates the new assignee is an org member the same way
  `createTask` does, when non-null. Unlike `reassignLead`, there's no
  separate history table to insert into first — a task reassignment is
  just the one `UPDATE`, so there's no equivalent to the
  insert-before-update ordering bug `01-leads.md` documents for leads.

### Note on the pre-existing `getTasks`

`src/lib/tasks.server.ts` already exported a `getTasks` function before
this slice — a derived, read-only view of leads that have
`nextActionAt` set (the existing `/tasks` route). That is a different
concept from this slice's `Task` rows (lead-only, no assignment/complete
lifecycle of its own) and is left untouched; the two coexist in the same
file for now rather than one absorbing the other, since unifying them is
a UI decision outside this migration's scope.

## New migration

`prisma/migrations/20260822090000_tasks_core/migration.sql` — one new
table, one new RLS helper (`app.can_manage_task`, reusing
`app.is_org_member`/`app.is_org_admin` from Phase 0, not redefining them),
three RLS policies, and one `org_id`-pinning trigger reusing the existing
`app.prevent_org_id_change()` function. Verified only against a local
throwaway Postgres per this session's testing setup — **needs
`prisma migrate deploy` (or the SQL run directly) from a machine with real
Supabase access before the Tasks feature will work anywhere but that
throwaway database, and needs human sign-off first: this is a new tenant
table with a new RLS policy, exactly what `CLAUDE.md`'s review gates flag
for mandatory review before merge.**

## Open questions for you

- Is admin/assignee/creator-only update the right bar, or should any org
  member be able to complete/reopen any task the way they can any
  `contact` edit? I chose the narrower `can_manage_task` bar because a
  task has an owner (whoever it's assigned to) in a way a shared contact
  record doesn't — closer to how `leads` gates reassignment than how
  `contacts` stays wide open.
- Is skipping a `task_activities` history table (who completed/reopened/
  reassigned, and when) acceptable, or does that audit trail matter for
  tasks the same way it does for leads? Flagging rather than guessing —
  easy to add later without a breaking schema change if it turns out to
  matter.
