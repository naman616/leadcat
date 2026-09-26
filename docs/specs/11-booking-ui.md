# 11 — Booking UI (lead → booking → cost sheet → payments → demand letters)

Status: proposed. This is a UI spec on top of the backend already specced in
`06-booking.md`; nothing here needs sign-off beyond the usual review of
money-adjacent UI code (`CLAUDE.md` review gates), and **no migration is
involved**.

## Goal

Let a sales agent take a lead through the sale entirely in the UI: book a
unit, price it with a cost sheet, plan the payment schedule and record
payments, then generate demand letters. Channel partners come in as an
optional field on the booking. Today all of this exists as server functions
(`src/lib/booking.server.ts`, `src/lib/channel-partners.server.ts`) with no
UI; there is no bookings route and no nav item.

Success: an agent can complete the whole flow without calling the API by
hand.

## Decisions made (with the user)

- **Entry point:** a "Book a unit" action in the lead preview panel
  (`src/routes/leads.tsx`, `LeadPreview`), next to WhatsApp/SMS/Call. The
  lead is the deal.
- **Home for post-booking work:** a new `/bookings` route with a
  `/bookings/$bookingId` detail page. Not the lead panel (too narrow for a
  payment table) and not `/invoice` (an unrelated stub; left untouched).
- **Slicing:** three phases, one PR each, so each is reviewable alone.

## Constraints

- No backend, schema, RLS, or dependency changes. Permissions are enforced
  only by RLS as specced in `06-booking.md`; the UI adds no checks and
  surfaces a denial as an error toast.
- Use existing shadcn components in `src/components/ui`. Server state via
  TanStack Query, local state via `useState`, matching the surrounding
  routes.
- Every phase PR is flagged for human review; phase 2 handles money.

## Phase 1 — Book from the lead, bookings list, channel partners

- **"Book a unit" dialog** (header button in `LeadPreview`): available-unit
  picker (the existing inventory unit list filtered to status `Available`),
  total price, optional channel partner select. Calls `createBooking`.
- **Price handling:** `units.price` is free-text but `createBooking`'s
  `totalPrice` is a decimal (`moneySchema`). Prefill from the unit only when
  it parses as a number; the field stays required and editable so the agent
  confirms the number. The UI never silently converts.
- **Channel partners:** a "New partner" dialog reachable from the booking
  dialog (`createChannelPartner`, `listChannelPartners`). No standalone
  partners page in this slice.
- **`/bookings`:** list with lead, unit, price, status, partner, date; rows
  link to `/bookings/$bookingId`. New "Bookings" nav item beside Properties.
- **`/bookings/$bookingId` (phase 1):** read-only booking summary. Tabs for
  later phases are not rendered yet.
- **Lead preview:** a "Bookings" line under Overview when the lead has any,
  from `listBookings({ leadId })`.
- After a successful booking, invalidate the lead, bookings, and units
  queries (`createBooking` flips the unit to `Booked` and logs a system
  activity).

## Phase 2 — Booking detail: cost sheet and payments

- **Cost sheet tab:** base price plus a key/value editor for other charges
  (floor rise, parking, GST, ...); shows the computed total. One cost sheet
  per booking (`createCostSheet`; the schema has `booking_id` unique), so
  the form is create-only and the tab shows the sheet read-only once it
  exists.
- **Payments tab:**
  - Schedule generator: rows of label, amount, optional due date
    (`generatePaymentSchedule`), with a running sum shown against the cost
    sheet total (or booking total price if no cost sheet). A mismatch is a
    warning, not a block.
  - Milestone table with paid/due amounts and a "Record payment" action
    (`recordPayment`).
- **Overdue display:** a milestone whose `dueDate` is past and which is not
  `paid` is *displayed* as overdue in the UI. The stored status is never
  changed, per the `06-booking.md` deferral (no scheduler exists).

## Phase 3 — Demand letters

- Per-milestone "Generate demand letter" (`generateDemandLetter`); the
  plain-text result opens in a dialog with copy-to-clipboard. A letters list
  on the detail page (`listDemandLetters`).

## Out of scope

Same list as `06-booking.md`, unchanged: cancelling or editing a booking,
PDF letters, commission calculation and payouts, editing/deleting partners
or cost sheets, marking a letter `sent`. The three open policy questions in
`06-booking.md` (admin-gating confirmed bookings, `overdue` semantics, who
may confirm) remain open; this UI does not decide them.

## Error handling

Mutations follow the existing pattern: `onError` toast with the server
message, `onSuccess` invalidates the relevant query keys and closes the
dialog. The list and detail pages have loading and error states.

## Testing

There is no UI test harness in this repo. Each phase is verified with
`bun run typecheck`, `bun run lint`, and prettier, then in a browser once a
local Supabase stack or test account is available. Until then, each PR is
labelled as not exercised in a browser.
