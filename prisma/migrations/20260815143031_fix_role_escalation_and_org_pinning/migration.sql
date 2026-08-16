-- ============================================================================
-- Fixes two real gaps found in an independent security review:
--
-- 1. CRITICAL — org_members' write policies used app.is_org_admin(), which
--    treats 'admin' and 'owner' identically. Combined with the UPDATE
--    policy never having an explicit WITH CHECK (so Postgres reused USING,
--    which never inspects the *role* column at all), a plain admin could:
--      - grant themselves (or anyone) the 'owner' role, via a direct
--        UPDATE or via addOrgMemberByEmail's INSERT — that function uses
--        the service-role admin client, which bypasses RLS entirely, so
--        fixing the RLS policy alone does not close that path; see the
--        matching fix in src/lib/org-members.server.ts.
--      - delete the real owner's membership row outright, with no
--        protection for the owner or for the last-remaining-owner case.
--    Net effect: 'admin' was not actually subordinate to 'owner' for org
--    governance. Fixed by adding app.is_org_owner() and app.is_last_owner(),
--    and requiring owner-level permission for anything that grants,
--    revokes, or removes an 'owner' row — with an explicit guard against
--    ever leaving an org with zero owners.
--
-- 2. HIGH — leads/contacts UPDATE policies' WITH CHECK only required the
--    *new* org_id to be some org the caller belongs to, never that it
--    equal the row's existing org_id. A user who belongs to multiple orgs
--    (a supported case — see the Contact/Lead model comments) could move a
--    record from one of their orgs into another via a direct Supabase
--    client call (which talks straight to PostgREST, bypassing this app's
--    server functions entirely — exactly the class of gap RLS exists to
--    close). Fixed by pinning org_id: WITH CHECK now requires
--    NEW.org_id = OLD.org_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.is_org_owner(check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members
    WHERE org_id = check_org_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

-- True if check_member_row_id is the ONLY 'owner' row left in the org —
-- i.e. removing/demoting it would leave the org with zero owners.
CREATE OR REPLACE FUNCTION app.is_last_owner(check_org_id UUID, check_member_row_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.org_members
    WHERE org_id = check_org_id
      AND role = 'owner'
      AND id != check_member_row_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.is_org_owner(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION app.is_last_owner(UUID, UUID) TO authenticated, anon;


-- ----------------------------------------------------------------------------
-- org_members: owner-gated role changes, last-owner protection.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "org owners and admins can add members" ON public.org_members;
CREATE POLICY "org owners and admins can add members"
  ON public.org_members
  FOR INSERT
  WITH CHECK (
    app.is_org_admin(org_id)
    -- Granting 'owner' itself requires being an owner — an admin can add
    -- agents/admins/etc freely, but can't hand out ownership.
    AND (role != 'owner' OR app.is_org_owner(org_id))
  );

DROP POLICY IF EXISTS "org owners and admins can update members" ON public.org_members;
CREATE POLICY "org owners and admins can update members"
  ON public.org_members
  FOR UPDATE
  USING (
    app.is_org_admin(org_id)
    -- role here is the CURRENT (pre-update) value: a plain admin can't
    -- touch a row that is currently an owner at all — not even to demote
    -- it — only another owner can.
    AND (role != 'owner' OR app.is_org_owner(org_id))
  )
  WITH CHECK (
    app.is_org_admin(org_id)
    -- role here is the NEW (post-update) value: promoting a row TO owner
    -- requires being an owner yourself.
    AND (role != 'owner' OR app.is_org_owner(org_id))
    -- Demoting a row away from 'owner' is blocked if it's the org's last
    -- one — never allow an org to end up with zero owners.
    AND (role = 'owner' OR NOT app.is_last_owner(org_id, id))
  );

DROP POLICY IF EXISTS "org owners and admins can remove members" ON public.org_members;
CREATE POLICY "org owners and admins can remove members"
  ON public.org_members
  FOR DELETE
  USING (
    app.is_org_admin(org_id)
    AND (
      role != 'owner'
      OR (app.is_org_owner(org_id) AND NOT app.is_last_owner(org_id, id))
    )
  );


-- ----------------------------------------------------------------------------
-- leads / contacts: pin org_id on UPDATE so a multi-org member can't move a
-- record from one of their orgs into another.
--
-- This is NOT expressed as an RLS WITH CHECK — a WITH CHECK subquery that
-- re-reads the same table for the same id sees the row *as it already
-- stands after the update* (there's no OLD/NEW access in RLS policies the
-- way there is in a trigger), so a naive "org_id = (SELECT org_id FROM
-- leads WHERE id = leads.id)" check is a no-op: it always matches itself.
-- A BEFORE UPDATE trigger has real OLD/NEW row access and is the correct
-- mechanism for "this column is immutable after insert." It also applies
-- regardless of RLS bypass status, so even the one audited service-role
-- admin path can't move a record's org_id through a normal UPDATE either.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.prevent_org_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.org_id != OLD.org_id THEN
    RAISE EXCEPTION 'org_id cannot be changed on an existing row';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_prevent_org_id_change ON public.leads;
CREATE TRIGGER leads_prevent_org_id_change
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

DROP TRIGGER IF EXISTS contacts_prevent_org_id_change ON public.contacts;
CREATE TRIGGER contacts_prevent_org_id_change
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();
