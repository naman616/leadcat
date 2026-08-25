-- ============================================================================
-- Phase 8 slice (partial), issue #50: auto-assignment rules + lead scoring
-- v1. assignment_rules is a new tenant table, RLS enabled in this same
-- migration per CLAUDE.md. leads.score is a plain nullable column governed
-- by leads' existing RLS policies (any column update already goes through
-- app.can_manage_lead) — no policy changes needed for it.
-- ============================================================================

-- CreateEnum
CREATE TYPE "assignment_mode" AS ENUM ('manual', 'round_robin', 'load_balanced');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "score" INTEGER;

-- CreateTable
CREATE TABLE "assignment_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "mode" "assignment_mode" NOT NULL DEFAULT 'manual',
    "last_assigned_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — one active rule per org (upsert semantics, see
-- setAssignmentRule in src/lib/auto-assignment.server.ts).
CREATE UNIQUE INDEX "assignment_rules_org_id_key" ON "assignment_rules"("org_id");

-- AddForeignKey
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — round-robin cursor. SetNull, not Cascade: if the cursor's
-- user is removed from the system, the rule row survives and the next pick
-- just starts back at the top of the eligible list (see pickRoundRobinAgent
-- in src/lib/auto-assignment.ts, which already treats an unrecognized
-- lastAssignedUserId the same as null).
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_last_assigned_user_id_fkey" FOREIGN KEY ("last_assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security.
--
-- Read is open to any org member — autoAssignLead is invoked from the
-- lead-creation flow by any member, not just admins, and needs to read the
-- rule to decide whether/how to route the lead.
--
-- INSERT (and therefore setAssignmentRule's upsert on a brand new rule) is
-- admin-only, same shape as unit_price_history's INSERT policy: changing
-- how leads route is a configuration decision, not routine data entry.
--
-- UPDATE is intentionally left open to any org member at the RLS-policy
-- level, NOT admin-only — because autoAssignLead (any member) needs to
-- advance the round-robin cursor (last_assigned_user_id) as a normal part
-- of assigning a lead. Restricting the privileged part of an UPDATE —
-- changing `mode` — is handled below by a trigger, the same technique
-- app.prevent_org_id_change already uses to protect one column beyond what
-- a row-level USING/WITH CHECK can cleanly express. setAssignmentRule
-- additionally checks the caller's role in application code before its
-- upsert (mirroring mergeContacts' explicit role check), so a rejected mode
-- change fails with a clear message rather than a raw RLS error whenever
-- possible — the trigger is the real enforcement backstop either way.
-- ============================================================================

ALTER TABLE public.assignment_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view their assignment rule"
  ON public.assignment_rules FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can create an assignment rule"
  ON public.assignment_rules FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org members can update their assignment rule"
  ON public.assignment_rules FOR UPDATE
  USING (app.is_org_member(org_id))
  WITH CHECK (app.is_org_member(org_id));

-- No DELETE policy — not exposed until there's a real need for it, same
-- reasoning as contacts before the dedup engine.


-- ============================================================================
-- Column-level guard: only an org admin may change `mode` on an existing
-- rule. UPDATE's own RLS policy above is deliberately broader (any org
-- member, so the round-robin cursor can be advanced by autoAssignLead) —
-- this trigger is what actually keeps the assignment-mode decision
-- admin-only, the same way app.prevent_org_id_change protects org_id on
-- leads/contacts/tasks even though those tables' UPDATE policies are
-- broader than "admin only".
-- ============================================================================

CREATE OR REPLACE FUNCTION app.prevent_non_admin_mode_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.mode IS DISTINCT FROM OLD.mode AND NOT app.is_org_admin(OLD.org_id) THEN
    RAISE EXCEPTION 'only an org admin can change the assignment mode';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assignment_rules_prevent_non_admin_mode_change ON public.assignment_rules;
CREATE TRIGGER assignment_rules_prevent_non_admin_mode_change
  BEFORE UPDATE ON public.assignment_rules
  FOR EACH ROW EXECUTE FUNCTION app.prevent_non_admin_mode_change();


-- ============================================================================
-- org_id is immutable after insert, same as leads/contacts/tasks
-- (20260815143031_fix_role_escalation_and_org_pinning /
-- 20260822090000_tasks_core) — reusing that migration's
-- app.prevent_org_id_change() trigger function.
-- ============================================================================

DROP TRIGGER IF EXISTS assignment_rules_prevent_org_id_change ON public.assignment_rules;
CREATE TRIGGER assignment_rules_prevent_org_id_change
  BEFORE UPDATE ON public.assignment_rules
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();
