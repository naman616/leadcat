import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";

const updateUnitPriceSchema = z.object({
  unitId: z.string().uuid(),
  price: z.string().min(1),
});

/**
 * Updates a unit's price and logs the change to unit_price_history,
 * atomically — same "write, then log it, in the same tx" shape as
 * mergeContacts in src/lib/dedup.server.ts.
 *
 * Unlike mergeContacts, there's no app-level role check here: RLS already
 * does the gating. unit_price_history's INSERT policy is admin-only
 * (app.is_org_admin(org_id) — see the *_unit_price_history migration),
 * while units' UPDATE policy is open to any org member. Both writes run in
 * one $transaction, so when a non-admin's history insert is rejected by
 * RLS, the whole transaction rolls back — the price update never sticks
 * either. That gives the same "no half-applied write" guarantee
 * mergeContacts gets from its explicit up-front role check, just enforced
 * by the database instead of application code.
 */
export const updateUnitPrice = createServerFn({ method: "POST" })
  .validator(updateUnitPriceSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const unit = await tx.unit.update({
        where: { id: data.unitId },
        data: { price: data.price },
      });

      await tx.unitPriceHistory.create({
        data: {
          orgId: unit.orgId,
          unitId: unit.id,
          price: data.price,
          changedBy: userId,
        },
      });

      return unit;
    });
  });

export const listUnitPriceHistory = createServerFn({ method: "GET" })
  .validator(z.object({ unitId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.unitPriceHistory.findMany({
        where: { unitId: data.unitId },
        orderBy: { changedAt: "desc" },
      }),
    );
  });
