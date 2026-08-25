import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { MockEmailProvider } from "./email/mock-provider";

// The one line to change when a real transactional email provider account
// exists — everything below depends only on EmailProvider.
const emailProvider = new MockEmailProvider();

const sendEmailSchema = z.object({
  leadId: z.string().uuid().optional(),
  toAddress: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

/**
 * Sends an email via the provider, then — in one transaction — creates the
 * EmailLog row and, if leadId is set, a matching LeadActivity so the send
 * shows up on the lead's timeline. Same "write + log atomically" shape as
 * sendSms (src/lib/sms.server.ts) and mergeContacts (src/lib/dedup.server.ts).
 *
 * leadId is optional — an email doesn't have to be tied to a lead
 * (transactional/campaign sends may go to a contact directly). When it is
 * set, orgId is derived from the lead row, not caller input; otherwise it
 * falls back to the caller's primary org.
 *
 * ActivityType already has a dedicated "email" value (pre-existing —
 * unlike SMS, no enum change needed here).
 */
export const sendEmail = createServerFn({ method: "POST" })
  .validator(sendEmailSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const orgId = data.leadId
        ? (await tx.lead.findUniqueOrThrow({ where: { id: data.leadId } })).orgId
        : await requirePrimaryOrgId(userId);

      const { providerMessageId } = await emailProvider.sendEmail(
        data.toAddress,
        data.subject,
        data.body,
      );

      const emailLog = await tx.emailLog.create({
        data: {
          orgId,
          leadId: data.leadId ?? null,
          toAddress: data.toAddress,
          subject: data.subject,
          body: data.body,
          status: "sent",
        },
      });

      if (data.leadId) {
        await tx.leadActivity.create({
          data: {
            orgId,
            leadId: data.leadId,
            type: "email",
            body: `Email sent to ${data.toAddress} (provider message ${providerMessageId}): ${data.subject}`,
            createdBy: userId,
          },
        });
      }

      return emailLog;
    });
  });

export const listEmailLogs = createServerFn({ method: "GET" })
  .validator(z.object({ leadId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.emailLog.findMany({
        where: { leadId: data.leadId },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
