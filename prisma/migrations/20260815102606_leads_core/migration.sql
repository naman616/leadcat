-- ============================================================================
-- Phase 1 slice: contacts, leads, lead_activities, lead_assignments.
-- RLS enabled in this same migration, same discipline as Phase 0.
-- See docs/specs/01-leads.md for the reasoning behind what's in vs. deferred.
-- ============================================================================

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('New', 'Follow Up', 'Callback', 'Site Visit', 'Booked', 'Dropped');

-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('note', 'status_change', 'call', 'whatsapp', 'email', 'system');

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "assigned_to" UUID,
    "status" "lead_status" NOT NULL DEFAULT 'New',
    "sub_status" TEXT,
    "source" TEXT,
    "sub_source" TEXT,
    "project" TEXT,
    "budget" TEXT,
    "requirement" TEXT,
    "city" TEXT,
    "next_action_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_id" UUID,
    "ad_id" UUID,
    "ad_set_id" UUID,
    "campaign_id" UUID,
    "creative_id" TEXT,
    "form_id" TEXT,
    "platform_lead_id" TEXT,
    "click_id" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "landing_page_url" TEXT,
    "referrer_url" TEXT,
    "first_touch_ad_id" UUID,
    "raw_payload" JSONB,
    "captured_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" "activity_type" NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "assigned_to" UUID NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — every report/list view below filters on these.
CREATE INDEX "leads_org_id_status_idx" ON "leads"("org_id", "status");
CREATE INDEX "leads_org_id_assigned_to_idx" ON "leads"("org_id", "assigned_to");
CREATE INDEX "lead_activities_lead_id_idx" ON "lead_activities"("lead_id");
CREATE INDEX "lead_assignments_lead_id_idx" ON "lead_assignments"("lead_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- RLS helper: can the caller manage (update / reassign) this lead? Org
-- admins always can; otherwise only the lead's current assignee (handing
-- off their own lead) or anyone if the lead is currently unassigned
-- (picking up an unclaimed lead). SECURITY DEFINER for the same reason as
-- Phase 0's helpers: avoids the calling policy recursing into leads' own
-- RLS when this queries it.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.can_manage_lead(check_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads
    WHERE id = check_lead_id
      -- Org membership first, always — without this, "assigned_to IS NULL"
      -- alone would let a user from a completely different org claim an
      -- unclaimed lead that isn't even in their org.
      AND app.is_org_member(org_id)
      AND (
        app.is_org_admin(org_id)
        OR assigned_to = auth.uid()
        OR assigned_to IS NULL
      )
  );
$$;

GRANT EXECUTE ON FUNCTION app.can_manage_lead(UUID) TO authenticated, anon;


-- ============================================================================
-- Row Level Security.
-- ============================================================================

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;

-- contacts: any org member can view, create, or edit a shared contact.
-- No DELETE policy yet — not exposed until there's a real need for it.
CREATE POLICY "org members can view contacts"
  ON public.contacts FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "org members can update contacts"
  ON public.contacts FOR UPDATE
  USING (app.is_org_member(org_id))
  WITH CHECK (app.is_org_member(org_id));

-- leads: any org member can view or create. Updates (including
-- reassignment, which is a normal UPDATE of assigned_to plus an INSERT into
-- lead_assignments — see reassignLead in src/lib/leads.server.ts) are
-- gated by can_manage_lead: org admins always, otherwise only the current
-- assignee or anyone if it's unclaimed.
CREATE POLICY "org members can view leads"
  ON public.leads FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create leads"
  ON public.leads FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "assignee, unclaimed, or admin can update a lead"
  ON public.leads FOR UPDATE
  USING (app.can_manage_lead(id))
  WITH CHECK (app.is_org_member(org_id));

-- lead_activities: append-only timeline. Any org member can view or add an
-- entry; deliberately no UPDATE/DELETE policy — an activity log that can be
-- edited after the fact isn't an audit trail.
CREATE POLICY "org members can view lead activities"
  ON public.lead_activities FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can add lead activities"
  ON public.lead_activities FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

-- lead_assignments: append-only history. Same reasoning as lead_activities
-- — no UPDATE/DELETE. Who may INSERT mirrors exactly who may update the
-- lead itself, via the same helper.
CREATE POLICY "org members can view lead assignment history"
  ON public.lead_assignments FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "assignee, unclaimed, or admin can record an assignment"
  ON public.lead_assignments FOR INSERT
  WITH CHECK (app.can_manage_lead(lead_id));
