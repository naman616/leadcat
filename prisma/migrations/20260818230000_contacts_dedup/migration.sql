-- ============================================================================
-- Contact dedup engine: adds the one RLS gap merge needs — a DELETE policy
-- on contacts, which deliberately didn't exist before this (see
-- 20260815102606_leads_core: "No DELETE policy yet — not exposed until
-- there's a real need for it"). Merge is that real need. See
-- docs/specs/03-dedup.md for the full reasoning.
--
-- No new tables — detection is computed at read time in application code
-- (src/lib/dedup.ts), not stored. Reassigning a merged lead's contact_id
-- and logging the lead_activities note both already fall under existing
-- Phase 1 policies (can_manage_lead's admin branch; "any org member can
-- add lead activities"), so nothing changes there.
-- ============================================================================

CREATE POLICY "org admins can delete contacts"
  ON public.contacts FOR DELETE
  USING (app.is_org_admin(org_id));
