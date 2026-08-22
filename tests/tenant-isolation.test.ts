// Proves the RLS-based multi-tenancy boundary: two orgs, two users, and a
// user from org B must get zero rows — not an error, not org A's data —
// when reading anything scoped to org A. See docs/specs/00-overview.md.
//
// Runs only against a throwaway local/CI Postgres bootstrapped via
// prisma/test-bootstrap.sql + prisma/migrations (see scripts/apply-test-schema.ts).
// Never against the real Supabase project — guarded below.
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Run scripts/apply-test-schema.ts against a throwaway " +
      "Postgres instance first, then point TEST_DATABASE_URL at it.",
  );
}
if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must not equal DATABASE_URL — refusing to run tenant-isolation tests " +
      "against what looks like the real Supabase project.",
  );
}

const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });

type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` inside a transaction with the Postgres session set up exactly
 * the way a real authenticated Supabase request is: ROLE authenticated,
 * plus a request.jwt.claims GUC whose "sub" is userId — which is what the
 * real auth.uid() (and our test-bootstrap.sql stand-in) reads. SET LOCAL is
 * transaction-scoped, so this must all happen in one transaction.
 */
async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
    await tx.$executeRawUnsafe(
      `SET LOCAL "request.jwt.claims" TO '${JSON.stringify({ sub: userId, role: "authenticated" })}'`,
    );
    return fn(tx);
  });
}

/** Same idea, but for a fully unauthenticated request (no resolvable user). */
async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
    return fn(tx);
  });
}

/**
 * Same idea, for the one anon path that's allowed to write: the public
 * website lead-capture form (issue #22). Sets a "request.form_token" GUC,
 * which app.org_id_for_form_token() (prisma/migrations/
 * 20260822080000_website_lead_form_token) reads to resolve which org, if
 * any, this token authorizes an INSERT into. Mirrors withAnonFormContext in
 * src/lib/db.server.ts exactly.
 */
async function asAnonWithFormToken<T>(formToken: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
    await tx.$executeRawUnsafe(`SET LOCAL "request.form_token" TO '${formToken}'`);
    return fn(tx);
  });
}

const run = randomUUID().slice(0, 8);

const orgA = { id: randomUUID(), name: "Org A Realty", slug: `org-a-${run}` };
const orgB = { id: randomUUID(), name: "Org B Realty", slug: `org-b-${run}` };
const userA = { id: randomUUID(), email: `user-a-${run}@example.com` };
const userB = { id: randomUUID(), email: `user-b-${run}@example.com` };

// Extra users for the role-escalation / same-org-stealing / handoff /
// org-pinning regression tests below — see docs/specs/01-leads.md for the
// bugs these were written to catch.
const userA2 = { id: randomUUID(), email: `user-a2-${run}@example.com` }; // admin in orgA (userA is owner)
const userB2 = { id: randomUUID(), email: `user-b2-${run}@example.com` }; // agent in orgB, not assigned leadB
const userMulti = { id: randomUUID(), email: `user-multi-${run}@example.com` }; // agent in BOTH orgs
const agentX = { id: randomUUID(), email: `agent-x-${run}@example.com` }; // agent in orgA
const agentY = { id: randomUUID(), email: `agent-y-${run}@example.com` }; // agent in orgA

const contactA = { id: randomUUID(), orgId: orgA.id, fullName: "Contact A" };
const contactB = { id: randomUUID(), orgId: orgB.id, fullName: "Contact B" };
// leadA starts unassigned on purpose — this is what exercises the
// can_manage_lead "unclaimed lead" branch across orgs (see the bug this
// caught, documented in docs/specs/01-leads.md).
const leadA = { id: randomUUID(), orgId: orgA.id, contactId: contactA.id };
const leadB = { id: randomUUID(), orgId: orgB.id, contactId: contactB.id, assignedTo: userB.id };
// Dedicated, unassigned leads so the tests below don't depend on execution
// order / side effects of other tests touching leadA.
const leadForOrgPinTest = { id: randomUUID(), orgId: orgA.id, contactId: contactA.id };
const leadForHandoff = {
  id: randomUUID(),
  orgId: orgA.id,
  contactId: contactA.id,
  assignedTo: agentX.id,
};

// Inventory fixtures for the unit price history tests below.
const projectA = { id: randomUUID(), orgId: orgA.id, name: "Project A", city: "Pune", type: "Residential" as const };
const projectB = { id: randomUUID(), orgId: orgB.id, name: "Project B", city: "Pune", type: "Residential" as const };
const unitA = { id: randomUUID(), orgId: orgA.id, projectId: projectA.id, unitNumber: "A-101", price: "50L" };
const unitB = { id: randomUUID(), orgId: orgB.id, projectId: projectB.id, unitNumber: "B-101", price: "60L" };

// Populated in beforeAll from the DB-generated defaults — not set on the
// literals above, since publicFormToken is gen_random_uuid()-defaulted,
// not something a test should hand-assign.
let orgAFormToken: string;
let orgBFormToken: string;

beforeAll(async () => {
  // Seeded as the connection's base role (postgres superuser in the test
  // container), which bypasses RLS — the equivalent of the one audited
  // service-role admin path in real Supabase.
  const allUsers = [userA, userB, userA2, userB2, userMulti, agentX, agentY];
  await prisma.$executeRawUnsafe(
    `INSERT INTO auth.users (id, email) SELECT * FROM UNNEST($1::uuid[], $2::text[])`,
    allUsers.map((u) => u.id),
    allUsers.map((u) => u.email),
  );

  await prisma.organization.createMany({ data: [orgA, orgB] });

  await prisma.orgMember.createMany({
    data: [
      { orgId: orgA.id, userId: userA.id, role: "owner" },
      { orgId: orgB.id, userId: userB.id, role: "owner" },
      { orgId: orgA.id, userId: userA2.id, role: "admin" },
      { orgId: orgB.id, userId: userB2.id, role: "agent" },
      { orgId: orgA.id, userId: userMulti.id, role: "agent" },
      { orgId: orgB.id, userId: userMulti.id, role: "agent" },
      { orgId: orgA.id, userId: agentX.id, role: "agent" },
      { orgId: orgA.id, userId: agentY.id, role: "agent" },
    ],
  });

  await prisma.contact.createMany({ data: [contactA, contactB] });
  await prisma.lead.createMany({ data: [leadA, leadB, leadForOrgPinTest, leadForHandoff] });

  await prisma.project.createMany({ data: [projectA, projectB] });
  await prisma.unit.createMany({ data: [unitA, unitB] });

  const [fetchedOrgA, fetchedOrgB] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgA.id } }),
    prisma.organization.findUniqueOrThrow({ where: { id: orgB.id } }),
  ]);
  orgAFormToken = fetchedOrgA.publicFormToken;
  orgBFormToken = fetchedOrgB.publicFormToken;
});

afterAll(async () => {
  // auth.users FK is ON DELETE CASCADE into public.users/org_members; org
  // FK cascades into contacts/leads/lead_activities/lead_assignments.
  const allUserIds = [userA, userB, userA2, userB2, userMulti, agentX, agentY].map((u) => u.id);
  await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, allUserIds);
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

describe("tenant isolation", () => {
  it("lets a user see their own org, not the other org", async () => {
    const seenByA = await asUser(userA.id, (tx) => tx.organization.findMany());
    expect(seenByA.map((o) => o.id)).toEqual([orgA.id]);

    const seenByB = await asUser(userB.id, (tx) => tx.organization.findMany());
    expect(seenByB.map((o) => o.id)).toEqual([orgB.id]);
  });

  it("returns zero rows, not an error, for a direct lookup of another org's row", async () => {
    const result = await asUser(userB.id, (tx) =>
      tx.organization.findUnique({ where: { id: orgA.id } }),
    );
    expect(result).toBeNull();
  });

  it("isolates org_members the same way", async () => {
    // orgB has 3 members (userB, userB2, userMulti) — all visible to userB,
    // and none of orgA's members should leak through.
    const seenByB = await asUser(userB.id, (tx) => tx.orgMember.findMany());
    expect(seenByB.every((m) => m.orgId === orgB.id)).toBe(true);
    expect(seenByB.map((m) => m.userId).sort()).toEqual([userB.id, userB2.id, userMulti.id].sort());

    const crossOrgLookup = await asUser(userB.id, (tx) =>
      tx.orgMember.findMany({ where: { orgId: orgA.id } }),
    );
    expect(crossOrgLookup).toHaveLength(0);
  });

  it("isolates the users table — a user cannot see a stranger from another org", async () => {
    const seenByA = await asUser(userA.id, (tx) => tx.user.findMany());
    const idsSeenByA = seenByA.map((u) => u.id);
    expect(idsSeenByA).toContain(userA.id);
    expect(idsSeenByA).not.toContain(userB.id);
  });

  it("returns zero rows for a fully unauthenticated (anon) request", async () => {
    const orgs = await asAnon((tx) => tx.organization.findMany());
    const members = await asAnon((tx) => tx.orgMember.findMany());
    const users = await asAnon((tx) => tx.user.findMany());

    expect(orgs).toHaveLength(0);
    expect(members).toHaveLength(0);
    expect(users).toHaveLength(0);
  });

  it("returns zero rows for an authenticated request with no resolvable membership", async () => {
    // authenticated role, but auth.uid() has nothing to resolve — a user
    // with a valid session and zero org memberships.
    const orphanId = randomUUID();
    const orgs = await asUser(orphanId, (tx) => tx.organization.findMany());
    expect(orgs).toHaveLength(0);
  });
});

describe("lead management isolation", () => {
  it("isolates contacts the same way as orgs/members/users", async () => {
    const seenByB = await asUser(userB.id, (tx) => tx.contact.findMany());
    expect(seenByB.map((c) => c.id)).toEqual([contactB.id]);
  });

  it("isolates leads — list and direct lookup both return nothing, not an error", async () => {
    const seenByB = await asUser(userB.id, (tx) => tx.lead.findMany());
    expect(seenByB.map((l) => l.id)).toEqual([leadB.id]);

    const direct = await asUser(userB.id, (tx) => tx.lead.findUnique({ where: { id: leadA.id } }));
    expect(direct).toBeNull();
  });

  it("a user in a different org cannot claim another org's unclaimed lead", async () => {
    // leadA is unassigned. This is exactly the bug can_manage_lead had
    // before it also checked org membership: "assigned_to IS NULL" alone
    // used to be enough for ANY authenticated user to pass, regardless of
    // org. userB (org B) attempting to touch leadA (org A, unclaimed) must
    // fail — RLS makes the row invisible to update, which Prisma surfaces
    // as "record not found," not a permission error and not the row's data.
    await expect(
      asUser(userB.id, (tx) =>
        tx.lead.update({ where: { id: leadA.id }, data: { status: "Callback" } }),
      ),
    ).rejects.toMatchObject({ code: "P2025" });
  });

  it("a member of the lead's own org CAN claim an unclaimed lead", async () => {
    const claimed = await asUser(userA.id, (tx) =>
      tx.lead.update({ where: { id: leadA.id }, data: { assignedTo: userA.id } }),
    );
    expect(claimed.assignedTo).toBe(userA.id);

    // Reset for other tests / reruns.
    await asUser(userA.id, (tx) =>
      tx.lead.update({ where: { id: leadA.id }, data: { assignedTo: null } }),
    );
  });

  it("isolates lead_activities and lead_assignments", async () => {
    await asUser(userB.id, (tx) =>
      tx.leadActivity.create({
        data: { orgId: orgB.id, leadId: leadB.id, type: "note", body: "Called, interested." },
      }),
    );
    await asUser(userB.id, (tx) =>
      tx.leadAssignment.create({
        data: { orgId: orgB.id, leadId: leadB.id, assignedTo: userB.id },
      }),
    );

    const activitiesSeenByA = await asUser(userA.id, (tx) => tx.leadActivity.findMany());
    const assignmentsSeenByA = await asUser(userA.id, (tx) => tx.leadAssignment.findMany());

    expect(activitiesSeenByA).toHaveLength(0);
    expect(assignmentsSeenByA).toHaveLength(0);
  });
});

// These all cover findings from an independent security review — each one
// maps to a specific gap that review caught, listed in docs/specs/01-leads.md
// and in the migration comments for 20260815143031_fix_role_escalation_and_org_pinning.
describe("org governance and lead-handoff regressions", () => {
  it("a plain admin cannot promote themselves (or anyone) to owner", async () => {
    // userA2 is 'admin' in orgA — is_org_admin() is true for them, which
    // used to be the only check on org_members writes. This is exactly the
    // exploit: an admin escalating their own row to 'owner'.
    //
    // Postgres RLS note: USING sees this row is theirs and lets it through
    // (a plain admin CAN normally update their own row), but WITH CHECK
    // rejects the resulting role='owner' value — so this is a hard error,
    // not a silent 0-row match. That's only the case because USING passed;
    // compare to the DELETE test below, which has no WITH CHECK at all, so
    // an ineligible row is just never matched (count: 0, no error).
    await expect(
      asUser(userA2.id, (tx) =>
        tx.orgMember.updateMany({
          where: { orgId: orgA.id, userId: userA2.id },
          data: { role: "owner" },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a plain admin cannot remove the org's owner", async () => {
    const result = await asUser(userA2.id, (tx) =>
      tx.orgMember.deleteMany({ where: { orgId: orgA.id, userId: userA.id } }),
    );
    expect(result.count).toBe(0);
  });

  it("the sole owner cannot demote themselves away from owner", async () => {
    // Guards against an org ending up with zero owners — after this,
    // nobody could ever grant owner-level permission again. Same USING-
    // passes-but-WITH-CHECK-fails shape as the promotion test above: the
    // owner can normally update their own row, so this is a hard error.
    await expect(
      asUser(userA.id, (tx) =>
        tx.orgMember.updateMany({
          where: { orgId: orgA.id, userId: userA.id },
          data: { role: "admin" },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("org_id cannot be changed on an existing lead, even by a member of both orgs", async () => {
    // userMulti belongs to both orgA and orgB — exactly the case the old
    // WITH CHECK (is_org_member(new org_id)) let through, since it only
    // checked the new org_id was *some* org they belonged to, never that
    // it matched the row's existing org_id.
    await expect(
      asUser(userMulti.id, (tx) =>
        tx.lead.update({ where: { id: leadForOrgPinTest.id }, data: { orgId: orgB.id } }),
      ),
    ).rejects.toThrow(/org_id cannot be changed/);
  });

  it("a non-admin cannot steal a colleague's already-assigned lead in the same org", async () => {
    // leadB is assigned to userB. userB2 is a same-org agent — not an
    // admin, not the current assignee — trying to grab it for themselves.
    const result = await asUser(userB2.id, (tx) =>
      tx.lead.updateMany({ where: { id: leadB.id }, data: { assignedTo: userB2.id } }),
    );
    expect(result.count).toBe(0);
  });

  it("an org admin CAN delete a contact in their own org", async () => {
    // Regression test for 20260818230000_contacts_dedup, the "org admins
    // can delete contacts" policy the dedup engine's merge step relies on.
    const contactToDelete = { id: randomUUID(), orgId: orgA.id, fullName: "Deletable A" };
    await prisma.contact.create({ data: contactToDelete });

    const result = await asUser(userA2.id, (tx) =>
      tx.contact.deleteMany({ where: { id: contactToDelete.id } }),
    );
    expect(result.count).toBe(1);
  });

  it("a non-admin CANNOT delete a contact, even in their own org", async () => {
    const contactToDelete = { id: randomUUID(), orgId: orgA.id, fullName: "Not Deletable" };
    await prisma.contact.create({ data: contactToDelete });

    const result = await asUser(agentX.id, (tx) =>
      tx.contact.deleteMany({ where: { id: contactToDelete.id } }),
    );
    expect(result.count).toBe(0);

    await prisma.contact.delete({ where: { id: contactToDelete.id } });
  });

  it("an admin CANNOT delete a contact belonging to another org", async () => {
    // userA2 is admin in orgA only; contactB belongs to orgB.
    const result = await asUser(userA2.id, (tx) =>
      tx.contact.deleteMany({ where: { id: contactB.id } }),
    );
    expect(result.count).toBe(0);
  });

  it("a non-admin CAN hand off their own lead to a named colleague", async () => {
    // Regression test for the bug this exact scenario used to trip:
    // recording the assignment BEFORE updating the lead (mirroring the
    // fixed order in reassignLead) must succeed for two ordinary agents —
    // this used to fail because can_manage_lead re-queries leads live, and
    // used to be checked against the lead's state *after* it had already
    // been reassigned away from the caller.
    const updated = await asUser(agentX.id, async (tx) => {
      await tx.leadAssignment.create({
        data: {
          orgId: orgA.id,
          leadId: leadForHandoff.id,
          assignedTo: agentY.id,
          assignedBy: agentX.id,
        },
      });
      return tx.lead.update({
        where: { id: leadForHandoff.id },
        data: { assignedTo: agentY.id },
      });
    });
    expect(updated.assignedTo).toBe(agentY.id);
  });
});


// Regression tests for issue #19 (project media metadata) — see
// prisma/migrations/20260819010000_project_media and
// docs/specs/02-inventory.md's "project_media" section. Mirrors the
// contacts-delete-policy test shape (org admin can write, non-admin
// cannot, even in their own org; cross-org writes never succeed).
describe("project media isolation", () => {
  const projectA = {
    id: randomUUID(),
    orgId: orgA.id,
    name: "Media Test Project A",
    city: "Pune",
    type: "Residential" as const,
  };
  const projectB = {
    id: randomUUID(),
    orgId: orgB.id,
    name: "Media Test Project B",
    city: "Mumbai",
    type: "Residential" as const,
  };

  beforeAll(async () => {
    await prisma.project.createMany({ data: [projectA, projectB] });
  });

  it("org members can view a project's media, but not another org's", async () => {
    const media = {
      id: randomUUID(),
      orgId: orgA.id,
      projectId: projectA.id,
      type: "brochure" as const,
      fileName: "brochure.pdf",
      storagePath: "orgA/projectA/brochure.pdf",
    };
    await prisma.projectMedia.create({ data: media });

    const seenByA = await asUser(userA.id, (tx) =>
      tx.projectMedia.findMany({ where: { projectId: projectA.id } }),
    );
    expect(seenByA.map((m) => m.id)).toEqual([media.id]);

    const seenByB = await asUser(userB.id, (tx) =>
      tx.projectMedia.findMany({ where: { projectId: projectA.id } }),
    );
    expect(seenByB).toHaveLength(0);
  });

  it("an org admin CAN upload project media in their own org", async () => {
    const created = await asUser(userA2.id, (tx) =>
      tx.projectMedia.create({
        data: {
          orgId: orgA.id,
          projectId: projectA.id,
          type: "price_sheet",
          fileName: "price-sheet.pdf",
          storagePath: "orgA/projectA/price-sheet.pdf",
          uploadedBy: userA2.id,
        },
      }),
    );
    expect(created.orgId).toBe(orgA.id);
  });

  it("a non-admin CANNOT upload project media, even in their own org", async () => {
    // agentX is a plain agent in orgA. Unlike the UPDATE/DELETE tests below
    // (USING quietly filters to a zero-row match), an INSERT's WITH CHECK
    // failing is a hard RLS error — there's no existing row for USING to
    // filter, so Postgres rejects the new row outright.
    await expect(
      asUser(agentX.id, (tx) =>
        tx.projectMedia.create({
          data: {
            orgId: orgA.id,
            projectId: projectA.id,
            type: "other",
            fileName: "not-allowed.pdf",
            storagePath: "orgA/projectA/not-allowed.pdf",
            uploadedBy: agentX.id,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("an org admin CAN delete project media in their own org", async () => {
    const toDelete = {
      id: randomUUID(),
      orgId: orgA.id,
      projectId: projectA.id,
      type: "other" as const,
      fileName: "deletable.pdf",
      storagePath: "orgA/projectA/deletable.pdf",
    };
    await prisma.projectMedia.create({ data: toDelete });

    const result = await asUser(userA2.id, (tx) =>
      tx.projectMedia.deleteMany({ where: { id: toDelete.id } }),
    );
    expect(result.count).toBe(1);
  });

  it("a non-admin CANNOT delete project media, even in their own org", async () => {
    const toDelete = {
      id: randomUUID(),
      orgId: orgA.id,
      projectId: projectA.id,
      type: "other" as const,
      fileName: "not-deletable.pdf",
      storagePath: "orgA/projectA/not-deletable.pdf",
    };
    await prisma.projectMedia.create({ data: toDelete });

    const result = await asUser(agentX.id, (tx) =>
      tx.projectMedia.deleteMany({ where: { id: toDelete.id } }),
    );
    expect(result.count).toBe(0);

    await prisma.projectMedia.delete({ where: { id: toDelete.id } });
  });

  it("an admin CANNOT delete project media belonging to another org", async () => {
    const mediaB = {
      id: randomUUID(),
      orgId: orgB.id,
      projectId: projectB.id,
      type: "other" as const,
      fileName: "org-b-only.pdf",
      storagePath: "orgB/projectB/org-b-only.pdf",
    };
    await prisma.projectMedia.create({ data: mediaB });

    const result = await asUser(userA2.id, (tx) =>
      tx.projectMedia.deleteMany({ where: { id: mediaB.id } }),
    );
    expect(result.count).toBe(0);
  });
});

// Regression tests for 20260822090000_tasks_core — see docs/specs/04-tasks.md
// for the full reasoning behind app.can_manage_task. Task fixtures are
// created inline per test (superuser connection, bypasses RLS, same as the
// contacts-delete tests above) rather than in the shared beforeAll, since
// each test needs its own combination of creator/assignee.
describe("task isolation and permissions", () => {
  it("isolates tasks the same way as leads — list and direct lookup both return nothing across orgs", async () => {
    const taskA = { id: randomUUID(), orgId: orgA.id, title: "Org A task", createdBy: userA.id };
    const taskB = { id: randomUUID(), orgId: orgB.id, title: "Org B task", createdBy: userB.id };
    await prisma.task.createMany({ data: [taskA, taskB] });

    const seenByB = await asUser(userB.id, (tx) => tx.task.findMany());
    expect(seenByB.map((t) => t.id)).toEqual([taskB.id]);

    const direct = await asUser(userB.id, (tx) => tx.task.findUnique({ where: { id: taskA.id } }));
    expect(direct).toBeNull();
  });

  it("any org member can create a task in their own org, but not in another org", async () => {
    const created = await asUser(agentX.id, (tx) =>
      tx.task.create({ data: { orgId: orgA.id, title: "Chase RERA doc", createdBy: agentX.id } }),
    );
    expect(created.orgId).toBe(orgA.id);

    await expect(
      asUser(userB.id, (tx) =>
        tx.task.create({ data: { orgId: orgA.id, title: "Cross-org insert", createdBy: userB.id } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("any org member can view a task in their org regardless of who created or is assigned it", async () => {
    const task = { id: randomUUID(), orgId: orgA.id, title: "Visible to all", createdBy: userA.id };
    await prisma.task.create({ data: task });

    const seenByAgentY = await asUser(agentY.id, (tx) =>
      tx.task.findUnique({ where: { id: task.id } }),
    );
    expect(seenByAgentY?.id).toBe(task.id);
  });

  it("the assignee can complete a task they didn't create", async () => {
    const task = {
      id: randomUUID(),
      orgId: orgA.id,
      title: "Follow up with buyer",
      createdBy: userA.id,
      assignedTo: agentY.id,
    };
    await prisma.task.create({ data: task });

    const completed = await asUser(agentY.id, (tx) =>
      tx.task.update({ where: { id: task.id }, data: { completedAt: new Date() } }),
    );
    expect(completed.completedAt).not.toBeNull();
  });

  it("the creator can complete a task assigned to someone else", async () => {
    const task = {
      id: randomUUID(),
      orgId: orgA.id,
      title: "Send brochure",
      createdBy: agentX.id,
      assignedTo: agentY.id,
    };
    await prisma.task.create({ data: task });

    const completed = await asUser(agentX.id, (tx) =>
      tx.task.update({ where: { id: task.id }, data: { completedAt: new Date() } }),
    );
    expect(completed.completedAt).not.toBeNull();
  });

  it("an org admin can complete any task in their org, even unrelated to them", async () => {
    const task = {
      id: randomUUID(),
      orgId: orgA.id,
      title: "Book site visit",
      createdBy: agentX.id,
      assignedTo: agentY.id,
    };
    await prisma.task.create({ data: task });

    const completed = await asUser(userA2.id, (tx) =>
      tx.task.update({ where: { id: task.id }, data: { completedAt: new Date() } }),
    );
    expect(completed.completedAt).not.toBeNull();
  });

  it("reopening follows the same rule — the assignee can clear completedAt", async () => {
    const task = {
      id: randomUUID(),
      orgId: orgA.id,
      title: "Call back next week",
      createdBy: userA.id,
      assignedTo: agentY.id,
      completedAt: new Date(),
    };
    await prisma.task.create({ data: task });

    const reopened = await asUser(agentY.id, (tx) =>
      tx.task.update({ where: { id: task.id }, data: { completedAt: null } }),
    );
    expect(reopened.completedAt).toBeNull();
  });

  it("a same-org member with no relationship to the task cannot update it", async () => {
    // userMulti is a plain agent in orgA — not the assignee, not the
    // creator, not an admin.
    const task = {
      id: randomUUID(),
      orgId: orgA.id,
      title: "Unrelated to userMulti",
      createdBy: agentX.id,
      assignedTo: agentY.id,
    };
    await prisma.task.create({ data: task });

    const result = await asUser(userMulti.id, (tx) =>
      tx.task.updateMany({ where: { id: task.id }, data: { completedAt: new Date() } }),
    );
    expect(result.count).toBe(0);
  });

  it("a user from a different org cannot update a task in another org", async () => {
    const task = { id: randomUUID(), orgId: orgA.id, title: "Org A only", createdBy: userA.id };
    await prisma.task.create({ data: task });

    const result = await asUser(userB.id, (tx) =>
      tx.task.updateMany({ where: { id: task.id }, data: { completedAt: new Date() } }),
    );
    expect(result.count).toBe(0);
  });

  it("org_id cannot be changed on an existing task, even by a member of both orgs", async () => {
    const task = {
      id: randomUUID(),
      orgId: orgA.id,
      title: "Pinned to org A",
      createdBy: userA.id,
      assignedTo: userMulti.id,
    };
    await prisma.task.create({ data: task });

    await expect(
      asUser(userMulti.id, (tx) =>
        tx.task.update({ where: { id: task.id }, data: { orgId: orgB.id } }),
      ),
    ).rejects.toThrow(/org_id cannot be changed/);
  });
});

// Regression tests for 20260822120000_unit_price_history and
// src/lib/unit-price.server.ts's updateUnitPrice. requireUserId() needs a
// real request context this test file doesn't have, so — same precedent as
// the lead-handoff test above — these replicate updateUnitPrice's exact
// tx body (unit.update + unitPriceHistory.create, one transaction) via the
// asUser helper rather than calling the server function directly.
describe("unit price history", () => {
  it("isolates unit price history by org", async () => {
    await asUser(userA.id, (tx) =>
      tx.unitPriceHistory.create({
        data: { orgId: orgA.id, unitId: unitA.id, price: "50L", changedBy: userA.id },
      }),
    );
    await asUser(userB.id, (tx) =>
      tx.unitPriceHistory.create({
        data: { orgId: orgB.id, unitId: unitB.id, price: "60L", changedBy: userB.id },
      }),
    );

    const seenByB = await asUser(userB.id, (tx) => tx.unitPriceHistory.findMany());
    expect(seenByB.every((h) => h.orgId === orgB.id)).toBe(true);
    expect(seenByB.map((h) => h.unitId)).not.toContain(unitA.id);
  });

  it("any org member (not just admins) can read a unit's price history", async () => {
    // agentX is a plain agent in orgA, not admin/owner.
    const seenByAgent = await asUser(agentX.id, (tx) =>
      tx.unitPriceHistory.findMany({ where: { unitId: unitA.id } }),
    );
    expect(seenByAgent.length).toBeGreaterThan(0);
    expect(seenByAgent.every((h) => h.orgId === orgA.id)).toBe(true);
  });

  it("an org admin can update a unit's price and the history row lands atomically", async () => {
    const result = await asUser(userA.id, async (tx) => {
      const unit = await tx.unit.update({ where: { id: unitA.id }, data: { price: "55L" } });
      const history = await tx.unitPriceHistory.create({
        data: { orgId: unit.orgId, unitId: unit.id, price: "55L", changedBy: userA.id },
      });
      return { unit, history };
    });
    expect(result.unit.price).toBe("55L");
    expect(result.history.price).toBe("55L");

    const historyRows = await prisma.unitPriceHistory.findMany({
      where: { unitId: unitA.id, price: "55L" },
    });
    expect(historyRows).toHaveLength(1);
  });

  it("a non-admin cannot write unit price history, and the price update rolls back with it", async () => {
    // agentX is a plain agent in orgA — units' UPDATE policy would let them
    // through, but unit_price_history's INSERT policy is admin-only, and
    // both writes share one transaction, so the RLS rejection on the
    // history insert must undo the price update too.
    await expect(
      asUser(agentX.id, async (tx) => {
        const unit = await tx.unit.update({ where: { id: unitA.id }, data: { price: "999L" } });
        await tx.unitPriceHistory.create({
          data: { orgId: unit.orgId, unitId: unit.id, price: "999L", changedBy: agentX.id },
        });
      }),
    ).rejects.toThrow(/row-level security/);

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitA.id } });
    expect(unit.price).toBe("55L"); // unchanged from the admin test above, not "999L"

    const strayHistory = await prisma.unitPriceHistory.findMany({
      where: { unitId: unitA.id, price: "999L" },
    });
    expect(strayHistory).toHaveLength(0);
  });

  it("a user from another org can't touch a unit they can't even see", async () => {
    await expect(
      asUser(userB.id, (tx) => tx.unit.update({ where: { id: unitA.id }, data: { price: "1L" } })),
    ).rejects.toMatchObject({ code: "P2025" });
  });
});

// Regression tests for 20260822130000_call_logs and
// src/lib/telephony.server.ts's initiateClickToCall — issue #30. Mirrors the
// unit_price_history describe block's shape: org isolation, member-can-
// create/view (no admin gate — call_logs' RLS is open to any org member,
// same as lead_activities), cross-org cannot, and the atomic
// CallLog + LeadActivity write. requireUserId()/requirePrimaryOrgId() need a
// real request context this test file doesn't have, so — same precedent as
// the lead-handoff and unit-price tests above — the atomicity test
// replicates initiateClickToCall's exact tx body via the asUser helper
// rather than calling the server function directly.
describe("call log isolation and click-to-call atomicity", () => {
  it("isolates call logs by org", async () => {
    await asUser(userA.id, (tx) =>
      tx.callLog.create({
        data: {
          orgId: orgA.id,
          leadId: leadA.id,
          direction: "outbound",
          fromNumber: "+911111111111",
          toNumber: "+912222222222",
          initiatedBy: userA.id,
        },
      }),
    );
    await asUser(userB.id, (tx) =>
      tx.callLog.create({
        data: {
          orgId: orgB.id,
          leadId: leadB.id,
          direction: "outbound",
          fromNumber: "+913333333333",
          toNumber: "+914444444444",
          initiatedBy: userB.id,
        },
      }),
    );

    const seenByB = await asUser(userB.id, (tx) => tx.callLog.findMany());
    expect(seenByB.every((c) => c.orgId === orgB.id)).toBe(true);
    expect(seenByB.map((c) => c.leadId)).not.toContain(leadA.id);
  });

  it("any org member (not just admins) can view and create call logs", async () => {
    // agentX is a plain agent in orgA, not admin/owner — mirrors how
    // lead_activities has no admin gate, unlike unit_price_history.
    const created = await asUser(agentX.id, (tx) =>
      tx.callLog.create({
        data: {
          orgId: orgA.id,
          leadId: leadA.id,
          direction: "outbound",
          fromNumber: "+915555555555",
          toNumber: "+916666666666",
          initiatedBy: agentX.id,
        },
      }),
    );
    expect(created.orgId).toBe(orgA.id);

    const seenByAgent = await asUser(agentX.id, (tx) =>
      tx.callLog.findMany({ where: { leadId: leadA.id } }),
    );
    expect(seenByAgent.length).toBeGreaterThan(0);
    expect(seenByAgent.every((c) => c.orgId === orgA.id)).toBe(true);
  });

  it("a user from a different org cannot create a call log in another org's lead", async () => {
    await expect(
      asUser(userB.id, (tx) =>
        tx.callLog.create({
          data: {
            orgId: orgA.id,
            leadId: leadA.id,
            direction: "outbound",
            fromNumber: "+917777777777",
            toNumber: "+918888888888",
            initiatedBy: userB.id,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("initiateClickToCall creates the CallLog and the LeadActivity atomically", async () => {
    const result = await asUser(userA.id, async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({
        where: { id: leadA.id },
        include: { contact: { select: { phone: true } } },
      });
      const toNumber = lead.contact.phone ?? "+919999999999";
      const providerCallId = "mock-test-call";

      const callLog = await tx.callLog.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          direction: "outbound",
          fromNumber: "+910000000000",
          toNumber,
          initiatedBy: userA.id,
          status: "initiated",
        },
      });

      const activity = await tx.leadActivity.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "call",
          body: `Call initiated to ${toNumber} (provider call ${providerCallId})`,
          createdBy: userA.id,
        },
      });

      return { callLog, activity };
    });

    expect(result.callLog.leadId).toBe(leadA.id);
    expect(result.callLog.status).toBe("initiated");
    expect(result.activity.leadId).toBe(leadA.id);
    expect(result.activity.type).toBe("call");
    expect(result.activity.body).toContain("mock-test-call");

    const storedCallLog = await prisma.callLog.findUniqueOrThrow({ where: { id: result.callLog.id } });
    const storedActivity = await prisma.leadActivity.findUniqueOrThrow({
      where: { id: result.activity.id },
    });
    expect(storedCallLog.leadId).toBe(leadA.id);
    expect(storedActivity.leadId).toBe(leadA.id);
  });

  it("a rejected call log write rolls back the whole transaction (no orphaned activity)", async () => {
    // userB has no membership/visibility into leadA (org A) — the CallLog
    // insert's WITH CHECK fails, and since both writes share one
    // transaction, no LeadActivity should land either.
    const activityCountBefore = await prisma.leadActivity.count({ where: { leadId: leadA.id } });

    await expect(
      asUser(userB.id, async (tx) => {
        await tx.callLog.create({
          data: {
            orgId: orgA.id,
            leadId: leadA.id,
            direction: "outbound",
            fromNumber: "+910000000001",
            toNumber: "+910000000002",
            initiatedBy: userB.id,
          },
        });
        await tx.leadActivity.create({
          data: { orgId: orgA.id, leadId: leadA.id, type: "call", body: "Should never land" },
        });
      }),
    ).rejects.toThrow(/row-level security/);

    const activityCountAfter = await prisma.leadActivity.count({ where: { leadId: leadA.id } });
    expect(activityCountAfter).toBe(activityCountBefore);
  });
});

// Issue #22 — public website lead-capture form. This is the first write
// path an unauthenticated caller has anywhere in the app, so it gets its
// own describe block covering exactly the guarantees CLAUDE.md requires:
// zero rows / a clean rejection on a bad token, never another org's data,
// and INSERT-only (no SELECT/UPDATE/DELETE), all via RLS itself rather than
// app-level trust. See prisma/migrations/20260822080000_website_lead_form_token
// and src/lib/website-lead.server.ts.
describe("public website lead capture (form token)", () => {
  it("a valid form token can create a contact + lead in its own org", async () => {
    // createMany, not create() — Postgres RLS requires a RETURNING clause's
    // row to also pass the table's SELECT policy, and anon deliberately has
    // none (see the "INSERT only" test below and the migration). create()
    // always emits RETURNING, so it would fail here even for a fully valid
    // submission; this is exactly the shape src/lib/website-lead.server.ts
    // uses for the same reason.
    const websiteContactId = randomUUID();
    const websiteLeadId = randomUUID();

    await asAnonWithFormToken(orgAFormToken, (tx) =>
      tx.contact.createMany({
        data: [{ id: websiteContactId, orgId: orgA.id, fullName: "Website Lead" }],
      }),
    );
    await asAnonWithFormToken(orgAFormToken, (tx) =>
      tx.lead.createMany({
        data: [
          { id: websiteLeadId, orgId: orgA.id, contactId: websiteContactId, source: "Website" },
        ],
      }),
    );

    // Verify what actually landed using the org owner's own authenticated
    // view — not the anon connection, which (correctly) can't read it back.
    const contact = await asUser(userA.id, (tx) =>
      tx.contact.findUniqueOrThrow({ where: { id: websiteContactId } }),
    );
    expect(contact.orgId).toBe(orgA.id);

    const lead = await asUser(userA.id, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: websiteLeadId } }),
    );
    expect(lead.orgId).toBe(orgA.id);
    expect(lead.contactId).toBe(websiteContactId);
  });

  it("an unknown token creates nothing — rejected, not silently attributed anywhere", async () => {
    // A well-formed UUID that matches no organization's public_form_token.
    const unknownToken = randomUUID();
    await expect(
      asAnonWithFormToken(unknownToken, (tx) =>
        tx.contact.create({ data: { orgId: orgA.id, fullName: "Should never exist" } }),
      ),
    ).rejects.toThrow(/row-level security/);

    const seenByOwner = await asUser(userA.id, (tx) =>
      tx.contact.findMany({ where: { fullName: "Should never exist" } }),
    );
    expect(seenByOwner).toHaveLength(0);
  });

  it("a malformed (non-UUID) token is rejected the same way as an unknown one — no leak", async () => {
    // Exercises app.org_id_for_form_token()'s regex guard directly (Zod
    // would normally reject this before it ever reaches Postgres — this
    // proves the DB-side guard holds independently, not just app-level
    // validation).
    await expect(
      asAnonWithFormToken("not-a-uuid-at-all", (tx) =>
        tx.contact.create({ data: { orgId: orgA.id, fullName: "Malformed token attempt" } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("org A's token can never create data attributed to org B", async () => {
    // Holding a real, valid token only authorizes the ONE org it belongs
    // to — this is the org-pinning guarantee for the anon path, same
    // property the authenticated org-pinning regression test above checks.
    await expect(
      asAnonWithFormToken(orgAFormToken, (tx) =>
        tx.contact.create({ data: { orgId: orgB.id, fullName: "Cross-org attempt" } }),
      ),
    ).rejects.toThrow(/row-level security/);

    const seenByOrgBOwner = await asUser(userB.id, (tx) =>
      tx.contact.findMany({ where: { fullName: "Cross-org attempt" } }),
    );
    expect(seenByOrgBOwner).toHaveLength(0);
  });

  it("org B's token cannot be used to insert into org A either (not just the reverse)", async () => {
    await expect(
      asAnonWithFormToken(orgBFormToken, (tx) =>
        tx.contact.create({ data: { orgId: orgA.id, fullName: "Wrong direction attempt" } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a valid form token grants INSERT only — never SELECT, UPDATE, or DELETE", async () => {
    const seen = await asAnonWithFormToken(orgAFormToken, (tx) =>
      tx.contact.findMany({ where: { orgId: orgA.id } }),
    );
    expect(seen).toHaveLength(0);

    const updated = await asAnonWithFormToken(orgAFormToken, (tx) =>
      tx.contact.updateMany({ where: { orgId: orgA.id }, data: { fullName: "Hijacked" } }),
    );
    expect(updated.count).toBe(0);

    const deleted = await asAnonWithFormToken(orgAFormToken, (tx) =>
      tx.contact.deleteMany({ where: { orgId: orgA.id } }),
    );
    expect(deleted.count).toBe(0);

    // Same for leads.
    const seenLeads = await asAnonWithFormToken(orgAFormToken, (tx) =>
      tx.lead.findMany({ where: { orgId: orgA.id } }),
    );
    expect(seenLeads).toHaveLength(0);
  });

  it("plain anon (no form token set at all) still cannot create a contact or lead", async () => {
    // asAnon() never sets request.form_token, so current_setting(..., true)
    // returns NULL — same rejection path as an unknown token.
    await expect(
      asAnon((tx) => tx.contact.create({ data: { orgId: orgA.id, fullName: "No token at all" } })),
    ).rejects.toThrow(/row-level security/);
  });
});

// Regression tests for 20260822140000_whatsapp_core and
// src/lib/whatsapp.server.ts's sendWhatsAppMessage — issue #31. Templates
// are admin-gated (mirrors unit_price_history's admin-only INSERT/UPDATE/
// DELETE, and "org admins can delete contacts" from 20260818230000_
// contacts_dedup) because real WhatsApp Business templates need platform
// approval; messages are open to any org member (mirrors lead_activities/
// call_logs — a shared team inbox). requireUserId()/requirePrimaryOrgId()
// need a real request context this test file doesn't have, so — same
// precedent as the call-log/unit-price tests above — the atomicity test
// replicates sendWhatsAppMessage's exact tx body via the asUser helper
// rather than calling the server function directly.
describe("whatsapp template and message isolation", () => {
  it("isolates whatsapp templates by org", async () => {
    await asUser(userA.id, (tx) =>
      tx.whatsAppTemplate.create({
        data: { orgId: orgA.id, name: "Welcome A", body: "Hi from org A" },
      }),
    );
    await asUser(userB.id, (tx) =>
      tx.whatsAppTemplate.create({
        data: { orgId: orgB.id, name: "Welcome B", body: "Hi from org B" },
      }),
    );

    const seenByB = await asUser(userB.id, (tx) => tx.whatsAppTemplate.findMany());
    expect(seenByB.every((t) => t.orgId === orgB.id)).toBe(true);
    expect(seenByB.map((t) => t.name)).not.toContain("Welcome A");
  });

  it("an org admin CAN create a whatsapp template", async () => {
    // userA2 is 'admin' in orgA — not owner, confirming plain admin (not
    // just owner) is enough, same as app.is_org_admin's intent elsewhere.
    const created = await asUser(userA2.id, (tx) =>
      tx.whatsAppTemplate.create({
        data: { orgId: orgA.id, name: "Follow-up", body: "Just checking in", category: "utility" },
      }),
    );
    expect(created.orgId).toBe(orgA.id);
  });

  it("a non-admin CANNOT create a whatsapp template, even in their own org", async () => {
    // agentX is a plain agent in orgA.
    await expect(
      asUser(agentX.id, (tx) =>
        tx.whatsAppTemplate.create({
          data: { orgId: orgA.id, name: "Not allowed", body: "Should be rejected" },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a non-admin CANNOT update or delete a whatsapp template, even in their own org", async () => {
    const template = await prisma.whatsAppTemplate.create({
      data: { orgId: orgA.id, name: "Editable only by admin", body: "Original body" },
    });

    const updateResult = await asUser(agentX.id, (tx) =>
      tx.whatsAppTemplate.updateMany({
        where: { id: template.id },
        data: { body: "Hijacked body" },
      }),
    );
    expect(updateResult.count).toBe(0);

    const deleteResult = await asUser(agentX.id, (tx) =>
      tx.whatsAppTemplate.deleteMany({ where: { id: template.id } }),
    );
    expect(deleteResult.count).toBe(0);

    const stillThere = await prisma.whatsAppTemplate.findUniqueOrThrow({ where: { id: template.id } });
    expect(stillThere.body).toBe("Original body");
  });

  it("an org admin CAN update and delete a whatsapp template in their own org", async () => {
    const template = await prisma.whatsAppTemplate.create({
      data: { orgId: orgA.id, name: "Admin managed", body: "Original" },
    });

    const updated = await asUser(userA2.id, (tx) =>
      tx.whatsAppTemplate.update({ where: { id: template.id }, data: { body: "Updated by admin" } }),
    );
    expect(updated.body).toBe("Updated by admin");

    const deleted = await asUser(userA2.id, (tx) =>
      tx.whatsAppTemplate.deleteMany({ where: { id: template.id } }),
    );
    expect(deleted.count).toBe(1);
  });

  it("an admin CANNOT write a whatsapp template belonging to another org", async () => {
    // userA2 is admin in orgA only.
    await expect(
      asUser(userA2.id, (tx) =>
        tx.whatsAppTemplate.create({
          data: { orgId: orgB.id, name: "Cross-org attempt", body: "Should be rejected" },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("isolates whatsapp messages by org", async () => {
    await asUser(userA.id, (tx) =>
      tx.whatsAppMessage.create({
        data: {
          orgId: orgA.id,
          leadId: leadA.id,
          direction: "outbound",
          fromNumber: "+910000000010",
          toNumber: "+910000000011",
          body: "Hello from org A",
          status: "sent",
        },
      }),
    );
    await asUser(userB.id, (tx) =>
      tx.whatsAppMessage.create({
        data: {
          orgId: orgB.id,
          leadId: leadB.id,
          direction: "outbound",
          fromNumber: "+910000000012",
          toNumber: "+910000000013",
          body: "Hello from org B",
          status: "sent",
        },
      }),
    );

    const seenByB = await asUser(userB.id, (tx) => tx.whatsAppMessage.findMany());
    expect(seenByB.every((m) => m.orgId === orgB.id)).toBe(true);
    expect(seenByB.map((m) => m.leadId)).not.toContain(leadA.id);
  });

  it("any org member (not just admins) can view and send whatsapp messages", async () => {
    // agentX is a plain agent in orgA, not admin/owner — messages are open,
    // unlike templates.
    const created = await asUser(agentX.id, (tx) =>
      tx.whatsAppMessage.create({
        data: {
          orgId: orgA.id,
          leadId: leadA.id,
          direction: "outbound",
          fromNumber: "+910000000014",
          toNumber: "+910000000015",
          body: "Sent by a plain agent",
          status: "sent",
        },
      }),
    );
    expect(created.orgId).toBe(orgA.id);

    const seenByAgent = await asUser(agentX.id, (tx) =>
      tx.whatsAppMessage.findMany({ where: { leadId: leadA.id } }),
    );
    expect(seenByAgent.length).toBeGreaterThan(0);
    expect(seenByAgent.every((m) => m.orgId === orgA.id)).toBe(true);
  });

  it("a user from a different org cannot create a whatsapp message in another org's lead", async () => {
    await expect(
      asUser(userB.id, (tx) =>
        tx.whatsAppMessage.create({
          data: {
            orgId: orgA.id,
            leadId: leadA.id,
            direction: "outbound",
            fromNumber: "+910000000016",
            toNumber: "+910000000017",
            body: "Should be rejected",
            status: "sent",
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("sendWhatsAppMessage creates the WhatsAppMessage and LeadActivity atomically when leadId is set", async () => {
    const result = await asUser(userA.id, async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadA.id } });
      const providerMessageId = "mock-test-whatsapp";
      const toNumber = "+919999999999";
      const body = "Hi, following up on your enquiry";

      const message = await tx.whatsAppMessage.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          direction: "outbound",
          fromNumber: "org-whatsapp-number",
          toNumber,
          body,
          status: "sent",
        },
      });

      const activity = await tx.leadActivity.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "whatsapp",
          body: `WhatsApp sent to ${toNumber} (provider id ${providerMessageId}): ${body}`,
          createdBy: userA.id,
        },
      });

      return { message, activity };
    });

    expect(result.message.leadId).toBe(leadA.id);
    expect(result.message.status).toBe("sent");
    expect(result.activity.leadId).toBe(leadA.id);
    expect(result.activity.type).toBe("whatsapp");
    expect(result.activity.body).toContain("mock-test-whatsapp");

    const storedMessage = await prisma.whatsAppMessage.findUniqueOrThrow({
      where: { id: result.message.id },
    });
    const storedActivity = await prisma.leadActivity.findUniqueOrThrow({
      where: { id: result.activity.id },
    });
    expect(storedMessage.leadId).toBe(leadA.id);
    expect(storedActivity.leadId).toBe(leadA.id);
  });

  it("a rejected whatsapp message write rolls back the whole transaction (no orphaned activity)", async () => {
    // userB has no membership/visibility into leadA (org A) — the
    // WhatsAppMessage insert's WITH CHECK fails, and since both writes
    // share one transaction, no LeadActivity should land either.
    const activityCountBefore = await prisma.leadActivity.count({ where: { leadId: leadA.id } });

    await expect(
      asUser(userB.id, async (tx) => {
        await tx.whatsAppMessage.create({
          data: {
            orgId: orgA.id,
            leadId: leadA.id,
            direction: "outbound",
            fromNumber: "org-whatsapp-number",
            toNumber: "+910000000018",
            body: "Should never land",
            status: "sent",
          },
        });
        await tx.leadActivity.create({
          data: { orgId: orgA.id, leadId: leadA.id, type: "whatsapp", body: "Should never land" },
        });
      }),
    ).rejects.toThrow(/row-level security/);

    const activityCountAfter = await prisma.leadActivity.count({ where: { leadId: leadA.id } });
    expect(activityCountAfter).toBe(activityCountBefore);
  });
});
