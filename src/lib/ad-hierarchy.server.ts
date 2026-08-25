import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { AD_PLATFORM_VALUES } from "./ad-hierarchy-enums";

/**
 * Manual admin CRUD for the ad hierarchy (issue #25, Phase 3):
 * ad_accounts -> campaigns -> ad_sets -> ads. Schema + this file are the
 * whole slice — see docs/specs/05-ad-attribution.md for what's deferred
 * (real Meta/Google sync, UTM capture script).
 *
 * Every create/update/delete here is RLS-gated to org admins (see the
 * migration's "org admins can create/update/delete ..." policies) — a
 * non-admin's write is rejected by Postgres itself, not by this app code.
 * List+create at every level, matching how src/lib/inventory.server.ts and
 * inventory-media.server.ts split responsibilities; delete is only exposed
 * on the leaf (Ad) level, per the ticket's own scoping note — admins
 * removing a mis-typed account/campaign/ad-set can just leave the stray row
 * (harmless, org-scoped, no Lead FK points at it) or this can grow
 * update/delete on the other levels later if that turns out to matter.
 */

export const listAdAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, (tx) => tx.adAccount.findMany({ orderBy: { createdAt: "desc" } }));
});

const createAdAccountSchema = z.object({
  platform: z.enum(AD_PLATFORM_VALUES),
  externalAccountId: z.string().min(1),
  name: z.string().min(1),
});

export const createAdAccount = createServerFn({ method: "POST" })
  .validator(createAdAccountSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.adAccount.create({
        data: {
          orgId,
          platform: data.platform,
          externalAccountId: data.externalAccountId,
          name: data.name,
        },
      }),
    );
  });

export const listCampaigns = createServerFn({ method: "GET" })
  .validator(z.object({ adAccountId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.campaign.findMany({
        where: { adAccountId: data.adAccountId },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

const createCampaignSchema = z.object({
  adAccountId: z.string().uuid(),
  externalCampaignId: z.string().min(1),
  name: z.string().min(1),
});

export const createCampaign = createServerFn({ method: "POST" })
  .validator(createCampaignSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.campaign.create({
        data: {
          orgId,
          adAccountId: data.adAccountId,
          externalCampaignId: data.externalCampaignId,
          name: data.name,
        },
      }),
    );
  });

export const listAdSets = createServerFn({ method: "GET" })
  .validator(z.object({ campaignId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.adSet.findMany({
        where: { campaignId: data.campaignId },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

const createAdSetSchema = z.object({
  campaignId: z.string().uuid(),
  externalAdSetId: z.string().min(1),
  name: z.string().min(1),
});

export const createAdSet = createServerFn({ method: "POST" })
  .validator(createAdSetSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.adSet.create({
        data: {
          orgId,
          campaignId: data.campaignId,
          externalAdSetId: data.externalAdSetId,
          name: data.name,
        },
      }),
    );
  });

export const listAds = createServerFn({ method: "GET" })
  .validator(z.object({ adSetId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.ad.findMany({ where: { adSetId: data.adSetId }, orderBy: { createdAt: "desc" } }),
    );
  });

const createAdSchema = z.object({
  adSetId: z.string().uuid(),
  externalAdId: z.string().min(1),
  name: z.string().min(1),
});

export const createAd = createServerFn({ method: "POST" })
  .validator(createAdSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.ad.create({
        data: {
          orgId,
          adSetId: data.adSetId,
          externalAdId: data.externalAdId,
          name: data.name,
        },
      }),
    );
  });

export const deleteAd = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    // RLS-gated to org admins (see migration). A non-admin's delete matches
    // no row — deleteMany rather than delete so that's a clean 0-count
    // result instead of a Prisma "record not found" throw, same shape as
    // deleteProjectMedia in src/lib/inventory-media.server.ts.
    return withUserContext(userId, (tx) => tx.ad.deleteMany({ where: { id: data.id } }));
  });
