-- ============================================================================
-- Meta Lead Ads webhook (issue #24). See
-- docs/specs/07-meta-lead-ads-webhook.md for the full design.
--
-- Two concerns in one migration, same as 20260822140000_whatsapp_core
-- bundling templates+messages:
--
-- 1. org_meta_credentials — which Facebook Page maps to which org, and
--    that page's Graph API access token. Its own table, not columns on
--    organizations: that table's SELECT policy is member-readable, but a
--    Page access token is a bearer credential for Meta's API — admin-only
--    here, via app.is_org_admin(), same gate as whatsapp_templates' writes,
--    but with no member-read exposure at all (unlike whatsapp_templates).
--
-- 2. The anon-writable webhook path into contacts/leads — mirrors
--    20260822080000_website_lead_form_token exactly, keyed by a
--    request.meta_page_id GUC instead of request.form_token. page_id
--    doesn't need to be a secret the way form_token does: the webhook
--    handler verifies Meta's HMAC signature before ever setting this GUC,
--    so by the time app.org_id_for_meta_page() runs, the caller is already
--    proven to be Meta itself.
-- ============================================================================

-- CreateTable
CREATE TABLE "org_meta_credentials" (
    "org_id" UUID NOT NULL,
    "meta_page_id" TEXT NOT NULL,
    "meta_page_access_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_meta_credentials_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_meta_credentials_meta_page_id_key" ON "org_meta_credentials"("meta_page_id");

-- AddForeignKey
ALTER TABLE "org_meta_credentials" ADD CONSTRAINT "org_meta_credentials_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable — idempotency: a retried webhook delivery for the same
-- leadgen_id is a no-op (see src/lib/meta-lead-ads/webhook-handler.ts's
-- skipDuplicates), not a duplicate Lead. Postgres unique indexes already
-- treat NULL as distinct from other NULLs, so no partial/WHERE clause is
-- needed — every non-Meta lead's NULL platform_lead_id is unaffected.
CREATE UNIQUE INDEX "leads_platform_lead_id_key" ON "leads"("platform_lead_id");


-- ============================================================================
-- RLS: org_meta_credentials — admin-only, full stop. No SELECT policy for
-- plain members at all (unlike whatsapp_templates, which is member-
-- readable but admin-writable) — the access token here is a bearer
-- credential for Meta's Graph API, a bigger blast radius than anything
-- else gated by app.is_org_admin() so far in this app.
-- ============================================================================

ALTER TABLE public.org_meta_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org admins can view their org's meta credentials"
  ON public.org_meta_credentials FOR SELECT
  USING (app.is_org_admin(org_id));

CREATE POLICY "org admins can create their org's meta credentials"
  ON public.org_meta_credentials FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update their org's meta credentials"
  ON public.org_meta_credentials FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete their org's meta credentials"
  ON public.org_meta_credentials FOR DELETE
  USING (app.is_org_admin(org_id));


-- ============================================================================
-- RLS helper: which org (if any) does the calling anon request's verified
-- Page ID authorize? Mirrors app.org_id_for_form_token() exactly
-- (20260822080000_website_lead_form_token) — SECURITY DEFINER + fixed
-- search_path so it can read org_meta_credentials regardless of that
-- table's own RLS (anon otherwise has zero access — see above). Reads a
-- session-local GUC, "request.meta_page_id", set by
-- withAnonMetaWebhookContext (src/lib/db.server.ts), only ever after the
-- webhook handler has verified Meta's HMAC signature.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.org_id_for_meta_page()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  raw_page_id TEXT;
  found_org_id UUID;
BEGIN
  raw_page_id := NULLIF(current_setting('request.meta_page_id', true), '');

  IF raw_page_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT org_id INTO found_org_id
  FROM public.org_meta_credentials
  WHERE meta_page_id = raw_page_id;

  RETURN found_org_id; -- NULL when nothing matches — never an error.
END;
$$;

GRANT EXECUTE ON FUNCTION app.org_id_for_meta_page() TO anon;

-- ============================================================================
-- Fetches a known org's Page access token, for the webhook handler's Graph
-- API call — called directly by application code (never inside an RLS
-- policy), after app.org_id_for_meta_page() has already resolved org_id.
-- Its own SECURITY DEFINER function rather than a SELECT grant on
-- org_meta_credentials, so anon's access stays limited to exactly this one
-- read shape (by org_id, not an open SELECT).
-- ============================================================================

CREATE OR REPLACE FUNCTION app.meta_page_access_token_for_org(target_org_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT meta_page_access_token
  FROM public.org_meta_credentials
  WHERE org_id = target_org_id;
$$;

GRANT EXECUTE ON FUNCTION app.meta_page_access_token_for_org(UUID) TO anon;


-- ============================================================================
-- anon INSERT policies for the webhook's own writes — additive, doesn't
-- touch the existing form-token policies from
-- 20260822080000_website_lead_form_token. Postgres allows multiple
-- permissive policies for the same command; a row is permitted if ANY of
-- them passes. Same "createMany, no RETURNING" requirement applies (see
-- src/lib/meta-lead-ads/webhook-handler.ts) — anon still has no SELECT
-- policy on contacts/leads.
-- ============================================================================

CREATE POLICY "meta webhook can create contacts"
  ON public.contacts FOR INSERT
  TO anon
  WITH CHECK (org_id = app.org_id_for_meta_page());

CREATE POLICY "meta webhook can create leads"
  ON public.leads FOR INSERT
  TO anon
  WITH CHECK (org_id = app.org_id_for_meta_page());
