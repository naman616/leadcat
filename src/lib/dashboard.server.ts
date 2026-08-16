import { createServerFn } from "@tanstack/react-start";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";

/**
 * Real aggregates for the dashboard, replacing the previous fully-mock
 * tiles. Deliberately doesn't try to recreate every mock metric — several
 * (Deleted, Booking Cancel, Not Interested, meetings/site-visit scheduling,
 * a weekly per-source trend) have no real backing in this schema yet.
 * Showing a fabricated number for those would be worse than not showing
 * them at all, so they're dropped rather than faked.
 */
export const getDashboardStats = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, async (tx) => {
    // Total is derived from summing statusCounts below rather than a
    // separate tx.lead.count() — one less round-trip inside a transaction
    // whose overhead (BEGIN + 2x SET LOCAL + COMMIT, over a pooled
    // connection) already dominates the cost of any one query.
    const [statusCounts, unassignedCount, sourceCounts, recentLeads] = await Promise.all([
      tx.lead.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.lead.count({ where: { assignedTo: null } }),
      tx.lead.groupBy({
        by: ["source"],
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
      }),
      tx.lead.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { contact: { select: { fullName: true } } },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    let totalCount = 0;
    for (const row of statusCounts) {
      byStatus[row.status] = row._count._all;
      totalCount += row._count._all;
    }

    return {
      total: totalCount,
      unassigned: unassignedCount,
      byStatus,
      bySource: sourceCounts.map((s) => ({ source: s.source ?? "Unknown", count: s._count._all })),
      recentLeads: recentLeads.map((l) => ({
        id: l.id,
        name: l.contact.fullName,
        status: l.status,
        createdAt: l.createdAt,
      })),
    };
  });
});
