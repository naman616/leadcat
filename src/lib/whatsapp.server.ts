import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { MockWhatsAppProvider } from "./whatsapp/mock-provider";

// The one line to change when a real WhatsApp Business API account exists
// (issue #31) — everything below depends only on WhatsAppProvider. Exported
// so the inbound webhook handler (src/lib/whatsapp/webhook-handler.ts) can
// send the auto-first-response through the same provider instance.
export const whatsappProvider = new MockWhatsAppProvider();

const createTemplateSchema = z.object({
  name: z.string().min(1),
  body: z.string().min(1),
  category: z.string().min(1).optional(),
});

/**
 * RLS gates this to org admins only (whatsapp_templates' INSERT policy) —
 * real WhatsApp Business templates require platform approval, so template
 * management is admin-gated here too, even without a real account yet. No
 * app-level role check needed; a non-admin's create is simply rejected by
 * Postgres, same shape as updateUnitPrice relying on unit_price_history's
 * admin-only INSERT policy (src/lib/unit-price.server.ts).
 */
export const createTemplate = createServerFn({ method: "POST" })
  .validator(createTemplateSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.whatsAppTemplate.create({
        data: { orgId, name: data.name, body: data.body, category: data.category ?? null },
      }),
    );
  });

export const listTemplates = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, (tx) =>
    tx.whatsAppTemplate.findMany({ orderBy: { createdAt: "desc" } }),
  );
});

const setWhatsAppPhoneCredentialsSchema = z.object({
  whatsappPhoneNumberId: z.string().min(1),
  whatsappAccessToken: z.string().min(1),
});

/**
 * Admin-only — RLS gates this via org_whatsapp_credentials' write policies
 * (app.is_org_admin), same shape as setMetaPageCredentials
 * (src/lib/meta-lead-ads.server.ts). No app-level role check needed; a
 * non-admin's upsert is simply rejected by Postgres. No UI yet — callable
 * directly until an admin settings screen exists.
 *
 * ponytail: no phone-number ownership verification. whatsappPhoneNumberId
 * is globally unique and first-come-first-served — nothing here checks the
 * calling org actually controls the WhatsApp Business number being
 * registered, so an org admin could register another org's real number
 * first and misattribute their real inbound messages. Same accepted-gap
 * shape as setMetaPageCredentials; see docs/specs/08-whatsapp-inbound-webhook.md
 * ("Known limitation") — this must not be enabled for more than one org on
 * a shared deployment until a real WhatsApp Cloud API ownership check
 * exists.
 */
export const setWhatsAppPhoneCredentials = createServerFn({ method: "POST" })
  .validator(setWhatsAppPhoneCredentialsSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.orgWhatsAppCredential.upsert({
        where: { orgId },
        create: {
          orgId,
          whatsappPhoneNumberId: data.whatsappPhoneNumberId,
          whatsappAccessToken: data.whatsappAccessToken,
        },
        update: {
          whatsappPhoneNumberId: data.whatsappPhoneNumberId,
          whatsappAccessToken: data.whatsappAccessToken,
        },
      }),
    );
  });

const sendWhatsAppMessageSchema = z.object({
  leadId: z.string().uuid().optional(),
  toNumber: z.string().min(1),
  body: z.string().min(1),
  templateId: z.string().uuid().optional(),
});

/**
 * Sends via the (currently mock) WhatsAppProvider, then — in one
 * transaction — creates the WhatsAppMessage row and, if leadId is set, a
 * matching LeadActivity (type: "whatsapp"). Same "write + log atomically"
 * shape as initiateClickToCall (src/lib/telephony.server.ts) and
 * mergeContacts (src/lib/dedup.server.ts).
 *
 * leadId is optional — a message can exist before it's linked to a lead —
 * so unlike click-to-call there isn't always a lead row to derive the
 * operating org from. When leadId is omitted, this falls back to
 * requirePrimaryOrgId(userId), resolved BEFORE opening the write
 * transaction below so its own internal withUserContext call never nests
 * inside this one. When leadId IS given, org comes from the lead's own
 * orgId, not primary org — same reasoning as mergeContacts: a caller can
 * belong to more than one org, and "primary org" would attribute the
 * message/activity to the wrong one whenever someone messages a lead in a
 * non-primary org they also belong to.
 */
export const sendWhatsAppMessage = createServerFn({ method: "POST" })
  .validator(sendWhatsAppMessageSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    const fallbackOrgId = data.leadId ? null : await requirePrimaryOrgId(userId);

    return withUserContext(userId, async (tx) => {
      const orgId = data.leadId
        ? (await tx.lead.findUniqueOrThrow({ where: { id: data.leadId } })).orgId
        : fallbackOrgId!;

      const { providerMessageId } = await whatsappProvider.sendMessage(data.toNumber, data.body);

      const message = await tx.whatsAppMessage.create({
        data: {
          orgId,
          leadId: data.leadId ?? null,
          direction: "outbound",
          // Placeholder — no per-org WhatsApp Business number is modeled yet;
          // tracked alongside the real-provider swap (issue #31).
          fromNumber: "org-whatsapp-number",
          toNumber: data.toNumber,
          body: data.body,
          templateId: data.templateId ?? null,
          status: "sent",
        },
      });

      if (data.leadId) {
        await tx.leadActivity.create({
          data: {
            orgId,
            leadId: data.leadId,
            type: "whatsapp",
            body: `WhatsApp sent to ${data.toNumber} (provider id ${providerMessageId}): ${data.body}`,
            createdBy: userId,
          },
        });
      }

      return message;
    });
  });

export const listMessages = createServerFn({ method: "GET" })
  .validator(z.object({ leadId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.whatsAppMessage.findMany({
        where: { leadId: data.leadId },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

/** Shared team inbox — every message in the caller's org, most recent first. */
export const listInboxMessages = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, (tx) =>
    tx.whatsAppMessage.findMany({ orderBy: { createdAt: "desc" } }),
  );
});
