import { createSupabaseServerClient } from "./supabase/server";
import { withUserContext } from "./db.server";

/** Verified Supabase user id for the current request, or throws. */
export async function requireUserId(): Promise<string> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    throw new Error("Not authenticated");
  }

  return data.claims.sub;
}

/**
 * The caller's org, inferred from their membership. Every user created via
 * signUp() belongs to exactly one org today (no org-switcher UI yet — see
 * docs/specs/00-overview.md), so "first membership" is the whole org
 * context for now. Goes through withUserContext like everything else —
 * app_user has no table grants of its own outside a SET ROLE'd context, so
 * this can't be a raw prisma call; it would just fail, not bypass RLS.
 */
export async function requirePrimaryOrgId(userId: string): Promise<string> {
  // orderBy is required, not cosmetic — without it, Postgres gives no row
  // ordering guarantee, so a multi-org user's "primary" org would be
  // effectively undefined (could differ between calls). Oldest membership
  // first is the least surprising choice: the org they joined earliest.
  const membership = await withUserContext(userId, (tx) =>
    tx.orgMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }),
  );
  if (!membership) {
    throw new Error("You don't belong to an organization yet");
  }
  return membership.orgId;
}
