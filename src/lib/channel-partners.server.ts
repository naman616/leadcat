import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";

// Coerces a string or number into a validated 0-100 percentage. Accepting
// both matches how a form field and a programmatic caller would each
// naturally send this value.
const percentSchema = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .pipe(z.number().min(0).max(100))
  .optional();

const createChannelPartnerSchema = z.object({
  name: z.string().min(1),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  commissionPercent: percentSchema,
});

export const createChannelPartner = createServerFn({ method: "POST" })
  .validator(createChannelPartnerSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.channelPartner.create({
        data: {
          orgId,
          name: data.name,
          contactPhone: data.contactPhone ?? null,
          contactEmail: data.contactEmail ?? null,
          commissionPercent: data.commissionPercent ?? null,
        },
      }),
    );
  });

export const listChannelPartners = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, (tx) =>
    tx.channelPartner.findMany({ orderBy: { createdAt: "desc" } }),
  );
});
