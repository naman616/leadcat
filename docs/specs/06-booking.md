# 06 — Booking Flow, Cost Sheet, Payment Schedule, Demand Letters, Channel Partners

Status: proposed, not yet built beyond this slice. Same "spec before code"
discipline as `01-leads.md` through `04-tasks.md` — this needs sign-off
before the migration is applied anywhere beyond a local throwaway database.

Phase 5 (issues #34-#38), described in the build plan as the product's
differentiator. All five pieces are one cohesive flow — booking creates the
sale, a cost sheet prices it, a payment schedule tracks collection against
it, demand letters chase individual installments, and a channel partner is
an optional attribution on the booking itself — so they ship together in
one migration and mostly one server-function file, rather than as five
unrelated slices.

## What's in this slice vs. deferred

**This slice (now):**

- `channel_partners`, `bookings`, `cost_sheets`, `payment_milestones`,
  `demand_letters` — five new org-scoped tables, RLS enabled in the
  migration that creates them.
- `createBooking`: one transaction that creates a `confirmed` `Booking`,
  flips the linked `Unit.status` to `Booked`, and logs a `system`
  `LeadActivity` — same shape as `updateUnitPrice`
  (`src/lib/unit-price.server.ts`) and `mergeContacts`
  (`src/lib/dedup.server.ts`).
- `createCostSheet`: computes `totalAmount` from `basePrice` plus the sum
  of whatever numeric values are in the free-form `otherCharges` JSON bag
  (e.g. `{ floorRise, parking, gst }`).
- `generatePaymentSchedule` / `recordPayment`: bulk-create a booking's
  installment plan, then record payments against one milestone at a time.
- `generateDemandLetter`: builds plain interpolated text (booking + unit +
  contact + milestone details) and stores it — no PDF rendering, no new
  dependency (`CLAUDE.md`: "ask before adding new dependencies").
- `createChannelPartner` / `listChannelPartners`, and an optional
  `channelPartnerId` on `Booking` for commission attribution.
- List functions for all five tables.

**Explicitly deferred to a later session:**

- **Real PDF generation for demand letters.** `content` is readable
  text/markdown today; wiring an actual PDF library/renderer is a
  separate integration decision, flagged rather than guessed at here.
- **Commission calculation / payout tracking for channel partners.**
  `commissionPercent` is stored, but nothing computes a commission amount
  owed or tracks its payout — that needs its own design once there's a
  concrete payout workflow to build against.
- **`overdue` milestone status.** The enum has the value, but nothing in
  this slice ever sets it — that needs a scheduled comparison of `dueDate`
  against "now," and this repo has no background-job infra yet
  (`CLAUDE.md`: "flag if a feature seems to need one — don't reach for
  Inngest prematurely"). A milestone sits at `pending` until fully paid.
- **Editing/deleting a channel partner, cost sheet, or demand letter.**
  Only create + list exist for these three, same "not exposed until
  there's a real need for it" reasoning as `contacts` before the dedup
  engine.
- **Marking a demand letter `sent`.** The `status` enum (`draft`/`sent`)
  exists on the model, but no server function transitions it yet —
  `generateDemandLetter` always creates one in `draft`.
- **Cancelling a `draft` booking, or un-cancelling one.** Only
  `createBooking` (which always lands as `confirmed`) exists; a
  `cancelBooking`-style function reusing the RLS `UPDATE` policy below is
  a small follow-up, not added speculatively now.
- **Reverting `Unit.status` when a booking is cancelled.** Since nothing
  cancels a booking yet (see above), nothing un-books the unit either —
  both are the same follow-up.

## Data model

### `channel_partners`

| column                | type          | notes                                    |
| ---------------------- | ------------- | ----------------------------------------- |
| `id`                   | uuid, pk      |                                            |
| `org_id`               | uuid, fk      | → `organizations.id`                      |
| `name`                 | text          |                                            |
| `contact_phone`        | text          | nullable                                  |
| `contact_email`        | text          | nullable                                  |
| `commission_percent`   | decimal(5,2)  | nullable                                  |
| `created_at`           | timestamptz   |                                            |

### `bookings`

| column                | type            | notes                                                        |
| ---------------------- | --------------- | -------------------------------------------------------------- |
| `id`                   | uuid, pk        |                                                                  |
| `org_id`               | uuid, fk        | → `organizations.id`                                            |
| `lead_id`              | uuid, fk        | → `leads.id`, cascade                                           |
| `unit_id`              | uuid, fk        | → `units.id`, cascade                                           |
| `booked_by`            | uuid, fk        | → `users.id`, nullable, `SET NULL`                              |
| `channel_partner_id`   | uuid, fk        | → `channel_partners.id`, nullable, `SET NULL`                   |
| `booking_date`         | timestamptz     | defaults to now()                                               |
| `total_price`          | decimal(14,2)   |                                                                  |
| `status`               | enum            | `draft` / `confirmed` / `cancelled`, defaults `draft` at the schema level, but `createBooking` always writes `confirmed` |
| `created_at`           | timestamptz     |                                                                  |

### `cost_sheets`

One per booking (`booking_id` is `@unique`).

| column           | type          | notes                                                    |
| ----------------- | ------------- | ----------------------------------------------------------- |
| `id`              | uuid, pk      |                                                               |
| `org_id`          | uuid, fk      | → `organizations.id`                                         |
| `booking_id`      | uuid, fk      | → `bookings.id`, cascade, unique                              |
| `base_price`      | decimal(14,2) |                                                               |
| `other_charges`   | jsonb         | nullable, free-form (`{ floorRise, parking, gst, ... }`)      |
| `total_amount`    | decimal(14,2) | `base_price` + sum of `other_charges`' numeric values         |
| `created_at`      | timestamptz   |                                                               |

### `payment_milestones`

| column         | type          | notes                                             |
| --------------- | ------------- | ---------------------------------------------------- |
| `id`            | uuid, pk      |                                                       |
| `org_id`        | uuid, fk      | → `organizations.id`                                 |
| `booking_id`    | uuid, fk      | → `bookings.id`, cascade                             |
| `label`         | text          | e.g. "Booking Amount", "On Foundation"               |
| `due_amount`    | decimal(14,2) |                                                       |
| `due_date`      | timestamptz   | nullable                                             |
| `paid_amount`   | decimal(14,2) | default 0                                            |
| `paid_at`       | timestamptz   | nullable, set to the timestamp of the latest payment |
| `status`        | enum          | `pending` / `paid` / `overdue`, defaults `pending`   |
| `created_at`    | timestamptz   |                                                       |

### `demand_letters`

| column          | type          | notes                                                    |
| ---------------- | ------------- | ------------------------------------------------------------ |
| `id`             | uuid, pk      |                                                                |
| `org_id`         | uuid, fk      | → `organizations.id`                                          |
| `booking_id`     | uuid, fk      | → `bookings.id`, cascade                                      |
| `milestone_id`   | uuid, fk      | → `payment_milestones.id`, nullable, `SET NULL`                |
| `content`        | text          | generated letter body, plain text/markdown                    |
| `amount`         | decimal(14,2) | the milestone's remaining balance at generation time (`due_amount - paid_amount`) |
| `status`         | enum          | `draft` / `sent`, defaults `draft`                             |
| `generated_at`   | timestamptz   |                                                                |

Money columns are `DECIMAL`, not `units.price`'s free-text `TEXT` style —
unlike a unit's list price, this slice does real arithmetic on these values
(cost sheet totals, payment balances), so a numeric type keeps that math in
the database's own type system instead of parsed strings in application
code.

## RLS

Default posture, matching `leads`/`tasks`' openness (sales agents work
these day to day): any org member can view and create rows in all five
tables. `payment_milestones` additionally allows any org member to
`UPDATE` (that's what `recordPayment` does).

The one deliberate exception is `bookings`:

- **DELETE** is admin-only (`app.is_org_admin(org_id)`) — reusing the
  "org admins can delete contacts" precedent from
  `20260818230000_contacts_dedup` verbatim, since undoing a booking has
  real business consequences.
- **UPDATE** is gated by a new `app.can_modify_booking(check_booking_id)`
  helper, same `SECURITY DEFINER` shape as `app.can_manage_lead` /
  `app.can_manage_task`: org admins can always update a booking; any other
  org member can only update a booking that is **not currently
  `confirmed`**. Since `createBooking` always lands a booking as
  `confirmed` immediately, in practice this means: any org member can
  create a booking, but once it's confirmed, only an admin can modify it
  further — which is exactly what "cancellations of a confirmed booking
  are admin-only" needs, expressed as an `UPDATE` (`status` → `cancelled`)
  rather than a separate cancellation policy. `UPDATE`'s `USING` clause
  evaluates against the row's state *before* the update, so a non-admin's
  attempt to touch an already-confirmed booking is rejected before it
  ever reaches `WITH CHECK` — same mechanics as `can_manage_task`'s
  admin/assignee/creator gate.

`org_id` is pinned immutable on all five tables via the existing
`app.prevent_org_id_change()` trigger (from
`20260815143031_fix_role_escalation_and_org_pinning`), applied uniformly
regardless of whether an `UPDATE` policy exists today — same precedent as
`towers` in `20260818220000_inventory_core`, which got the trigger despite
having no `UPDATE` policy at the time.

## Server functions

`src/lib/channel-partners.server.ts`:

- `createChannelPartner({ name, contactPhone?, contactEmail?, commissionPercent? })`
- `listChannelPartners()`

`src/lib/booking.server.ts`:

- `createBooking({ leadId, unitId, totalPrice, channelPartnerId? })` — see
  "What's in this slice" above for the transactional shape. Explicitly
  re-checks that the lead and unit (and, if given, the channel partner)
  belong to the same org, the same cross-org-pinning defense-in-depth
  `mergeContacts` applies to duplicate contacts — a caller who belongs to
  more than one org could otherwise pair a lead from org A with a unit
  from org B, since each is individually RLS-visible to them.
- `listBookings({ leadId? })`
- `createCostSheet({ bookingId, basePrice, otherCharges? })`
- `listCostSheets({ bookingId? })`
- `generatePaymentSchedule({ bookingId, milestones: [{ label, dueAmount, dueDate? }] })`
- `listPaymentMilestones({ bookingId? })`
- `recordPayment({ milestoneId, amount })` — adds `amount` to the
  milestone's `paidAmount`, sets `paidAt` to now, and sets `status` to
  `paid` once `paidAmount >= dueAmount` (otherwise leaves it `pending`;
  see "explicitly deferred" for why `overdue` is never set here).
- `generateDemandLetter({ bookingId, milestoneId })` — validates the
  milestone actually belongs to the given booking, then interpolates
  booking/unit/contact/milestone details into a plain-text template.
- `listDemandLetters({ bookingId? })`

## New migration

`prisma/migrations/20260822130000_booking_flow/migration.sql` — five new
tables, three new enums, one new RLS helper
(`app.can_modify_booking`, reusing `app.is_org_member` / `app.is_org_admin`
from Phase 0, not redefining them), the RLS policies above, and five
`org_id`-pinning triggers reusing the existing
`app.prevent_org_id_change()` function. Verified only against a local
throwaway Postgres per this session's testing setup — **needs
`prisma migrate deploy` (or the SQL run directly) from a machine with real
Supabase access before this feature will work anywhere but that throwaway
database, and needs human sign-off first: five new tenant tables with new
RLS policies, exactly what `CLAUDE.md`'s review gates flag for mandatory
review before merge.**

## Open questions for you

- Is admin-gating *all* booking `UPDATE`s once a booking is `confirmed`
  (not just the `status → cancelled` transition specifically) too broad?
  As written, an admin is also required to fix a typo'd `totalPrice` on
  an already-confirmed booking, not just to cancel it. I chose the
  broader rule because Postgres RLS's `UPDATE` policy can't distinguish
  "which columns changed" cheaply, and a confirmed booking's `totalPrice`
  changing quietly feels like it deserves the same bar as cancelling it
  outright — flagging rather than guessing that this is definitely right.
- Is `paid_amount >= due_amount → paid`, otherwise always `pending`
  (never `overdue`) the right behavior for `recordPayment`, or should a
  partial payment past `due_date` be marked `overdue` immediately rather
  than waiting on a future scheduled sweep? I left it fully deferred
  since there's no background-job infra to run that sweep yet.
- Is any-org-member-can-create-a-`confirmed`-booking (no draft-then-
  confirm step, no approval gate) the right bar for something this
  consequential, or should booking confirmation itself require an admin,
  the same way cancelling one does? I matched it to `leads`/`contacts`'
  openness per the brief ("sales agents need to work bookings day to
  day"), but flagging since a booking is a bigger commitment than a lead
  edit.
