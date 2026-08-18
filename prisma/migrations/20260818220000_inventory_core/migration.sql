-- ============================================================================
-- Phase 2 slice: projects, towers, units. RLS enabled in this same
-- migration, same discipline as Phase 0/1. See docs/specs/02-inventory.md
-- for the reasoning behind what's in vs. deferred.
-- ============================================================================

-- CreateEnum
CREATE TYPE "project_type" AS ENUM ('Residential', 'Commercial', 'Agricultural');

-- CreateEnum
CREATE TYPE "unit_status" AS ENUM ('Available', 'Blocked', 'Booked', 'Registered');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "type" "project_type" NOT NULL,
    "starting_price" TEXT,
    "unit_config_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "towers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "towers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "tower_id" UUID,
    "unit_number" TEXT NOT NULL,
    "configuration" TEXT,
    "floor" TEXT,
    "area" TEXT,
    "price" TEXT,
    "status" "unit_status" NOT NULL DEFAULT 'Available',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — list/filter views below filter on these.
CREATE INDEX "projects_org_id_idx" ON "projects"("org_id");
CREATE INDEX "towers_org_id_project_id_idx" ON "towers"("org_id", "project_id");
CREATE INDEX "units_org_id_project_id_idx" ON "units"("org_id", "project_id");
CREATE INDEX "units_org_id_status_idx" ON "units"("org_id", "status");
CREATE INDEX "units_tower_id_idx" ON "units"("tower_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "towers" ADD CONSTRAINT "towers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "towers" ADD CONSTRAINT "towers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tower_id_fkey" FOREIGN KEY ("tower_id") REFERENCES "towers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security.
--
-- Unlike leads, inventory has no per-row ownership concept — any org
-- member can create, read, and update projects/towers/units, same
-- openness as contacts in Phase 1 (see docs/specs/02-inventory.md). No
-- DELETE policy on any of the three tables in this slice — deleting
-- inventory that might already be referenced by leads/bookings needs its
-- own cascade story; an attempted delete fails closed, same as any other
-- RLS-blocked write in this app.
-- ============================================================================

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.towers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view projects"
  ON public.projects FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create projects"
  ON public.projects FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "org members can update projects"
  ON public.projects FOR UPDATE
  USING (app.is_org_member(org_id))
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "org members can view towers"
  ON public.towers FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create towers"
  ON public.towers FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "org members can view units"
  ON public.units FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create units"
  ON public.units FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "org members can update units"
  ON public.units FOR UPDATE
  USING (app.is_org_member(org_id))
  WITH CHECK (app.is_org_member(org_id));


-- ----------------------------------------------------------------------------
-- Pin org_id on UPDATE, same as leads/contacts (see
-- *_fix_role_escalation_and_org_pinning) — reuses that migration's generic
-- app.prevent_org_id_change() trigger function rather than redefining it.
-- ----------------------------------------------------------------------------

CREATE TRIGGER projects_prevent_org_id_change
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER towers_prevent_org_id_change
  BEFORE UPDATE ON public.towers
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER units_prevent_org_id_change
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();
