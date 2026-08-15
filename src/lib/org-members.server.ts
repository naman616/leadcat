import { createServerFn } from "@tanstack/react-start";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";

/**
 * Real org members (not the mock Team page data) for assignment dropdowns.
 * RLS already scopes this to orgs the caller belongs to — see
 * "org members can view memberships in their org" in
 * prisma/migrations/*_init/migration.sql.
 */
export const listOrgMembers = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, (tx) =>
    tx.orgMember.findMany({
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
});
