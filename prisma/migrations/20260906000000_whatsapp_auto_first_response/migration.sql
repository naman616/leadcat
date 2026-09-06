-- ============================================================================
-- WhatsApp auto-first-response (issue #51). See
-- docs/specs/09-whatsapp-auto-first-response.md for the full design.
--
-- Two changes, both anon-reachable SECURITY DEFINER functions, same class
-- as app.record_inbound_whatsapp_message (20260904000000):
--
--   1. app.record_inbound_whatsapp_message's return type widens from a bare
--      UUID to TABLE(lead_id UUID, is_new_lead BOOLEAN) so the webhook
--      handler can tell "first message from this number" apart from "n-th
--      message" without an extra anon-readable SELECT. Postgres can't
--      CREATE OR REPLACE a function into a different return type, so this
--      drops and recreates it (logic unchanged otherwise).
--   2. app.record_whatsapp_autoresponse_sent — records the outbound
--      auto-reply as its own whatsapp_messages row once the app has
--      actually sent it via WhatsAppProvider. Split into its own function
--      (rather than folded into #1) because the provider call is a
--      TypeScript-side network operation that must happen in between: SQL
--      determines is_new_lead, then the app sends, then SQL records what
--      was sent. Independently re-derives org_id from the same
--      request.whatsapp_phone_number_id GUC and verifies p_lead_id belongs
--      to it — never trusts a lead_id argument on its own, same
--      defense-in-depth reasoning as every other anon-callable function
--      here.
-- ============================================================================

DROP FUNCTION IF EXISTS app.record_inbound_whatsapp_message(TEXT, TEXT, TEXT, TIMESTAMPTZ);

CREATE FUNCTION app.record_inbound_whatsapp_message(
  p_contact_name TEXT,
  p_provider_message_id TEXT,
  p_message_body TEXT,
  p_captured_at TIMESTAMPTZ
)
RETURNS TABLE(lead_id UUID, is_new_lead BOOLEAN)
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
  v_is_new_lead BOOLEAN := false;
BEGIN
  v_phone_number_id := NULLIF(current_setting('request.whatsapp_phone_number_id', true), '');
  v_from_number := NULLIF(current_setting('request.whatsapp_from_number', true), '');

  IF v_phone_number_id IS NULL OR v_from_number IS NULL THEN
    RETURN;
  END IF;

  SELECT org_id INTO v_org_id
  FROM public.org_whatsapp_credentials
  WHERE whatsapp_phone_number_id = v_phone_number_id;

  IF v_org_id IS NULL THEN
    RETURN; -- unknown phone_number_id — logged by the caller, not here.
  END IF;

  -- Idempotency: a retried delivery for a message id already recorded for
  -- this org is a no-op. Never "new" — the auto-response, if any, already
  -- fired on the original delivery.
  SELECT wm.lead_id INTO v_lead_id
  FROM public.whatsapp_messages wm
  WHERE wm.org_id = v_org_id AND wm.provider_message_id = p_provider_message_id;

  IF FOUND THEN
    lead_id := v_lead_id;
    is_new_lead := false;
    RETURN NEXT;
    RETURN;
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
    v_is_new_lead := true;

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

  lead_id := v_lead_id;
  is_new_lead := v_is_new_lead;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION app.record_inbound_whatsapp_message(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO anon;

CREATE FUNCTION app.record_whatsapp_autoresponse_sent(
  p_lead_id UUID,
  p_message_body TEXT,
  p_provider_message_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_number_id TEXT;
  v_from_number TEXT;
  v_org_id UUID;
BEGIN
  v_phone_number_id := NULLIF(current_setting('request.whatsapp_phone_number_id', true), '');
  v_from_number := NULLIF(current_setting('request.whatsapp_from_number', true), '');

  IF v_phone_number_id IS NULL OR v_from_number IS NULL THEN
    RETURN;
  END IF;

  SELECT org_id INTO v_org_id
  FROM public.org_whatsapp_credentials
  WHERE whatsapp_phone_number_id = v_phone_number_id;

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  -- p_lead_id must actually belong to the org this phone_number_id resolves
  -- to — never trust the argument on its own (same reasoning as every
  -- other anon-callable function here).
  IF NOT EXISTS (
    SELECT 1 FROM public.leads WHERE id = p_lead_id AND org_id = v_org_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_messages
    (org_id, lead_id, direction, from_number, to_number, body, status, provider_message_id)
  VALUES
    (v_org_id, p_lead_id, 'outbound', v_phone_number_id, v_from_number, p_message_body, 'sent', p_provider_message_id);
END;
$$;

GRANT EXECUTE ON FUNCTION app.record_whatsapp_autoresponse_sent(UUID, TEXT, TEXT) TO anon;
