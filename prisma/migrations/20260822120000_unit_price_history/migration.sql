-- ============================================================================
-- Phase 2 follow-up: unit_price_history. Deferred out of 20260818220000_
-- inventory_core on purpose (see docs/specs/02-inventory.md's "explicitly
-- deferred" list) — this is that follow-up slice. RLS enabled in this same
-- migration, same discipline as every other tenant table in this repo.
--
-- No DB trigger writes this table. src/lib/unit-price.server.ts's
-- updateUnitPrice writes units.price and inserts the matching history row
-- together in one Prisma transaction, mirroring how mergeContacts
-- (20260818230000_contacts_dedup / src/lib/dedup.server.ts) does its
-- multi-step write.
-- ============================================================================

-- CreateTable
CREATE TABLE "unit_price_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "price" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — history views below list by unit, newest first.
CREATE INDEX "unit_price_history_org_id_unit_id_idx" ON "unit_price_history"("org_id", "unit_id");

-- AddForeignKey
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security.
--
-- Read is open to any org member, same as the rest of inventory. Write is
-- admin-only — same shape as "org admins can delete contacts" in
-- 20260818230000_contacts_dedup (app.is_org_admin(org_id)) — because a
-- price change is a decision, not routine data entry like creating a unit.
-- Insert-only/immutable: no UPDATE or DELETE policy, same reasoning as
-- lead_activities ("an audit trail that can be edited after the fact isn't
-- one") — not exposed until there's a real need for it.
-- ============================================================================

ALTER TABLE public.unit_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view unit price history"
  ON public.unit_price_history FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can record a unit price change"
  ON public.unit_price_history FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));
