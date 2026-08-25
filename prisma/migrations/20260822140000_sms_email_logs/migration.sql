-- ============================================================================
-- Phase 4 (issues #32/#33): SMS (DLT-registered, vendor-blocked) and
-- transactional/campaign email. Both providers are stubbed behind a small
-- interface (src/lib/sms/provider.ts, src/lib/email/provider.ts) pending a
-- real SMS DLT registration / transactional email account — see
-- src/lib/sms.server.ts and src/lib/email.server.ts. sms_logs and
-- email_logs are the send logs; RLS enabled in this same migration, same
-- discipline as every tenant table before it.
--
-- ActivityType gets a new 'sms' value alongside the existing 'call',
-- 'whatsapp', 'email' — every other channel already gets its own dedicated
-- activity type, so this follows that existing convention rather than
-- overloading 'note' with a text prefix.
-- ============================================================================

-- AlterEnum
ALTER TYPE "activity_type" ADD VALUE 'sms';

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('queued', 'sent', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "sms_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID,
    "to_number" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — "this lead's SMS/email history" is the list view both
-- sendSms/sendEmail and listSmsLogs/listEmailLogs need.
CREATE INDEX "sms_logs_org_id_lead_id_idx" ON "sms_logs"("org_id", "lead_id");
CREATE INDEX "email_logs_org_id_lead_id_idx" ON "email_logs"("org_id", "lead_id");

-- AddForeignKey
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — nullable + cascade: a send doesn't have to be tied to a
-- lead, but if the lead is deleted, its send logs go with it (same shape as
-- tasks_lead_id_fkey, not call_logs_lead_id_fkey which is required).
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security.
-- ============================================================================

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- sms_logs / email_logs: day-to-day agent actions (sending a text/email to
-- a lead), not an admin-gated action — mirrors lead_activities' openness.
-- Any org member can view or create; no UPDATE/DELETE policy, same
-- append-only reasoning as lead_activities/lead_assignments (a send log
-- that can be edited after the fact isn't an audit trail). Status
-- transitions (queued -> sent/delivered/failed) would need their own policy
-- decision when a real provider with delivery webhooks exists — not needed
-- yet since the mock providers resolve synchronously to a terminal status
-- at create time.
CREATE POLICY "org members can view sms logs"
  ON public.sms_logs FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create sms logs"
  ON public.sms_logs FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "org members can view email logs"
  ON public.email_logs FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create email logs"
  ON public.email_logs FOR INSERT
  WITH CHECK (app.is_org_member(org_id));
