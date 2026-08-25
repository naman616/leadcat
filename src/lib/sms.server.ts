import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { MockSmsProvider } from "./sms/mock-provider";

// The one line to change when a real DLT-registered SMS provider account
// exists — everything below depends only on SmsProvider.
const smsProvider = new MockSmsProvider();

const sendSmsSchema = z.object({
  leadId: z.string().uuid().optional(),
  toNumber: z.string().min(1),
  body: z.string().min(1),
});

/**
 * Sends an SMS via the provider, then — in one transaction — creates the
 * SmsLog row and, if leadId is set, a matching LeadActivity so the send
 * shows up on the lead's timeline. Same "write + log atomically" shape as
 * mergeContacts (src/lib/dedup.server.ts) and initiateClickToCall
 * (src/lib/telephony.server.ts).
 *
 * leadId is optional (unlike click-to-call) — an SMS doesn't have to be
 * tied to a lead. When it is, orgId is derived from the lead row (not
 * caller input), same reasoning as mergeContacts; when it isn't, orgId
 * falls back to the caller's primary org.
 *
 * ActivityType.sms is a dedicated enum value (see the migration comment)
 * rather than piggybacking on "note", matching how call/whatsapp/email
 * each already get their own type.
 */
export const sendSms = createServerFn({ method: "POST" })
  .validator(sendSmsSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const orgId = data.leadId
        ? (await tx.lead.findUniqueOrThrow({ where: { id: data.leadId } })).orgId
        : await requirePrimaryOrgId(userId);

      const { providerMessageId } = await smsProvider.sendSms(data.toNumber, data.body);

      const smsLog = await tx.smsLog.create({
        data: {
          orgId,
          leadId: data.leadId ?? null,
          toNumber: data.toNumber,
          body: data.body,
          status: "sent",
        },
      });

      if (data.leadId) {
        await tx.leadActivity.create({
          data: {
            orgId,
            leadId: data.leadId,
            type: "sms",
            body: `SMS sent to ${data.toNumber} (provider message ${providerMessageId}): ${data.body}`,
            createdBy: userId,
          },
        });
      }

      return smsLog;
    });
  });

export const listSmsLogs = createServerFn({ method: "GET" })
  .validator(z.object({ leadId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.smsLog.findMany({
        where: { leadId: data.leadId },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
