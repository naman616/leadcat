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
