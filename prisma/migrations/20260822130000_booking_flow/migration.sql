-- ============================================================================
-- Phase 5 slice: booking flow, cost sheet, payment schedule, demand letters,
-- channel partners (issues #34-#38). RLS enabled in this same migration,
-- same discipline as every tenant table before it. See
-- docs/specs/06-booking.md for the full reasoning.
--
-- Money columns are DECIMAL(14,2) (channel_partners.commission_percent is
-- DECIMAL(5,2)) rather than units.price's free-text TEXT style, because this
-- slice does real arithmetic on them (cost sheet totals, payment balances) —
-- see src/lib/cost-sheets.server.ts / src/lib/booking.server.ts.
-- ============================================================================

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('draft', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_milestone_status" AS ENUM ('pending', 'paid', 'overdue');

-- CreateEnum
CREATE TYPE "demand_letter_status" AS ENUM ('draft', 'sent');

-- CreateTable
CREATE TABLE "channel_partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "commission_percent" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "booked_by" UUID,
    "channel_partner_id" UUID,
    "booking_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_price" DECIMAL(14,2) NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_sheets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "base_price" DECIMAL(14,2) NOT NULL,
    "other_charges" JSONB,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "due_amount" DECIMAL(14,2) NOT NULL,
    "due_date" TIMESTAMP(3),
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMP(3),
    "status" "payment_milestone_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_letters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "milestone_id" UUID,
    "content" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "demand_letter_status" NOT NULL DEFAULT 'draft',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_sheets_booking_id_key" ON "cost_sheets"("booking_id");

-- CreateIndex — list views below filter on these.
CREATE INDEX "channel_partners_org_id_idx" ON "channel_partners"("org_id");
CREATE INDEX "bookings_org_id_lead_id_idx" ON "bookings"("org_id", "lead_id");
CREATE INDEX "bookings_org_id_unit_id_idx" ON "bookings"("org_id", "unit_id");
CREATE INDEX "bookings_channel_partner_id_idx" ON "bookings"("channel_partner_id");
CREATE INDEX "payment_milestones_org_id_booking_id_idx" ON "payment_milestones"("org_id", "booking_id");
CREATE INDEX "demand_letters_org_id_booking_id_idx" ON "demand_letters"("org_id", "booking_id");

-- AddForeignKey
ALTER TABLE "channel_partners" ADD CONSTRAINT "channel_partners_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — losing the agent's account shouldn't take the booking down.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_fkey" FOREIGN KEY ("booked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — same reasoning for the CP attribution.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_channel_partner_id_fkey" FOREIGN KEY ("channel_partner_id") REFERENCES "channel_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — one cost sheet per booking; deleting the booking deletes it.
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_letters" ADD CONSTRAINT "demand_letters_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_letters" ADD CONSTRAINT "demand_letters_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — a demand letter isn't destroyed if its milestone goes away.
ALTER TABLE "demand_letters" ADD CONSTRAINT "demand_letters_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "payment_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- RLS helper: can the caller modify (UPDATE/DELETE) this booking? Org admins
-- always can. Any other org member can update a booking that is NOT
-- currently `confirmed` (e.g. a still-draft booking). Once a booking is
-- `confirmed`, further modification — including cancelling it via
-- status='cancelled' — requires an admin. This is what makes "cancellations
-- of a confirmed booking are admin-only" hold: cancelling a confirmed
-- booking is an UPDATE whose USING clause is evaluated against the row's
-- CURRENT (pre-update) state, so a non-admin trying to touch an
-- already-confirmed booking never even reaches WITH CHECK. SECURITY DEFINER
-- for the same reason as every other RLS helper here: avoids the calling
-- policy recursing into bookings' own RLS when this queries it.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.can_modify_booking(check_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE id = check_booking_id
      AND app.is_org_member(org_id)
      AND (
        app.is_org_admin(org_id)
        OR status != 'confirmed'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION app.can_modify_booking(UUID) TO authenticated, anon;


-- ============================================================================
-- Row Level Security.
--
-- Default posture, per docs/specs/06-booking.md: any org member can
-- create/view all five tables (mirrors leads/tasks' openness — sales
-- agents work these day to day). The one exception is bookings, where
-- deleting outright (mirrors the "org admins can delete contacts"
-- precedent) or modifying an already-confirmed booking (see
-- can_modify_booking above) is admin-only, since undoing a booking has
-- real business consequences.
-- ============================================================================

ALTER TABLE public.channel_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_letters ENABLE ROW LEVEL SECURITY;

-- channel_partners: any org member can view or create. No update/delete
-- policy in this slice — not exposed until there's a real need for it, same
-- reasoning as contacts before the dedup engine.
CREATE POLICY "org members can view channel partners"
  ON public.channel_partners FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create channel partners"
  ON public.channel_partners FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

-- bookings: any org member can view or create (createBooking makes a
-- `confirmed` booking directly — that's a normal, routine sales action, not
-- gated). Modifying (including cancelling) an already-confirmed booking, or
-- deleting any booking at all, is admin-only.
CREATE POLICY "org members can view bookings"
  ON public.bookings FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create bookings"
  ON public.bookings FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "non-admins can only modify a not-yet-confirmed booking"
  ON public.bookings FOR UPDATE
  USING (app.can_modify_booking(id))
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "org admins can delete bookings"
  ON public.bookings FOR DELETE
  USING (app.is_org_admin(org_id));

-- cost_sheets: any org member can view or create. No update/delete in this
-- slice (createCostSheet is create-only; a booking has exactly one).
CREATE POLICY "org members can view cost sheets"
  ON public.cost_sheets FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create cost sheets"
  ON public.cost_sheets FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

-- payment_milestones: any org member can view, create (generatePaymentSchedule),
-- or update (recordPayment) — routine data entry, same openness as contacts.
CREATE POLICY "org members can view payment milestones"
  ON public.payment_milestones FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create payment milestones"
  ON public.payment_milestones FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "org members can record a payment"
  ON public.payment_milestones FOR UPDATE
  USING (app.is_org_member(org_id))
  WITH CHECK (app.is_org_member(org_id));

-- demand_letters: any org member can view or create (generateDemandLetter).
-- No update/delete — no "mark as sent" server function in this slice; add
-- later if that becomes a real workflow.
CREATE POLICY "org members can view demand letters"
  ON public.demand_letters FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create demand letters"
  ON public.demand_letters FOR INSERT
  WITH CHECK (app.is_org_member(org_id));


-- ----------------------------------------------------------------------------
-- Pin org_id on UPDATE, same as every other org-scoped table
-- (*_fix_role_escalation_and_org_pinning) — reuses that migration's generic
-- app.prevent_org_id_change() trigger function. Applied uniformly across all
-- five tables, not just the two with an UPDATE policy today, matching the
-- inventory_core precedent (towers got the trigger despite no UPDATE policy
-- existing yet) — defense in depth against a future UPDATE policy being
-- added without remembering this.
-- ----------------------------------------------------------------------------

CREATE TRIGGER channel_partners_prevent_org_id_change
  BEFORE UPDATE ON public.channel_partners
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER bookings_prevent_org_id_change
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER cost_sheets_prevent_org_id_change
  BEFORE UPDATE ON public.cost_sheets
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER payment_milestones_prevent_org_id_change
  BEFORE UPDATE ON public.payment_milestones
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER demand_letters_prevent_org_id_change
  BEFORE UPDATE ON public.demand_letters
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();
