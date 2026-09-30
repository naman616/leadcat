# Ad reports — design

Status: draft for review. Phase 6 (readme §7), ad reports from §3.5.5.

## Goal

A sales head can see which ads produce bookings and which burn budget, from
one screen. Success: the six views below render real data for the signed-in
org, the leaderboard defaults to cost per booking, and no query can return
another tenant's rows.

## Scope

New route `/ad-reports` (tab per view, shared date-range filter, default last
30 days) plus a nav link in `AppShell`. The mocked `/reports` agent-activity
page is untouched; sales-team reports are a separate slice.

No migration, no new dependency, no background job.

Out of scope:

- "Kill a losing ad" from the leaderboard. Needs Meta/Google write access;
  only the mock provider exists.
- Reach and qualified columns. No `reach` column in `AdDailyStat` and no
  "qualified" lead status. Dropped rather than faked, as in
  `dashboard.server.ts`.
- Sales-team reports (funnel by executive, TAT, leaderboard, targets).

## Data layer

`src/lib/ad-reports.server.ts` — one server function,
`getAdReport({ from, to })`, input validated with Zod. One `withUserContext`
transaction fetches:

- ad hierarchy (ad -> ad set -> campaign);
- `AdDailyStat` summed per ad over the range;
- leads created in range, grouped by `adId` and by `firstTouchAdId`, with
  counts by status;
- confirmed bookings with `bookingDate` in range, joined to the lead's ad,
  with `totalPrice` summed.

It builds one row per ad: spend, impressions, clicks, leads, siteVisits,
bookings, bookingValue, plus first-touch leads/bookings.

`src/lib/ad-reports.ts` — pure functions (no I/O) that turn those rows into
the six views and compute CPL, cost per site visit, cost per booking, ROI and
drop-off %. Follows the `lead-scoring.ts` / `lead-scoring.server.ts` split.

## Views

- **Leaderboard** — per ad. Sorted by cost per booking; ads with zero bookings
  sort last, ordered by CPL. CPL shown beside it. Lead count is never the
  headline.
- **Creative comparison** — the same rows grouped by ad set.
- **Campaign ROI** — booking value / spend per campaign, with booking value
  broken down by `Lead.project`. `Lead.project` is free text and spend cannot
  be split by project, so ROI is per campaign only.
- **Funnel** — impressions -> clicks -> leads -> site visit -> booked, with
  drop-off % per step. A lead counts as a site visit if its status is Site
  Visit or Booked; bookings come from the `Booking` table. Leads now Dropped
  count only as leads, so site visits are a lower bound and the UI says so.
- **First vs last touch** — leads and bookings per ad under `firstTouchAdId`
  vs `adId`. Ads where the two disagree beyond a threshold are flagged.
- **Stale ads** — spend > 0 in the last 7 days and zero leads in that window.
  Fixed 7-day window, ignores the date filter.

Bookings are attributed by booking date, so a booking in range may come from a
lead created before the range. Accepted.

## Tenancy and errors

- All queries go through `withUserContext`. No service role, no raw `prisma`.
  Missing org context returns empty rows (RLS), never an error.
- Division by zero yields `null`, rendered "—". Never Infinity or a fake 0.
- Tenancy-adjacent: flag for explicit human review before merge (CLAUDE.md).

## Testing and export

- Vitest on `ad-reports.ts`: ROI, sort order with zero-booking ads, funnel
  drop-off, stale detection, touch disagreement, null on zero denominators.
- Leaderboard CSV export reuses `src/lib/csv.ts`.
