-- ============================================================================
-- WhatsApp inbound webhook + lead source tagging. See
-- docs/specs/08-whatsapp-inbound-webhook.md for the full design.
--
-- Unlike 20260826000000_meta_lead_ads_webhook, this does NOT add any new
-- anon INSERT/SELECT policies on contacts/leads/whatsapp_messages. A
-- WhatsApp number sends many messages over time (unlike one Meta Lead Ads
-- event per leadgen_id), so this needs find-existing-lead-or-create, which
-- would otherwise require an anon SELECT policy on contacts/leads to look
-- up an existing match — widening what an unauthenticated,
-- signature-verified-only caller can read. Instead, the whole find-or-
-- create-and-insert sequence lives inside one SECURITY DEFINER function
-- (app.record_inbound_whatsapp_message, below) that bypasses RLS
-- internally, the same mechanism app.org_id_for_meta_page() already uses.
-- anon gets EXECUTE on that one function and nothing else.
-- ============================================================================

-- AlterEnum — the existing queued/sent/delivered/read/failed values are all
-- outbound-lifecycle states; none fit a message the app received.
ALTER TYPE "whatsapp_message_status" ADD VALUE 'received';

-- CreateTable
CREATE TABLE "org_whatsapp_credentials" (
    "org_id" UUID NOT NULL,
    "whatsapp_phone_number_id" TEXT NOT NULL,
    "whatsapp_access_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_whatsapp_credentials_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_whatsapp_credentials_whatsapp_phone_number_id_key" ON "org_whatsapp_credentials"("whatsapp_phone_number_id");

-- AddForeignKey
ALTER TABLE "org_whatsapp_credentials" ADD CONSTRAINT "org_whatsapp_credentials_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN "provider_message_id" TEXT;

-- CreateIndex — idempotency, org-scoped: a retried webhook delivery for the
-- same WhatsApp message id is a no-op (see
-- app.record_inbound_whatsapp_message below), not a duplicate message. NULL
-- for every outbound message is unaffected (Postgres treats NULLs as
-- distinct in a unique index).
CREATE UNIQUE INDEX "whatsapp_messages_org_id_provider_message_id_key" ON "whatsapp_messages"("org_id", "provider_message_id");


-- ============================================================================
-- RLS: org_whatsapp_credentials — admin-only, same shape as
-- org_meta_credentials (no SELECT policy at all for plain members).
-- ============================================================================

ALTER TABLE public.org_whatsapp_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org admins can view their org's whatsapp credentials"
  ON public.org_whatsapp_credentials FOR SELECT
  USING (app.is_org_admin(org_id));

CREATE POLICY "org admins can create their org's whatsapp credentials"
  ON public.org_whatsapp_credentials FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update their org's whatsapp credentials"
  ON public.org_whatsapp_credentials FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete their org's whatsapp credentials"
  ON public.org_whatsapp_credentials FOR DELETE
  USING (app.is_org_admin(org_id));


-- ============================================================================
-- app.record_inbound_whatsapp_message — the one anon-callable entry point
-- for this whole feature. Resolves org from the request.whatsapp_phone_
-- number_id GUC (set by withAnonWhatsAppWebhookContext, src/lib/db.server.ts,
-- only ever after the webhook handler has verified the request's HMAC
-- signature), then:
--   1. If a message with this provider_message_id was already recorded for
--      that org, this is a retried delivery — return its existing lead_id,
--      write nothing else.
--   2. Else find an existing Contact by (org_id, phone = the caller's
--      request.whatsapp_from_number GUC), reusing its most recently
--      created Lead if found. Otherwise create a new Contact + Lead
--      (source 'WhatsApp', sub_source = phone_number_id). Source is set
--      only at Lead-creation time here — a later message from a number
--      that already has a Lead never overwrites it, same "first touch"
--      convention as every other attribution column on Lead.
--   3. Insert the whatsapp_messages row (direction inbound, status
--      received), attached to whichever lead_id step 2 resolved.
--
-- No org_id or phone number is ever passed in as a plain argument — both
-- come only from GUCs this function reads internally — closing off the
-- exact parameter-injection shape found and fixed once already in
-- app.meta_page_access_token_for_org() (task 1 review round 1, PR #59).
-- ============================================================================

CREATE OR REPLACE FUNCTION app.record_inbound_whatsapp_message(
  p_contact_name TEXT,
  p_provider_message_id TEXT,
  p_message_body TEXT,
  p_captured_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_number_id TEXT;
  v_from_number TEXT;
  v_org_id UUID;
  v_contact_id UUID;
  v_lead_id UUID;
BEGIN
  v_phone_number_id := NULLIF(current_setting('request.whatsapp_phone_number_id', true), '');
  v_from_number := NULLIF(current_setting('request.whatsapp_from_number', true), '');

  IF v_phone_number_id IS NULL OR v_from_number IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT org_id INTO v_org_id
  FROM public.org_whatsapp_credentials
  WHERE whatsapp_phone_number_id = v_phone_number_id;

  IF v_org_id IS NULL THEN
    RETURN NULL; -- unknown phone_number_id — logged by the caller, not here.
  END IF;

  -- Idempotency: a retried delivery for a message id already recorded for
  -- this org is a no-op.
  SELECT lead_id INTO v_lead_id
  FROM public.whatsapp_messages
  WHERE org_id = v_org_id AND provider_message_id = p_provider_message_id;

  IF FOUND THEN
    RETURN v_lead_id;
  END IF;

  -- Find an existing Contact by phone within this org; reuse its most
  -- recently created Lead.
  SELECT l.id, c.id INTO v_lead_id, v_contact_id
  FROM public.contacts c
  JOIN public.leads l ON l.contact_id = c.id
  WHERE c.org_id = v_org_id AND c.phone = v_from_number
  ORDER BY l.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    v_contact_id := gen_random_uuid();
    v_lead_id := gen_random_uuid();

    INSERT INTO public.contacts (id, org_id, full_name, phone)
    VALUES (v_contact_id, v_org_id, p_contact_name, v_from_number);

    INSERT INTO public.leads (id, org_id, contact_id, source, sub_source, captured_at)
    VALUES (v_lead_id, v_org_id, v_contact_id, 'WhatsApp', v_phone_number_id, p_captured_at);
  END IF;

  -- to_number holds phone_number_id (Meta's internal id for the receiving
  -- WhatsApp Business number), not a literal E.164 number — there's no
  -- other field carrying it, and the column has never meant anything more
  -- specific than "the number/identifier this message went to."
  INSERT INTO public.whatsapp_messages
    (org_id, lead_id, direction, from_number, to_number, body, status, provider_message_id)
  VALUES
    (v_org_id, v_lead_id, 'inbound', v_from_number, v_phone_number_id, p_message_body, 'received', p_provider_message_id);

  RETURN v_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app.record_inbound_whatsapp_message(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO anon;
