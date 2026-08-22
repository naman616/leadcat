-- ============================================================================
-- Phase 4 (issue #30): call_logs — click-to-call, recording metadata, and
-- auto-logged timeline entries. Real provider (Exotel/Knowlarity/Twilio) is
-- vendor-blocked; src/lib/telephony/provider.ts defines a TelephonyProvider
-- interface with a MockTelephonyProvider actually wired up for now (see
-- src/lib/telephony.server.ts), so swapping in a real provider later is a
-- single import change, not a rewrite. RLS enabled in this same migration,
-- same discipline as every other tenant table in this repo.
-- ============================================================================

-- CreateEnum
CREATE TYPE "call_direction" AS ENUM ('outbound', 'inbound');

-- CreateEnum
CREATE TYPE "call_status" AS ENUM ('initiated', 'ringing', 'answered', 'completed', 'failed', 'no_answer');

-- CreateTable
CREATE TABLE "call_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "direction" "call_direction" NOT NULL,
    "from_number" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "initiated_by" UUID,
    "status" "call_status" NOT NULL DEFAULT 'initiated',
    "duration_seconds" INTEGER,
    "recording_url" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — the lead timeline / call history view lists by lead, newest first.
CREATE INDEX "call_logs_org_id_lead_id_idx" ON "call_logs"("org_id", "lead_id");

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security.
--
-- Mirrors lead_activities exactly: any org member can view or create a call
-- log in their own org — calls are made by agents on their own leads, no
-- admin gate needed. No UPDATE/DELETE policy yet — not exposed until there's
-- a real need for it (e.g. a provider status-callback webhook updating
-- status/duration/recordingUrl after the fact once a real provider exists).
-- ============================================================================

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view call logs"
  ON public.call_logs FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create call logs"
  ON public.call_logs FOR INSERT
  WITH CHECK (app.is_org_member(org_id));
