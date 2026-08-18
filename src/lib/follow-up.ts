/**
 * A follow-up "escalates" once it's been overdue long enough that it's no
 * longer just today's to-do noise — it's a signal the assignee has gone
 * quiet on a lead someone is waiting to hear back from. There's no
 * background job to fire this on breach (CLAUDE.md: no queue yet), so
 * escalation is a derived read-time state rather than a stored one — any
 * query against `nextActionAt` recomputes it from `now`, with no migration
 * and nothing to drift out of sync.
 */
export const ESCALATION_THRESHOLD_HOURS = 24;

export type FollowUpBucket = "none" | "upcoming" | "today" | "overdue" | "escalated";

export function getFollowUpBucket(
  nextActionAt: Date | string | null | undefined,
  now: Date = new Date(),
): FollowUpBucket {
  if (!nextActionAt) return "none";
  const due = typeof nextActionAt === "string" ? new Date(nextActionAt) : nextActionAt;
  const overdueMs = now.getTime() - due.getTime();

  if (overdueMs >= ESCALATION_THRESHOLD_HOURS * 60 * 60 * 1000) return "escalated";
  if (overdueMs > 0) return "overdue";

  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  return sameDay ? "today" : "upcoming";
}

export function isEscalated(nextActionAt: Date | string | null | undefined, now?: Date): boolean {
  return getFollowUpBucket(nextActionAt, now) === "escalated";
}
