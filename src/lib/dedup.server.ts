import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";
import { groupDuplicateContacts, type DedupContact } from "./dedup";

/**
 * Detection is entirely on-demand and read-only — see
 * docs/specs/03-dedup.md for why this fetches every org contact and groups
 * in memory rather than a raw-SQL computed GROUP BY.
 */
export const findDuplicateContacts = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, async (tx) => {
    const contacts = await tx.contact.findMany({
      include: { _count: { select: { leads: true } } },
      orderBy: { createdAt: "asc" },
    });

    const dedupContacts: DedupContact[] = contacts.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      phone: c.phone,
      email: c.email,
      createdAt: c.createdAt,
      leadCount: c._count.leads,
    }));

    return groupDuplicateContacts(dedupContacts);
  });
});

const mergeContactsSchema = z.object({
  canonicalContactId: z.string().uuid(),
  duplicateContactIds: z.array(z.string().uuid()).min(1),
});

/**
 * Merges one or more duplicate contacts into a canonical one: reassigns
 * every affected lead, logs an activity note on each, then deletes the
 * duplicate contact rows. See docs/specs/03-dedup.md for the full
 * reasoning, especially why the owner/admin role check happens here
 * FIRST, before any write — a rejected merge must be a true no-op, not a
 * half-reassigned one that only fails at the final delete.
 *
 * The operating org is derived from the canonical contact's own orgId —
 * NOT from requirePrimaryOrgId(userId) — because a caller can belong to
 * more than one org (a supported case, see docs/specs/00-overview.md).
 * Using "primary org" here would check the role/log activity against the
 * wrong org whenever someone merges contacts in a non-primary org they
 * also administer. RLS still blocks unauthorized writes either way (the
 * DELETE policy on contacts checks the row's real org_id, not this app
 * code's guess), but the explicit duplicate-contact org check below is
 * defense in depth against a multi-org admin accidentally cross-linking a
 * lead from one of their orgs onto a contact in another — the same class
 * of bug the *_fix_role_escalation_and_org_pinning migration fixed for
 * leads/contacts UPDATEs, applied here to this new write path too.
 */
export const mergeContacts = createServerFn({ method: "POST" })
  .validator(mergeContactsSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    if (data.duplicateContactIds.includes(data.canonicalContactId)) {
      throw new Error("The canonical contact can't also be listed as a duplicate");
    }

    return withUserContext(userId, async (tx) => {
      const canonical = await tx.contact.findUniqueOrThrow({
        where: { id: data.canonicalContactId },
      });
      const orgId = canonical.orgId;

      const membership = await tx.orgMember.findFirst({ where: { orgId, userId } });
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        throw new Error("Only org owners and admins can merge contacts");
      }

      const duplicates = await tx.contact.findMany({
        where: { id: { in: data.duplicateContactIds } },
      });
      if (duplicates.length !== data.duplicateContactIds.length) {
        throw new Error("One or more duplicate contacts couldn't be found");
      }
      if (duplicates.some((d) => d.orgId !== orgId)) {
        throw new Error("Duplicate contacts must belong to the same org as the canonical contact");
      }

      let mergedLeads = 0;
      for (const duplicateId of data.duplicateContactIds) {
        const duplicateLeads = await tx.lead.findMany({ where: { contactId: duplicateId } });

        for (const lead of duplicateLeads) {
          await tx.lead.update({ where: { id: lead.id }, data: { contactId: canonical.id } });
          await tx.leadActivity.create({
            data: {
              orgId,
              leadId: lead.id,
              type: "system",
              body: `Contact merged into ${canonical.fullName} (duplicate removed)`,
              createdBy: userId,
            },
          });
          mergedLeads++;
        }

        await tx.contact.delete({ where: { id: duplicateId } });
      }

      return {
        canonicalContactId: canonical.id,
        mergedContacts: data.duplicateContactIds.length,
        mergedLeads,
      };
    });
  });
