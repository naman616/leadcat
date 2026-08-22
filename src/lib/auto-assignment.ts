// Pure functions — no Prisma import, unit-testable without a DB. See
// src/lib/auto-assignment.server.ts for the DB-backed wiring (fetching
// eligible agents / live open-lead counts, then calling these).

/**
 * Round-robin: pick the next agent after lastAssignedUserId in the given
 * stable order (eligibleUserIds is expected to be pre-sorted by the caller,
 * e.g. by orgMember.createdAt). Wraps around at the end. Falls back to the
 * first agent when there's no prior cursor, or when the cursor's user is no
 * longer in the eligible list (left the org, role changed, etc.) —
 * indexOf returning -1 naturally lands on index 0 either way.
 */
export function pickRoundRobinAgent(
  eligibleUserIds: string[],
  lastAssignedUserId: string | null,
): string | null {
  if (eligibleUserIds.length === 0) return null;
  const lastIdx = lastAssignedUserId ? eligibleUserIds.indexOf(lastAssignedUserId) : -1;
  const nextIdx = (lastIdx + 1) % eligibleUserIds.length;
  return eligibleUserIds[nextIdx]!;
}

export type LoadBalancedCandidate = { userId: string; openLeadCount: number };

/**
 * Load-balanced: pick whichever agent currently has the fewest open leads.
 * Ties are broken by earliest position in the array the caller passes in —
 * callers should pass agents in the same stable order as round-robin
 * (orgMember.createdAt) so ties resolve deterministically.
 */
export function pickLoadBalancedAgent(candidates: LoadBalancedCandidate[]): string | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((min, c) => (c.openLeadCount < min.openLeadCount ? c : min)).userId;
}
