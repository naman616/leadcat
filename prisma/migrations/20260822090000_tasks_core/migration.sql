-- ============================================================================
-- Phase 1 slice: tasks. RLS enabled in this same migration, same discipline
-- as every tenant table before it. See docs/specs/04-tasks.md for the
-- reasoning behind what's in vs. deferred (no recurrence, no notifications,
-- no reminders — basic CRUD plus complete/reopen only).
-- ============================================================================

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID,
    "title" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "assigned_to" UUID,
    "completed_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — "my tasks" (org + assignee) and "this lead's tasks" are the
-- two list views this slice needs.
CREATE INDEX "tasks_org_id_assigned_to_idx" ON "tasks"("org_id", "assigned_to");
CREATE INDEX "tasks_lead_id_idx" ON "tasks"("lead_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — a task can be lead-linked or general; deleting the lead
-- deletes its tasks along with it (same cascade as lead_activities).
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — unassigned tasks are allowed; if the assignee is removed,
-- the task just becomes unassigned rather than being deleted.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — created_by is NOT NULL (every task is created by a real
-- authenticated user via createTask, never system-generated), so this
-- mirrors lead_assignments_assigned_to_fkey's ON DELETE CASCADE rather than
-- lead_activities_created_by_fkey's SET NULL, which exists specifically to
-- support that table's nullable system-authored rows.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- RLS helper: can the caller manage (update / complete / reopen / reassign)
-- this task? Org admins always can; otherwise only the task's assignee or
-- its creator. Unlike app.can_manage_lead there is no "unassigned = anyone"
-- branch — an unassigned task isn't up for grabs the way an unclaimed lead
-- is, per docs/specs/04-tasks.md. SECURITY DEFINER for the same reason as
-- every other RLS helper here: avoids the calling policy recursing into
-- tasks' own RLS when this queries it.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.can_manage_task(check_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks
    WHERE id = check_task_id
      -- Org membership first, always — same reasoning as can_manage_lead:
      -- without this, a user from a different org could otherwise satisfy
      -- "assigned_to = auth.uid()" or "created_by = auth.uid()" only by
      -- coincidence of UUID equality, which can't happen, but checking org
      -- membership explicitly keeps this function correct even if the
      -- other branches are ever extended.
      AND app.is_org_member(org_id)
      AND (
        app.is_org_admin(org_id)
        OR assigned_to = auth.uid()
        OR created_by = auth.uid()
      )
  );
$$;

GRANT EXECUTE ON FUNCTION app.can_manage_task(UUID) TO authenticated, anon;


-- ============================================================================
-- Row Level Security.
-- ============================================================================

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- tasks: any org member can view or create. Updates (completing, reopening,
-- reassigning — all just column updates on this table, see
-- src/lib/tasks.server.ts) are gated by can_manage_task: org admins always,
-- otherwise only the assignee or the creator.
CREATE POLICY "org members can view tasks"
  ON public.tasks FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org members can create tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (app.is_org_member(org_id));

CREATE POLICY "assignee, creator, or admin can update a task"
  ON public.tasks FOR UPDATE
  USING (app.can_manage_task(id))
  WITH CHECK (app.is_org_member(org_id));

-- No DELETE policy — not exposed until there's a real need for it, same
-- reasoning as contacts before the dedup engine.


-- ============================================================================
-- org_id is immutable after insert, same as leads/contacts
-- (20260815143031_fix_role_escalation_and_org_pinning) — reusing that
-- migration's app.prevent_org_id_change() trigger function rather than
-- waiting for a follow-up fix, since this table starts out with a mutable
-- UPDATE policy from day one.
-- ============================================================================

DROP TRIGGER IF EXISTS tasks_prevent_org_id_change ON public.tasks;
CREATE TRIGGER tasks_prevent_org_id_change
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();
