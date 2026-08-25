import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";
import { MockTelephonyProvider } from "./telephony/mock-provider";

// The one line to change when a real provider (Exotel/Knowlarity/Twilio)
// account exists — everything below depends only on TelephonyProvider.
const telephonyProvider = new MockTelephonyProvider();

const initiateClickToCallSchema = z.object({
  leadId: z.string().uuid(),
  agentPhoneNumber: z.string().min(1),
});

/**
 * Click-to-call: places the call via the provider, then — in one
 * transaction — creates the CallLog row and a matching LeadActivity, so the
 * call shows up on the lead's timeline immediately (Phase 4 success
 * criterion: "every touchpoint appears on the lead timeline without manual
 * entry"). Same "write + log atomically" shape as mergeContacts
 * (src/lib/dedup.server.ts) and updateUnitPrice (src/lib/unit-price.server.ts).
 *
 * toNumber comes from the lead's contact — not a caller-supplied value —
 * so a click-to-call can't be pointed at an arbitrary number.
 */
export const initiateClickToCall = createServerFn({ method: "POST" })
  .validator(initiateClickToCallSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({
        where: { id: data.leadId },
        include: { contact: { select: { phone: true } } },
      });
      if (!lead.contact.phone) {
        throw new Error("This lead's contact has no phone number on file");
      }
      const toNumber = lead.contact.phone;

      const { providerCallId } = await telephonyProvider.initiateCall(data.agentPhoneNumber, toNumber);

      const callLog = await tx.callLog.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          direction: "outbound",
          fromNumber: data.agentPhoneNumber,
          toNumber,
          initiatedBy: userId,
          status: "initiated",
        },
      });

      await tx.leadActivity.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "call",
          body: `Call initiated to ${toNumber} (provider call ${providerCallId})`,
          createdBy: userId,
        },
      });

      return callLog;
    });
  });

export const listCallLogs = createServerFn({ method: "GET" })
  .validator(z.object({ leadId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.callLog.findMany({
        where: { leadId: data.leadId },
        orderBy: { startedAt: "desc" },
      }),
    );
  });
