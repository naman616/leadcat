import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";

const setMetaPageCredentialsSchema = z.object({
  metaPageId: z.string().min(1),
  metaPageAccessToken: z.string().min(1),
});

/**
 * Admin-only — RLS gates this via org_meta_credentials' write policies
 * (app.is_org_admin), same shape as createTemplate in whatsapp.server.ts.
 * No app-level role check needed; a non-admin's upsert is simply rejected
 * by Postgres. No UI yet (issue #24) — callable directly until an admin
 * settings screen exists.
 *
 * ponytail: no page-ownership verification. metaPageId is globally
 * unique and first-come-first-served — nothing here checks the calling
 * org actually controls the Facebook Page being registered, so an org
 * admin could register another org's real (public) Page ID first and
 * misattribute their real leads. Upgrade path: once a real Meta Graph
 * API access token exists, verify via GET /{page-id}?access_token=...
 * before accepting a registration. See docs/specs/07-meta-lead-ads-webhook.md
 * ("Known limitation") — this must not be enabled for more than one org
 * on a shared deployment until that check exists.
 */
export const setMetaPageCredentials = createServerFn({ method: "POST" })
  .validator(setMetaPageCredentialsSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.orgMetaCredential.upsert({
        where: { orgId },
        create: {
          orgId,
          metaPageId: data.metaPageId,
          metaPageAccessToken: data.metaPageAccessToken,
        },
        update: {
          metaPageId: data.metaPageId,
          metaPageAccessToken: data.metaPageAccessToken,
        },
      }),
    );
  });
