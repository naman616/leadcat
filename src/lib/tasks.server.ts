import { createServerFn } from "@tanstack/react-start";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";

/**
 * "Tasks" in this slice are leads with a follow-up (nextActionAt) set —
 * see docs/specs/01-leads.md. Bucketing into overdue/today/upcoming happens
 * client-side from this one list rather than three separate date-ranged
 * queries; the dataset size here doesn't warrant the extra round-trips.
 */
export const getTasks = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, (tx) =>
    tx.lead.findMany({
      where: { nextActionAt: { not: null } },
      orderBy: { nextActionAt: "asc" },
      include: {
        contact: { select: { fullName: true, phone: true } },
        assignee: { select: { id: true, fullName: true, email: true } },
      },
    }),
  );
});
