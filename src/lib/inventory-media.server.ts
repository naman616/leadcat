import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { PROJECT_MEDIA_TYPE_VALUES } from "./inventory-enums";

/**
 * Metadata-only server functions for a project's media (brochures, floor
 * plans, price sheets, RERA docs) — see docs/specs/02-inventory.md. No real
 * upload happens here: storagePath is just recorded as given, in the shape
 * a Supabase Storage object key/URL will eventually take. Wiring an actual
 * upload flow against a real bucket is a separate, later piece of work.
 */

export const listProjectMedia = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.projectMedia.findMany({
        where: { projectId: data.projectId },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

const addProjectMediaSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(PROJECT_MEDIA_TYPE_VALUES),
  fileName: z.string().min(1),
  storagePath: z.string().min(1),
});

// RLS ("org admins can upload project media") is the actual enforcement —
// a non-admin's INSERT is rejected by Postgres, not by this app code. This
// just gives that rejection a readable path through requireUserId/withUserContext.
export const addProjectMedia = createServerFn({ method: "POST" })
  .validator(addProjectMediaSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.projectMedia.create({
        data: {
          orgId,
          projectId: data.projectId,
          type: data.type,
          fileName: data.fileName,
          storagePath: data.storagePath,
          uploadedBy: userId,
        },
      }),
    );
  });

export const deleteProjectMedia = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    // RLS-gated to org admins (see migration). A non-admin's delete matches
    // no row, same "zero rows, not an error" shape as everywhere else in
    // this app — deleteMany rather than delete so that's a clean 0-count
    // result instead of a Prisma "record not found" throw.
    return withUserContext(userId, (tx) => tx.projectMedia.deleteMany({ where: { id: data.id } }));
  });
