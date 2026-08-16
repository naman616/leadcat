import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { createSupabaseAdminClient } from "./supabase/admin.server";
import { ORG_ROLE_VALUES } from "./org-role";

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

const addOrgMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(ORG_ROLE_VALUES),
});

/**
 * Adds an *existing* Supabase user (already signed up, just not in this
 * org yet) to the caller's org. Not a full email-invite flow — that's
 * explicitly deferred (see docs/specs/00-overview.md). Uses the service-
 * role admin client because looking someone up by email who doesn't share
 * an org with the caller is, correctly, invisible to a normal RLS-scoped
 * query — the same reason signUp()'s org creation needs the same bypass.
 *
 * Because the admin client skips RLS entirely, the "only owners/admins can
 * add members" check that RLS would normally enforce on org_members has to
 * be done explicitly, here, before ever reaching the admin client. Skipping
 * this check would let any org member — any role — add anyone to the org.
 */
export const addOrgMemberByEmail = createServerFn({ method: "POST" })
  .validator(addOrgMemberSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    const callerMembership = await withUserContext(userId, (tx) =>
      tx.orgMember.findFirst({ where: { orgId, userId } }),
    );
    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      throw new Error("Only org owners and admins can add members");
    }
    // The RLS policy on org_members separately enforces this too — but this
    // call goes through the service-role admin client below, which bypasses
    // RLS entirely, so that protection alone would not cover this path.
    // Without this check, any admin (not just an owner) could grant
    // ownership to anyone, including a second account they control.
    if (data.role === "owner" && callerMembership.role !== "owner") {
      throw new Error("Only an org owner can grant the owner role");
    }

    const admin = createSupabaseAdminClient();

    const { data: existingUser, error: lookupError } = await admin
      .from("users")
      .select("id, email, full_name")
      .eq("email", data.email)
      .maybeSingle();

    if (lookupError) throw new Error(lookupError.message);
    if (!existingUser) {
      throw new Error("No account found for that email — they need to sign up first.");
    }

    const { data: existingMembership, error: membershipLookupError } = await admin
      .from("org_members")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", existingUser["id"] as string)
      .maybeSingle();

    if (membershipLookupError) throw new Error(membershipLookupError.message);
    if (existingMembership) {
      throw new Error(`${existingUser["email"] as string} is already a member of this org.`);
    }

    const { error: insertError } = await admin
      .from("org_members")
      .insert({ org_id: orgId, user_id: existingUser["id"] as string, role: data.role });

    if (insertError) throw new Error(insertError.message);

    return {
      email: existingUser["email"] as string,
      fullName: existingUser["full_name"] as string | null,
    };
  });

const removeOrgMemberSchema = z.object({ orgMemberId: z.string().uuid() });

/**
 * Unlike addOrgMemberByEmail, this needs no explicit role check — the
 * existing RLS DELETE policy on org_members ("org owners and admins can
 * remove members") already enforces it. A non-admin's attempt matches zero
 * rows and Prisma surfaces that as "record not found," same as every other
 * RLS-blocked write in this app.
 */
export const removeOrgMember = createServerFn({ method: "POST" })
  .validator(removeOrgMemberSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return withUserContext(userId, (tx) =>
      tx.orgMember.delete({ where: { id: data.orgMemberId } }),
    );
  });
