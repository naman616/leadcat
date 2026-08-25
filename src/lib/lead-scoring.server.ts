import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";
import { scoreLead } from "./lead-scoring";

/**
 * Reads a lead (contact's phone/email, budget, status, nextActionAt, and
 * its most recent activity) via withUserContext, runs it through the pure
 * heuristic in src/lib/lead-scoring.ts, and writes the result back to
 * Lead.score. Goes through the same RLS as every other lead update
 * (app.can_manage_lead) — no special-casing here.
 */
export const recalculateLeadScore = createServerFn({ method: "POST" })
  .validator(z.object({ leadId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({
        where: { id: data.leadId },
        include: {
          contact: { select: { phone: true, email: true } },
          activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        },
      });

      const score = scoreLead({
        status: lead.status,
        budget: lead.budget,
        contactPhone: lead.contact.phone,
        contactEmail: lead.contact.email,
        nextActionAt: lead.nextActionAt,
        lastActivityAt: lead.activities[0]?.createdAt ?? null,
      });

      return tx.lead.update({ where: { id: lead.id }, data: { score } });
    });
  });
