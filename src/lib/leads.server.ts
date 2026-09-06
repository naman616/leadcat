import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withUserContext, type Tx } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { LEAD_STATUS_VALUES } from "./lead-status";
import { stringifyCsv } from "./csv";

const assigneeSelect = { id: true, fullName: true, email: true } as const;
const contactSelect = { id: true, fullName: true, phone: true, email: true, city: true } as const;

// Shared by listLeads and exportLeadsCsv (issue #42) so the CSV export
// filters exactly the same rows the list view would show — one where-clause,
// not two copies that could drift.
const leadFilterSchema = z.object({
  status: z.enum(LEAD_STATUS_VALUES).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().optional(),
});

function buildLeadWhere(data?: z.infer<typeof leadFilterSchema>): Prisma.LeadWhereInput {
  return {
    ...(data?.status ? { status: data.status } : {}),
    ...(data?.assignedTo ? { assignedTo: data.assignedTo } : {}),
    ...(data?.search
      ? {
          OR: [
            { contact: { fullName: { contains: data.search, mode: "insensitive" } } },
            { contact: { phone: { contains: data.search } } },
            { project: { contains: data.search, mode: "insensitive" } },
            { source: { contains: data.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

/**
 * assignedTo is only FK-constrained to users(id) — any user in the system,
 * not org-scoped — so without this, a caller could set it to a real user
 * id outside the org (no data leak, since that user's row is still
 * invisible to teammates who don't share an org with them, but it's a
 * silent data-integrity gap rather than a rejected input).
 */
export async function requireOrgMember(tx: Tx, orgId: string, targetUserId: string) {
  const membership = await tx.orgMember.findFirst({ where: { orgId, userId: targetUserId } });
  if (!membership) {
    throw new Error("That user isn't a member of this organization");
  }
}

export const listLeads = createServerFn({ method: "GET" })
  .validator(leadFilterSchema.optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const where = buildLeadWhere(data);

    return withUserContext(userId, (tx) =>
      tx.lead.findMany({
        where,
        include: { contact: { select: contactSelect }, assignee: { select: assigneeSelect } },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

const LEAD_EXPORT_HEADER = [
  "Full Name",
  "Phone",
  "Email",
  "City",
  "Status",
  "Sub Status",
  "Source",
  "Sub Source",
  "Project",
  "Budget",
  "Requirement",
  "Assigned To",
  "Created At",
];

/**
 * CSV export of the leads list (issue #42, scoped to leads since that's the
 * only mature, already-queryable report-shaped dataset today — the 12 fixed
 * reports in issue #39 are still unbuilt). Takes the exact same filter shape
 * as listLeads and runs the same where-clause through withUserContext, so
 * the export is RLS-scoped to the caller's org exactly like the list view.
 */
export const exportLeadsCsv = createServerFn({ method: "GET" })
  .validator(leadFilterSchema.optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const where = buildLeadWhere(data);

    const leads = await withUserContext(userId, (tx) =>
      tx.lead.findMany({
        where,
        include: { contact: { select: contactSelect }, assignee: { select: assigneeSelect } },
        orderBy: { createdAt: "desc" },
      }),
    );

    const rows = leads.map((l) => [
      l.contact.fullName,
      l.contact.phone,
      l.contact.email,
      l.contact.city,
      l.status,
      l.subStatus,
      l.source,
      l.subSource,
      l.project,
      l.budget,
      l.requirement,
      l.assignee?.fullName ?? "",
      l.createdAt.toISOString(),
    ]);

    return stringifyCsv([LEAD_EXPORT_HEADER, ...rows]);
  });

export const getLead = createServerFn({ method: "GET" })
  .validator(z.object({ leadId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.lead.findUnique({
        where: { id: data.leadId },
        include: {
          contact: { select: contactSelect },
          assignee: { select: assigneeSelect },
          activities: {
            include: { author: { select: assigneeSelect } },
            orderBy: { createdAt: "desc" },
          },
          assignments: {
            include: {
              assignee: { select: assigneeSelect },
              assignedByUser: { select: assigneeSelect },
            },
            orderBy: { assignedAt: "desc" },
          },
        },
      }),
    );
  });

const createLeadSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  source: z.string().optional(),
  subSource: z.string().optional(),
  project: z.string().optional(),
  budget: z.string().optional(),
  requirement: z.string().optional(),
  city: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
});

export const createLead = createServerFn({ method: "POST" })
  .validator(createLeadSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, async (tx) => {
      const contact = await tx.contact.create({
        data: {
          orgId,
          fullName: data.fullName,
          phone: data.phone,
          email: data.email || null,
          city: data.city ?? null,
        },
      });

      // Always created unassigned, then optionally assigned as a separate
      // step below — see the comment in reassignLead for why the order
      // matters: app.can_manage_lead's "unassigned" branch passes for any
      // org member, which is what lets a freshly-created lead be assigned
      // to any teammate regardless of who's creating it.
      let lead = await tx.lead.create({
        data: {
          orgId,
          contactId: contact.id,
          assignedTo: null,
          source: data.source ?? null,
          subSource: data.subSource ?? null,
          project: data.project ?? null,
          budget: data.budget ?? null,
          requirement: data.requirement ?? null,
          city: data.city ?? null,
        },
        include: { contact: { select: contactSelect }, assignee: { select: assigneeSelect } },
      });

      await tx.leadActivity.create({
        data: { orgId, leadId: lead.id, type: "system", body: "Lead created", createdBy: userId },
      });

      if (data.assignedTo) {
        await requireOrgMember(tx, orgId, data.assignedTo);
        await tx.leadAssignment.create({
          data: { orgId, leadId: lead.id, assignedTo: data.assignedTo, assignedBy: userId },
        });
        lead = await tx.lead.update({
          where: { id: lead.id },
          data: { assignedTo: data.assignedTo },
          include: { contact: { select: contactSelect }, assignee: { select: assigneeSelect } },
        });
      }

      return lead;
    });
  });

const updateLeadStatusSchema = z.object({
  leadId: z.string().uuid(),
  status: z.enum(LEAD_STATUS_VALUES),
  subStatus: z.string().optional(),
});

export const updateLeadStatus = createServerFn({ method: "POST" })
  .validator(updateLeadStatusSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const lead = await tx.lead.update({
        where: { id: data.leadId },
        data: { status: data.status, subStatus: data.subStatus ?? null },
        include: { contact: { select: contactSelect }, assignee: { select: assigneeSelect } },
      });

      await tx.leadActivity.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "status_change",
          body: `Status changed to ${data.status}`,
          createdBy: userId,
        },
      });

      return lead;
    });
  });

const addLeadNoteSchema = z.object({
  leadId: z.string().uuid(),
  body: z.string().min(1),
});

export const addLeadNote = createServerFn({ method: "POST" })
  .validator(addLeadNoteSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: data.leadId } });

      return tx.leadActivity.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "note",
          body: data.body,
          createdBy: userId,
        },
        include: { author: { select: assigneeSelect } },
      });
    });
  });

const reassignLeadSchema = z.object({
  leadId: z.string().uuid(),
  assignedTo: z.string().uuid().nullable(),
});

/**
 * Reassigns (or unassigns / claims) a lead: updates leads.assigned_to and
 * records the change in lead_assignments — history, not a column, per the
 * build plan. Who's allowed to do this is enforced by app.can_manage_lead
 * in the RLS policy on both tables, not by anything checked here.
 */
export const reassignLead = createServerFn({ method: "POST" })
  .validator(reassignLeadSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      // Recording the assignment must happen BEFORE updating leads.assigned_to,
      // not after. app.can_manage_lead (the RLS check on both this insert and
      // the update below) re-queries leads live, so it needs to see the
      // lead's state as it stood before this handoff — not after — or a
      // non-admin handing a lead to a named colleague (rather than to
      // themselves or to nobody) always fails: by the time the insert's
      // check ran against the already-updated row, the caller would no
      // longer be recognized as the assignee of record. Caught by an
      // independent review; see docs/specs/01-leads.md.
      if (data.assignedTo) {
        const existing = await tx.lead.findUniqueOrThrow({ where: { id: data.leadId } });
        await requireOrgMember(tx, existing.orgId, data.assignedTo);
        await tx.leadAssignment.create({
          data: {
            orgId: existing.orgId,
            leadId: existing.id,
            assignedTo: data.assignedTo,
            assignedBy: userId,
          },
        });
      }

      const lead = await tx.lead.update({
        where: { id: data.leadId },
        data: { assignedTo: data.assignedTo },
        include: { contact: { select: contactSelect }, assignee: { select: assigneeSelect } },
      });

      await tx.leadActivity.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "system",
          body: data.assignedTo
            ? `Reassigned to ${lead.assignee?.fullName ?? "agent"}`
            : "Unassigned",
          createdBy: userId,
        },
      });

      return lead;
    });
  });

const bulkLeadRowSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  source: z.string().optional(),
  subSource: z.string().optional(),
  project: z.string().optional(),
  budget: z.string().optional(),
  requirement: z.string().optional(),
  city: z.string().optional(),
  assignedToEmail: z.string().email().optional().or(z.literal("")),
});

// Matches LEAD_IMPORT_MAX_ROWS in leads-import.ts — the client-side parser
// rejects an oversized file before it ever reaches this validator, but the
// server enforces the same cap independently since client validation is UX,
// not the security boundary.
const bulkCreateLeadsSchema = z.object({ rows: z.array(bulkLeadRowSchema).min(1).max(500) });

/**
 * Bulk import: same lead-creation shape as createLead, run once per row
 * inside a single transaction (withUserContext already wraps the whole
 * handler in one). Rows are pre-validated client-side (see
 * src/lib/leads-import.ts) so a per-row try/catch here would only be
 * guarding against input that can't reach this function through the UI —
 * the one exception is assignedToEmail, which names a *person*, not a
 * shape, and can legitimately fail to resolve (typo, ex-teammate). That
 * case is reported back instead of aborting the whole import.
 */
export const bulkCreateLeads = createServerFn({ method: "POST" })
  .validator(bulkCreateLeadsSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, async (tx) => {
      const members = await tx.orgMember.findMany({
        where: { orgId },
        include: { user: { select: { id: true, email: true } } },
      });
      const memberIdByEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.userId]));

      let created = 0;
      const unresolvedAssignees = new Set<string>();

      for (const row of data.rows) {
        const contact = await tx.contact.create({
          data: {
            orgId,
            fullName: row.fullName,
            phone: row.phone,
            email: row.email || null,
            city: row.city ?? null,
          },
        });

        const lead = await tx.lead.create({
          data: {
            orgId,
            contactId: contact.id,
            assignedTo: null,
            source: row.source ?? null,
            subSource: row.subSource ?? null,
            project: row.project ?? null,
            budget: row.budget ?? null,
            requirement: row.requirement ?? null,
            city: row.city ?? null,
          },
        });

        await tx.leadActivity.create({
          data: {
            orgId,
            leadId: lead.id,
            type: "system",
            body: "Lead created via bulk import",
            createdBy: userId,
          },
        });

        // Same ordering as createLead/reassignLead: record the assignment
        // before flipping leads.assigned_to, since app.can_manage_lead
        // re-queries leads live and needs to see the pre-handoff state.
        if (row.assignedToEmail) {
          const targetUserId = memberIdByEmail.get(row.assignedToEmail.toLowerCase());
          if (targetUserId) {
            await tx.leadAssignment.create({
              data: { orgId, leadId: lead.id, assignedTo: targetUserId, assignedBy: userId },
            });
            await tx.lead.update({ where: { id: lead.id }, data: { assignedTo: targetUserId } });
          } else {
            unresolvedAssignees.add(row.assignedToEmail);
          }
        }

        created++;
      }

      return { created, unresolvedAssignees: Array.from(unresolvedAssignees) };
    });
  });

const setNextActionSchema = z.object({
  leadId: z.string().uuid(),
  // A real ISO 8601 UTC string (client converts the datetime-local input's
  // timezone-less value using the browser's own timezone before sending —
  // see leads.tsx — so this is unambiguous regardless of the server's
  // timezone), or null to clear.
  nextActionAt: z.string().datetime().nullable(),
});

export const setNextAction = createServerFn({ method: "POST" })
  .validator(setNextActionSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    let parsed: Date | null = null;
    if (data.nextActionAt) {
      parsed = new Date(data.nextActionAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Invalid date");
      }
    }

    return withUserContext(userId, async (tx) => {
      const lead = await tx.lead.update({
        where: { id: data.leadId },
        data: { nextActionAt: parsed },
        include: { contact: { select: contactSelect }, assignee: { select: assigneeSelect } },
      });

      await tx.leadActivity.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "system",
          body: parsed ? `Follow-up scheduled for ${parsed.toLocaleString()}` : "Follow-up cleared",
          createdBy: userId,
        },
      });

      return lead;
    });
  });
