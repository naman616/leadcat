import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { requireOrgMember } from "./leads.server";

/**
 * "Tasks" in this slice are leads with a follow-up (nextActionAt) set —
 * see docs/specs/01-leads.md. Bucketing into overdue/today/upcoming happens
 * client-side from this one list rather than three separate date-ranged
 * queries; the dataset size here doesn't warrant the extra round-trips.
 *
 * NOTE: this predates the real `Task` model below (docs/specs/04-tasks.md)
 * and is a different concept — a derived, lead-only follow-up view, not a
 * row in the `tasks` table. Left as-is; `/tasks` still reads from here.
 */
export const getTasks = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, (tx) =>
    tx.lead.findMany({
      where: { nextActionAt: { not: null } },
      orderBy: { nextActionAt: "asc" },
      include: {
        contact: { select: { fullName: true, phone: true } },
        assignee: { select: { id: true, fullName: true, email: true } },
      },
    }),
  );
});

// ============================================================================
// Real Task model — docs/specs/04-tasks.md. Basic CRUD plus complete/reopen
// only, per that spec: no recurrence, no notifications, no reminders. Who
// may update/complete/reopen/reassign a task is enforced entirely by
// app.can_manage_task in the RLS policy on `tasks` (assignee, creator, or
// org admin) — nothing checked in application code beyond that.
// ============================================================================

const taskAssigneeSelect = { id: true, fullName: true, email: true } as const;
const taskLeadSelect = { id: true, contact: { select: { fullName: true } } } as const;
const taskInclude = {
  assignee: { select: taskAssigneeSelect },
  lead: { select: taskLeadSelect },
} as const;

const createTaskSchema = z.object({
  title: z.string().min(1),
  leadId: z.string().uuid().optional(),
  dueAt: z.string().datetime().optional(),
  assignedTo: z.string().uuid().optional(),
});

export const createTask = createServerFn({ method: "POST" })
  .validator(createTaskSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, async (tx) => {
      if (data.assignedTo) {
        await requireOrgMember(tx, orgId, data.assignedTo);
      }
      if (data.leadId) {
        // Confirms the lead exists (and, via RLS, belongs to this org) —
        // findUniqueOrThrow surfaces a clear "not found" instead of a task
        // silently pointing at a lead the caller can't actually see.
        await tx.lead.findUniqueOrThrow({ where: { id: data.leadId } });
      }

      return tx.task.create({
        data: {
          orgId,
          leadId: data.leadId ?? null,
          title: data.title,
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          assignedTo: data.assignedTo ?? null,
          createdBy: userId,
        },
        include: taskInclude,
      });
    });
  });

export const listTasks = createServerFn({ method: "GET" })
  .validator(z.object({ leadId: z.string().uuid().optional() }).optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.task.findMany({
        where: data?.leadId ? { leadId: data.leadId } : {},
        include: taskInclude,
        orderBy: { createdAt: "desc" },
      }),
    );
  });

const taskIdSchema = z.object({ taskId: z.string().uuid() });

export const completeTask = createServerFn({ method: "POST" })
  .validator(taskIdSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.task.update({
        where: { id: data.taskId },
        data: { completedAt: new Date() },
        include: taskInclude,
      }),
    );
  });

export const reopenTask = createServerFn({ method: "POST" })
  .validator(taskIdSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.task.update({
        where: { id: data.taskId },
        data: { completedAt: null },
        include: taskInclude,
      }),
    );
  });

const reassignTaskSchema = z.object({
  taskId: z.string().uuid(),
  assignedTo: z.string().uuid().nullable(),
});

export const reassignTask = createServerFn({ method: "POST" })
  .validator(reassignTaskSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      if (data.assignedTo) {
        const existing = await tx.task.findUniqueOrThrow({ where: { id: data.taskId } });
        await requireOrgMember(tx, existing.orgId, data.assignedTo);
      }

      return tx.task.update({
        where: { id: data.taskId },
        data: { assignedTo: data.assignedTo },
        include: taskInclude,
      });
    });
  });
