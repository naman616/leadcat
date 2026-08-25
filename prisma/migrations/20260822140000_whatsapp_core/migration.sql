-- ============================================================================
-- Phase 4 (issue #31): whatsapp_templates + whatsapp_messages — shared
-- WhatsApp inbox and templates. Real provider (an actual WhatsApp Business
-- API account) is vendor-blocked; src/lib/whatsapp/provider.ts defines a
-- WhatsAppProvider interface with a MockWhatsAppProvider actually wired up
-- for now (see src/lib/whatsapp.server.ts), so swapping in a real provider
-- later is a single import change, not a rewrite. RLS enabled in this same
-- migration, same discipline as every other tenant table in this repo.
-- ============================================================================

-- CreateEnum
CREATE TYPE "whatsapp_direction" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "whatsapp_message_status" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID,
    "direction" "whatsapp_direction" NOT NULL,
    "from_number" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "template_id" UUID,
    "status" "whatsapp_message_status" NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — the lead thread view (listMessages) lists by lead, and the
-- shared inbox (listInboxMessages) lists by org, both newest-relevant first.
CREATE INDEX "whatsapp_messages_org_id_lead_id_idx" ON "whatsapp_messages"("org_id", "lead_id");

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — nullable + CASCADE: a message can exist before it's linked
-- to a lead, but if the lead is later deleted, its messages go with it (same
-- cascade shape as lead_activities/call_logs).
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — nullable + SET NULL: deleting a template shouldn't erase
-- the historical messages that were sent with it.
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "whatsapp_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security.
--
-- whatsapp_templates: read is open to any org member, same as the rest of
-- this app's shared data. Write (create/update/delete) is admin-only — same
-- shape as "org admins can delete contacts" (20260818230000_contacts_dedup)
-- and unit_price_history's admin-gated INSERT — because a real WhatsApp
-- Business template requires platform approval before it can be used, so
-- template management is a deliberate action, not routine data entry, even
-- in this mocked slice.
--
-- whatsapp_messages: mirrors lead_activities/call_logs exactly — any org
-- member can view or create a message in their own org (shared team inbox,
-- no admin gate). No UPDATE/DELETE policy yet — not exposed until there's a
-- real need for it (e.g. a provider delivery-status webhook updating status
-- after the fact, once a real provider exists).
-- ============================================================================

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view whatsapp templates"
  ON public.whatsapp_templates FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can create whatsapp templates"
  ON public.whatsapp_templates FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update whatsapp templates"
  ON public.whatsapp_templates FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete whatsapp templates"
  ON public.whatsapp_templates FOR DELETE
  USING (app.is_org_admin(org_id));

CREATE POLICY "org members can view whatsapp messages"
  ON public.whatsapp_messages FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create whatsapp messages"
  ON public.whatsapp_messages FOR INSERT
  WITH CHECK (app.is_org_member(org_id));


-- ============================================================================
-- org_id is immutable after insert on whatsapp_templates, same as
-- leads/contacts/tasks (20260815143031_fix_role_escalation_and_org_pinning,
-- 20260822090000_tasks_core) — reusing that migration's
-- app.prevent_org_id_change() trigger function, since this table has a
-- mutable UPDATE policy from day one. whatsapp_messages has no UPDATE
-- policy at all, so no trigger is needed there.
-- ============================================================================

DROP TRIGGER IF EXISTS whatsapp_templates_prevent_org_id_change ON public.whatsapp_templates;
CREATE TRIGGER whatsapp_templates_prevent_org_id_change
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();
