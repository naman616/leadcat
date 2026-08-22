import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withAnonFormContext } from "./db.server";

// "" is what an empty HTML form field submits as — treat it the same as
// "not provided" rather than a validation error, since this is fed by
// arbitrary website JS, not our own UI.
const emptyToNull = (v: unknown) => (v === "" ? null : v);

/**
 * Public website lead-capture form (issue #22). No requireUserId() here —
 * by design there's no authenticated caller. Org context comes entirely
 * from formToken via withAnonFormContext / app.org_id_for_form_token(); see
 * prisma/migrations/20260822080000_website_lead_form_token for why that's a
 * separate token rather than organizations.id/slug.
 *
 * SECURITY-SENSITIVE — this is the first endpoint in the app writable by a
 * fully unauthenticated caller. Requires human review before merge (see
 * CLAUDE.md's Review gates).
 */
const submitWebsiteLeadSchema = z
  .object({
    formToken: z.string().uuid(),
    fullName: z.string().trim().min(1, "Full name is required"),
    phone: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
    email: z.preprocess(
      emptyToNull,
      z.string().trim().toLowerCase().email("Invalid email").nullable().optional(),
    ),
    // Attribution — mirrors the nullable columns already on Lead.
    utmSource: z.string().trim().optional(),
    utmMedium: z.string().trim().optional(),
    utmCampaign: z.string().trim().optional(),
    utmContent: z.string().trim().optional(),
    utmTerm: z.string().trim().optional(),
    clickId: z.string().trim().optional(),
  })
  .refine((data) => Boolean(data.phone) || Boolean(data.email), {
    message: "A phone number or email address is required",
    path: ["phone"],
  });

export const submitWebsiteLead = createServerFn({ method: "POST" })
  .validator(submitWebsiteLeadSchema)
  .handler(async ({ data }) => {
    return withAnonFormContext(data.formToken, async (tx) => {
      // SECURITY DEFINER helper, bypasses RLS internally to read
      // organizations — anon has no SELECT access to that table otherwise
      // (see the migration). Returns NULL for any token that doesn't match
      // an org, with no distinction between "malformed" and "well-formed
      // but unknown" — never leak which case a rejected submission hit.
      const [row] = await tx.$queryRaw<{ id: string | null }[]>`
        SELECT app.org_id_for_form_token() AS id
      `;
      const orgId = row?.id;

      if (!orgId) {
        throw new Error("This form link is invalid or no longer active.");
      }

      // IDs generated here, not left to the column default, and inserted
      // via createMany rather than create(). Postgres RLS requires a
      // RETURNING clause's row to *also* pass the table's SELECT policy —
      // not just the INSERT policy's WITH CHECK — and anon deliberately has
      // no SELECT policy at all (see the migration). Prisma's create()
      // always does INSERT ... RETURNING, so it would fail RLS here even
      // for a fully valid submission; createMany doesn't need rows back,
      // so it never emits RETURNING, which is exactly the "INSERT-only"
      // shape this endpoint requires.
      const contactId = randomUUID();
      const leadId = randomUUID();

      await tx.contact.createMany({
        data: [
          {
            id: contactId,
            orgId,
            fullName: data.fullName,
            phone: data.phone ?? null,
            email: data.email ?? null,
          },
        ],
      });

      // No leadActivity entry here on purpose — lead_activities has no anon
      // INSERT policy (out of scope: this task only adds one to
      // contacts/leads), so anon genuinely cannot write one.
      await tx.lead.createMany({
        data: [
          {
            id: leadId,
            orgId,
            contactId,
            source: "Website",
            utmSource: data.utmSource ?? null,
            utmMedium: data.utmMedium ?? null,
            utmCampaign: data.utmCampaign ?? null,
            utmContent: data.utmContent ?? null,
            utmTerm: data.utmTerm ?? null,
            clickId: data.clickId ?? null,
            capturedAt: new Date(),
          },
        ],
      });

      return { leadId };
    });
  });
