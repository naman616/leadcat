// Pure function — no Prisma import, safe for both src/lib/lead-scoring.server.ts
// and unit tests (tests/lead-scoring.test.ts). This is a deterministic
// heuristic v1 for issue #50 (Phase 8). Phase 8's actual target is
// AI-driven scoring via an LLM API — out of scope here (needs an API key
// this repo doesn't have configured yet); this stand-in exists so the
// `score` column and its UI aren't blocked on that.
import type { LeadStatusValue } from "./lead-status";

export type ScorableLead = {
  status: LeadStatusValue;
  budget: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  /** Lead's next scheduled follow-up, if any (Lead.nextActionAt). */
  nextActionAt: Date | string | null;
  /** Most recent LeadActivity.createdAt for this lead, if any. */
  lastActivityAt: Date | string | null;
};

const RECENT_ACTIVITY_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * Heuristic v1 lead score, 0-100. Weights (sum to 100 when every signal is
 * present):
 * - both phone AND email on file: 20  — more ways to reach them, less
 *   likely to be a junk/incomplete enquiry.
 * - budget specified: 20              — browsing vs. a serious buyer.
 * - status has progressed past New: 30 — they've engaged at least once.
 * - still "live" — either a future next action is scheduled, or there was
 *   activity within the last 7 days: 30. A lead with neither has gone cold.
 */
export function scoreLead(lead: ScorableLead): number {
  let score = 0;

  if (lead.contactPhone && lead.contactEmail) score += 20;
  if (lead.budget) score += 20;
  if (lead.status !== "New") score += 30;

  const now = Date.now();
  const hasFutureNextAction = lead.nextActionAt && new Date(lead.nextActionAt).getTime() > now;
  const hasRecentActivity =
    lead.lastActivityAt &&
    (now - new Date(lead.lastActivityAt).getTime()) / MS_PER_DAY <= RECENT_ACTIVITY_WINDOW_DAYS;
  if (hasFutureNextAction || hasRecentActivity) score += 30;

  return score;
}
