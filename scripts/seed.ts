// Seeds a throwaway/local Postgres with realistic sample data: 2 orgs, a
// mixed-role user per org, contacts + leads spanning every LeadStatus, and a
// small project/tower/unit inventory tree per org.
//
// For local/dev Postgres only — see the guard below. Never against the real
// Supabase project. This script connects directly (bypassing the app's RLS
// wrapper in src/lib/db.server.ts) and inserts as the connection's own role,
// the same way prisma/migrations and scripts/apply-test-schema.ts do — it's
// bootstrapping data before any real user session exists, so there's no
// JWT/org context to run it through.
//
// Not required to be safely re-runnable against a DB that already has other
// data: all seed rows use fixed, obviously-fake slugs/emails (a "-seed"
// suffix), and a rerun just deletes anything matching those first, then
// reinserts. Run against a fresh/throwaway DB for a clean result.
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

async function main() {
  const seedUrl = process.env.SEED_DATABASE_URL;
  if (!seedUrl) {
    throw new Error("SEED_DATABASE_URL is not set.");
  }
  if (seedUrl === process.env.DATABASE_URL || seedUrl === process.env.DIRECT_URL) {
    throw new Error(
      "SEED_DATABASE_URL must not equal DATABASE_URL/DIRECT_URL — refusing to seed what looks " +
        "like the real Supabase project.",
    );
  }
  // Belt-and-suspenders: catches the case where someone points this at a
  // real Supabase project via an env var name this script doesn't already
  // know to compare against.
  try {
    if (new URL(seedUrl).hostname.endsWith("supabase.co")) {
      throw new Error("SEED_DATABASE_URL points at a supabase.co host — refusing to seed it.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("supabase.co")) {
      throw error;
    }
    // Not a parseable URL — let Prisma's own connection attempt report that.
  }

  const prisma = new PrismaClient({ datasourceUrl: seedUrl });

  try {
    const orgDefs = [
      {
        name: "Prestige Realty",
        slug: "prestige-realty-seed",
        city: "Pune",
        project: { name: "Prestige Lakeview", type: "Residential" as const },
        towers: ["Tower A", "Tower B"],
        users: [
          {
            email: "priya.owner@prestige-realty.seed",
            fullName: "Priya Sharma",
            role: "owner" as const,
          },
          {
            email: "rohit.admin@prestige-realty.seed",
            fullName: "Rohit Mehta",
            role: "admin" as const,
          },
          {
            email: "ananya.agent@prestige-realty.seed",
            fullName: "Ananya Iyer",
            role: "agent" as const,
          },
        ],
        contacts: [
          { name: "Meera Joshi", phone: "+91 98200 11111" },
          { name: "Sanjay Verma", phone: "+91 98200 22222" },
          { name: "Divya Nair", phone: "+91 98200 33333" },
          { name: "Arjun Kapoor", phone: "+91 98200 44444" },
          { name: "Neha Gupta", phone: "+91 98200 55555" },
          { name: "Ramesh Iyer", phone: "+91 98200 66666" },
        ],
      },
      {
        name: "Skyline Properties",
        slug: "skyline-properties-seed",
        city: "Bengaluru",
        project: { name: "Skyline Meadows", type: "Residential" as const },
        towers: ["Wing East", "Wing West"],
        users: [
          {
            email: "karan.owner@skyline-properties.seed",
            fullName: "Karan Malhotra",
            role: "owner" as const,
          },
          {
            email: "vikram.admin@skyline-properties.seed",
            fullName: "Vikram Nair",
            role: "admin" as const,
          },
          {
            email: "fatima.agent@skyline-properties.seed",
            fullName: "Fatima Sheikh",
            role: "agent" as const,
          },
        ],
        contacts: [
          { name: "Ashwin Rao", phone: "+91 90300 11111" },
          { name: "Kavita Desai", phone: "+91 90300 22222" },
          { name: "Imran Sheikh", phone: "+91 90300 33333" },
          { name: "Pooja Menon", phone: "+91 90300 44444" },
          { name: "Rahul Bhatia", phone: "+91 90300 55555" },
          { name: "Sunita Rao", phone: "+91 90300 66666" },
        ],
      },
    ];

    // Six contacts/leads per org, one per LeadStatus — order matches contacts above.
    const LEAD_STATUSES = [
      "New",
      "FollowUp",
      "Callback",
      "SiteVisit",
      "Booked",
      "Dropped",
    ] as const;
    // Five units per org: a spread across every UnitStatus, plus one extra
    // Available unit with no tower (towerId is nullable — plotted/villa
    // projects may have none) to exercise that.
    const UNIT_PLAN = [
      { config: "2BHK", floor: "4", status: "Available" as const, tower: 0 },
      { config: "3BHK", floor: "7", status: "Blocked" as const, tower: 0 },
      { config: "3BHK", floor: "2", status: "Booked" as const, tower: 1 },
      { config: "4BHK", floor: "10", status: "Registered" as const, tower: 1 },
      { config: "1BHK", floor: "1", status: "Available" as const, tower: null },
    ];

    const seedSlugs = orgDefs.map((o) => o.slug);
    const seedEmails = orgDefs.flatMap((o) => o.users.map((u) => u.email));

    // Clear any previous run's seed data (matched by these fixed slugs/
    // emails) before reinserting. Org delete cascades contacts/leads/
    // activities/assignments/projects/towers/units/org_members; auth.users
    // delete cascades public.users (and any leftover org_members).
    await prisma.organization.deleteMany({ where: { slug: { in: seedSlugs } } });
    await prisma.$executeRawUnsafe(
      `DELETE FROM auth.users WHERE email = ANY($1::text[])`,
      seedEmails,
    );

    for (const orgDef of orgDefs) {
      const orgId = randomUUID();
      const users = orgDef.users.map((u) => ({ ...u, id: randomUUID() }));

      // Mirrors tests/tenant-isolation.test.ts: inserting into auth.users
      // fires the on_auth_user_created trigger, which creates the matching
      // public.users row (id/email/full_name) — no direct public.users
      // insert needed.
      await prisma.$executeRawUnsafe(
        `INSERT INTO auth.users (id, email, raw_user_meta_data)
         SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::jsonb[])`,
        users.map((u) => u.id),
        users.map((u) => u.email),
        users.map((u) => JSON.stringify({ full_name: u.fullName })),
      );

      await prisma.organization.create({
        data: { id: orgId, name: orgDef.name, slug: orgDef.slug },
      });

      await prisma.orgMember.createMany({
        data: users.map((u) => ({ orgId, userId: u.id, role: u.role })),
      });

      const contacts = orgDef.contacts.map((c) => ({
        id: randomUUID(),
        orgId,
        fullName: c.name,
        phone: c.phone,
        city: orgDef.city,
      }));
      await prisma.contact.createMany({ data: contacts });

      await prisma.lead.createMany({
        data: contacts.map((contact, i) => ({
          id: randomUUID(),
          orgId,
          contactId: contact.id,
          status: LEAD_STATUSES[i],
          // Leave the "New" lead unclaimed, like a fresh inbound enquiry;
          // round-robin the rest across the org's users.
          assignedTo: i === 0 ? null : users[i % users.length].id,
          source: "Website",
          project: orgDef.project.name,
          city: orgDef.city,
          requirement: "3BHK",
        })),
      });

      const projectId = randomUUID();
      await prisma.project.create({
        data: {
          id: projectId,
          orgId,
          name: orgDef.project.name,
          city: orgDef.city,
          type: orgDef.project.type,
          startingPrice: "₹85L onwards",
          unitConfigSummary: "1, 2, 3 & 4 BHK",
        },
      });

      const towers = orgDef.towers.map((name) => ({ id: randomUUID(), name }));
      await prisma.tower.createMany({
        data: towers.map((t) => ({ id: t.id, orgId, projectId, name: t.name })),
      });

      await prisma.unit.createMany({
        data: UNIT_PLAN.map((u, i) => ({
          id: randomUUID(),
          orgId,
          projectId,
          towerId: u.tower === null ? null : towers[u.tower].id,
          unitNumber: `${u.floor}0${i + 1}`,
          configuration: u.config,
          floor: u.floor,
          area: u.config === "1BHK" ? "620 sqft" : u.config === "2BHK" ? "980 sqft" : "1450 sqft",
          status: u.status,
        })),
      });

      console.log(
        `Seeded ${orgDef.name}: ${users.length} users, ${contacts.length} contacts/leads, ` +
          `1 project, ${towers.length} towers, ${UNIT_PLAN.length} units.`,
      );
    }

    console.log("Seed complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
