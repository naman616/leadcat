import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createSupabaseServerClient } from "./supabase/server";
import { createSupabaseAdminClient } from "./supabase/admin.server";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(1, "Full name is required"),
  orgName: z.string().min(1, "Organization name is required"),
});

/**
 * Creates the auth user, then — via the admin (service-role) client, the
 * one audited bypass — creates their first organization and makes them its
 * owner. Regular authenticated users have no INSERT policy on
 * organizations (see the RLS migration): org creation only happens here,
 * server-side, on signup. A self-serve "create another org" or "join an
 * existing org" flow is Phase 1+ product work, not this session's scope.
 */
export const signUp = createServerFn({ method: "POST" })
  .validator(signUpSchema)
  .handler(async ({ data }) => {
    const supabase = createSupabaseServerClient();

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { full_name: data.fullName } },
    });

    if (signUpError || !signUpData.user) {
      throw new Error(signUpError?.message ?? "Sign up failed");
    }

    const userId = signUpData.user.id;
    const admin = createSupabaseAdminClient();
    const baseSlug = slugify(data.orgName) || "org";
    const slug = `${baseSlug}-${userId.slice(0, 8)}`;

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: data.orgName, slug })
      .select()
      .single();

    if (orgError || !org) {
      throw new Error(orgError?.message ?? "Could not create organization");
    }

    const { error: memberError } = await admin
      .from("org_members")
      .insert({ org_id: org["id"], user_id: userId, role: "owner" });

    if (memberError) {
      throw new Error(memberError.message);
    }

    // Also seat the ad-spend-sync system account (docs/specs/10-ad-spend-sync.md)
    // as an org admin, so the nightly cron can sync this org's ad accounts
    // the same way any other org admin's syncAdSpend call would — same
    // service-role bypass this function already uses for org creation
    // itself, not a new one. Unset until scripts/setup-ad-spend-sync-system-
    // user.ts has been run for this environment (e.g. fresh local/dev), so
    // skip rather than fail signup when it's missing.
    const systemUserId = process.env["AD_SPEND_SYNC_SYSTEM_USER_ID"];
    if (systemUserId) {
      const { error: systemMemberError } = await admin
        .from("org_members")
        .insert({ org_id: org["id"], user_id: systemUserId, role: "admin" });
      if (systemMemberError) {
        console.error(
          "[signUp] failed to add ad-spend-sync system user to new org:",
          systemMemberError,
        );
      }
    }

    return { userId, orgId: org["id"] as string };
  });

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export const signIn = createServerFn({ method: "POST" })
  .validator(signInSchema)
  .handler(async ({ data }) => {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      throw new Error(error.message);
    }

    return { success: true as const };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  return { success: true as const };
});

/**
 * The current session's user plus their org memberships — read through
 * Prisma's normal, RLS-respecting path (withUserContext), not the admin
 * client. If this ever returns memberships from an org the caller doesn't
 * belong to, that's an RLS bug, not an app-logic bug — the same property
 * tests/tenant-isolation.test.ts proves.
 */
export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    return null;
  }

  const userId = data.claims.sub;

  return withUserContext(userId, async (tx) => {
    const [user, memberships] = await Promise.all([
      tx.user.findUnique({ where: { id: userId } }),
      tx.orgMember.findMany({ where: { userId }, include: { organization: true } }),
    ]);
    return { user, memberships };
  });
});

const updateProfileSchema = z.object({ fullName: z.string().min(1, "Full name is required") });

/** Relies on the existing "users can update self" RLS policy (id = auth.uid()). */
export const updateProfile = createServerFn({ method: "POST" })
  .validator(updateProfileSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return withUserContext(userId, (tx) =>
      tx.user.update({ where: { id: userId }, data: { fullName: data.fullName } }),
    );
  });
