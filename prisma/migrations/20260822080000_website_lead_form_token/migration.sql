-- ============================================================================
-- Phase 3 slice: public website lead-capture form (issue #22).
--
-- Problem this solves: a public website form needs to create a Contact +
-- Lead for a specific org, from a fully unauthenticated (anon) caller —
-- there's no auth.uid()/JWT to derive org context from the way every other
-- write path in this app works. organizations.id/slug are NOT usable as
-- that proof: id is a UUID that (once known) directly names the org with no
-- further check, and slug is human-guessable/enumerable — either one used
-- alone as "authorization" would let anyone submit fake leads into any org
-- by guessing or scraping a slug/id from a public page.
--
-- Fix: a second, separate, unguessable, ROTATABLE identifier
-- (public_form_token) meant to be embedded in a public form/script, never
-- shown anywhere an org's id/slug already is. Proving you hold that token
-- is what authorizes an INSERT — nothing else does. Compromise (token
-- leaked, scraped from a form's HTML) only exposes "can submit a lead into
-- this one org," never read/update/delete access, and is fixed by rotating
-- the token (re-running gen_random_uuid() on the column), not a security
-- incident touching auth.uid()-based access at all.
-- ============================================================================

-- AlterTable
ALTER TABLE "organizations"
  ADD COLUMN "public_form_token" UUID NOT NULL DEFAULT gen_random_uuid();

-- CreateIndex
CREATE UNIQUE INDEX "organizations_public_form_token_key" ON "organizations"("public_form_token");


-- ============================================================================
-- RLS helper: which org (if any) does the calling anon request's form token
-- authorize? Mirrors auth.uid() for the authenticated path — same
-- SECURITY DEFINER + fixed search_path pattern as every other app.* helper
-- in this project, so it can read organizations regardless of that table's
-- own RLS (which anon otherwise has zero access to — see below).
--
-- Reads a session-local GUC, "request.form_token", set by
-- withAnonFormContext (src/lib/db.server.ts) via SET LOCAL, exactly parallel
-- to how withUserContext sets "request.jwt.claims" for auth.uid(). The
-- regex guard means a missing/malformed/unset token returns NULL rather
-- than throwing — a malformed token and a well-formed-but-unknown token
-- both end up NULL here, so a caller can never tell from the response which
-- case they hit (no "your token is almost valid" signal).
-- ============================================================================

CREATE OR REPLACE FUNCTION app.org_id_for_form_token()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  raw_token TEXT;
  found_org_id UUID;
BEGIN
  raw_token := NULLIF(current_setting('request.form_token', true), '');

  IF raw_token IS NULL OR raw_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO found_org_id
  FROM public.organizations
  WHERE public_form_token = raw_token::uuid;

  RETURN found_org_id; -- NULL when nothing matches — never an error.
END;
$$;

-- Deliberately anon-only — no authenticated caller ever needs this, and
-- there's no reason to widen the grant "for consistency."
GRANT EXECUTE ON FUNCTION app.org_id_for_form_token() TO anon;


-- ============================================================================
-- anon INSERT policies. These are the ONLY new grant of anything to anon on
-- these tables: anon's existing SELECT/UPDATE/DELETE exposure on
-- contacts/leads is (and remains) zero rows, because every existing
-- SELECT/UPDATE policy on them requires app.is_org_member(org_id), which is
-- unconditionally false for anon (auth.uid() has nothing to resolve without
-- a JWT). Scoping these new policies `TO anon` explicitly, rather than
-- leaving off the TO clause, keeps that blast radius visible and minimal —
-- authenticated callers already have their own, unrelated INSERT policy.
-- ============================================================================

CREATE POLICY "public form token can create contacts"
  ON public.contacts FOR INSERT
  TO anon
  WITH CHECK (org_id = app.org_id_for_form_token());

CREATE POLICY "public form token can create leads"
  ON public.leads FOR INSERT
  TO anon
  WITH CHECK (org_id = app.org_id_for_form_token());
