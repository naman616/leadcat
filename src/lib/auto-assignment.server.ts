import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext, type Tx } from "./db.server";
import { requireUserId } from "./current-user.server";
import { pickRoundRobinAgent, pickLoadBalancedAgent } from "./auto-assignment";

const ASSIGNMENT_MODE_VALUES = ["manual", "round_robin", "load_balanced"] as const;

// Roles eligible to receive an auto-assigned lead. Mirrors the shape of
// requireOrgMember's use elsewhere — cp_admin and owner/admin don't carry a
// lead book, only front-line agents do.
const ELIGIBLE_AGENT_ROLES = ["agent", "cp_agent"] as const;

async function eligibleAgentIds(tx: Tx, orgId: string): Promise<string[]> {
  const members = await tx.orgMember.findMany({
    where: { orgId, role: { in: [...ELIGIBLE_AGENT_ROLES] } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => m.userId);
}

const setAssignmentRuleSchema = z.object({
  orgId: z.string().uuid(),
  mode: z.enum(ASSIGNMENT_MODE_VALUES),
});

/**
 * Admin-only. RLS already enforces this at the DB level (assignment_rules'
 * INSERT policy is admin-only; UPDATEs to `mode` specifically are blocked
 * for non-admins by app.prevent_non_admin_mode_change — see the migration),
 * but the explicit role check here mirrors mergeContacts in
 * src/lib/dedup.server.ts: a rejected call should fail with a clear
 * message up front, not a raw Postgres RLS error.
 */
export const setAssignmentRule = createServerFn({ method: "POST" })
  .validator(setAssignmentRuleSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const membership = await tx.orgMember.findFirst({ where: { orgId: data.orgId, userId } });
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        throw new Error("Only org owners and admins can change the assignment rule");
      }

      return tx.assignmentRule.upsert({
        where: { orgId: data.orgId },
        create: { orgId: data.orgId, mode: data.mode },
        update: { mode: data.mode },
      });
    });
  });

const autoAssignLeadSchema = z.object({ leadId: z.string().uuid() });

/**
 * Looks up the lead's org's assignment rule and, unless it's `manual` (or
 * no rule has ever been set), picks an eligible agent and hands the lead to
 * them: sets Lead.assignedTo, advances the round-robin cursor when
 * applicable, and logs a system LeadActivity note — same multi-step
 * transactional write shape as mergeContacts in src/lib/dedup.server.ts.
 * No-ops (returns null) for manual mode or when there's nobody eligible to
 * assign to. Any org member may call this — it's invoked from the
 * lead-creation flow, not gated to admins (setAssignmentRule is the
 * admin-only operation, not this).
 */
export const autoAssignLead = createServerFn({ method: "POST" })
  .validator(autoAssignLeadSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: data.leadId } });
      const orgId = lead.orgId;

      const rule = await tx.assignmentRule.findUnique({ where: { orgId } });
      if (!rule || rule.mode === "manual") return null;

      const eligibleIds = await eligibleAgentIds(tx, orgId);

      let assignedUserId: string | null;
      if (rule.mode === "round_robin") {
        assignedUserId = pickRoundRobinAgent(eligibleIds, rule.lastAssignedUserId);
      } else {
        // load_balanced — fewest leads not yet Booked/Dropped. One groupBy
        // for all eligible agents at once rather than a count-per-agent
        // loop; agents with zero open leads don't appear in the groupBy
        // result, so the map is pre-seeded with 0 for everyone first.
        const counts = await tx.lead.groupBy({
          by: ["assignedTo"],
          where: {
            orgId,
            assignedTo: { in: eligibleIds },
            status: { notIn: ["Booked", "Dropped"] },
          },
          _count: { _all: true },
        });
        const countByUser = new Map<string, number>(eligibleIds.map((id) => [id, 0]));
        for (const c of counts) {
          if (c.assignedTo) countByUser.set(c.assignedTo, c._count._all);
        }
        assignedUserId = pickLoadBalancedAgent(
          eligibleIds.map((id) => ({ userId: id, openLeadCount: countByUser.get(id) ?? 0 })),
        );
      }

      if (!assignedUserId) return null;

      const updated = await tx.lead.update({
        where: { id: lead.id },
        data: { assignedTo: assignedUserId },
        include: { assignee: { select: { id: true, fullName: true, email: true } } },
      });

      if (rule.mode === "round_robin") {
        await tx.assignmentRule.update({
          where: { orgId },
          data: { lastAssignedUserId: assignedUserId },
        });
      }

      await tx.leadActivity.create({
        data: {
          orgId,
          leadId: lead.id,
          type: "system",
          body: `Auto-assigned to ${updated.assignee?.fullName ?? updated.assignee?.email ?? "agent"}`,
          createdBy: userId,
        },
      });

      return updated;
    });
  });
