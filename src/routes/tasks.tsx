import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  ListChecks,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/crm/AppShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  completeTask,
  createTask,
  getTasks,
  listTasks,
  reassignTask,
  reopenTask,
} from "@/lib/tasks.server";
import { listOrgMembers } from "@/lib/org-members.server";
import { LEAD_STATUS_LABELS, LEAD_STATUS_TONE, type LeadStatusValue } from "@/lib/lead-status";
import { getFollowUpBucket } from "@/lib/follow-up";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — Estatly Real Estate CRM" },
      { name: "description", content: "Follow-ups scheduled against your leads." },
      { property: "og:title", content: "Tasks — Estatly Real Estate CRM" },
      { property: "og:description", content: "Never miss a scheduled follow-up." },
    ],
  }),
  component: TasksPage,
});

type Task = Awaited<ReturnType<typeof getTasks>>[number];

function TasksPage() {
  const tasksQuery = useQuery({ queryKey: ["tasks"], queryFn: () => getTasks() });
  const tasks = tasksQuery.data ?? [];

  const buckets = useMemo(() => {
    const grouped = {
      escalated: [] as Task[],
      overdue: [] as Task[],
      today: [] as Task[],
      upcoming: [] as Task[],
    };
    for (const t of tasksQuery.data ?? []) {
      const bucket = getFollowUpBucket(t.nextActionAt);
      if (bucket === "none") continue;
      grouped[bucket].push(t);
    }
    return grouped;
  }, [tasksQuery.data]);

  return (
    <AppShell title="Tasks">
      <div className="space-y-5">
        <MyTasks />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Stat
            label="Escalated"
            value={buckets.escalated.length}
            tone="text-destructive"
            icon={AlertTriangle}
          />
          <Stat
            label="Overdue"
            value={buckets.overdue.length}
            tone="text-warning"
            icon={AlarmClock}
          />
          <Stat
            label="Due Today"
            value={buckets.today.length}
            tone="text-warning"
            icon={CalendarClock}
          />
          <Stat
            label="Upcoming"
            value={buckets.upcoming.length}
            tone="text-info"
            icon={CalendarDays}
          />
          <Stat
            label="Total Scheduled"
            value={tasks.length}
            tone="text-foreground"
            icon={ListChecks}
          />
        </div>

        {tasksQuery.isLoading && (
          <div className="grid place-items-center rounded-2xl border border-border bg-card py-24 text-sm text-muted-foreground">
            Loading tasks...
          </div>
        )}

        {!tasksQuery.isLoading && tasks.length === 0 && (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card py-24 text-center shadow-[var(--shadow-card)]">
            <span className="grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
              <ListChecks className="size-6" />
            </span>
            <h2 className="mt-4 text-base font-semibold">No follow-ups scheduled</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Open a lead and set a follow-up date from its Overview tab — it'll show up here.
            </p>
            <Link
              to="/leads"
              className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to Leads
            </Link>
          </div>
        )}

        {!tasksQuery.isLoading && tasks.length > 0 && (
          <div className="space-y-5">
            <TaskGroup title="Escalated" tone="text-destructive" tasks={buckets.escalated} />
            <TaskGroup title="Overdue" tone="text-warning" tasks={buckets.overdue} />
            <TaskGroup title="Due Today" tone="text-warning" tasks={buckets.today} />
            <TaskGroup title="Upcoming" tone="text-info" tasks={buckets.upcoming} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

type RealTask = Awaited<ReturnType<typeof listTasks>>[number];

const UNASSIGNED = "none";

function MyTasks() {
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignee, setAssignee] = useState(UNASSIGNED);

  const tasksQuery = useQuery({ queryKey: ["my-tasks"], queryFn: () => listTasks() });
  const membersQuery = useQuery({ queryKey: ["org-members"], queryFn: () => listOrgMembers() });
  const members = (membersQuery.data ?? []).map((m) => ({
    id: m.user.id,
    name: m.user.fullName ?? m.user.email,
  }));

  const onSuccess = () => void queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
  const onError = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : "Could not update task");

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      onSuccess();
      setNewOpen(false);
      toast.success("Task created");
    },
    onError,
  });
  const completeMutation = useMutation({ mutationFn: completeTask, onSuccess, onError });
  const reopenMutation = useMutation({ mutationFn: reopenTask, onSuccess, onError });
  const reassignMutation = useMutation({ mutationFn: reassignTask, onSuccess, onError });

  const tasks = tasksQuery.data ?? [];
  const open = tasks.filter((t) => !t.completedAt);
  const done = tasks.filter((t) => t.completedAt);

  const assigneeSelect = (value: string, onChange: (v: string) => void, id?: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-8 w-40" aria-label="Assignee">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const row = (t: RealTask) => (
    <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <Checkbox
        aria-label={t.completedAt ? `Reopen ${t.title}` : `Complete ${t.title}`}
        checked={!!t.completedAt}
        disabled={completeMutation.isPending || reopenMutation.isPending}
        onCheckedChange={(checked) =>
          (checked ? completeMutation : reopenMutation).mutate({ data: { taskId: t.id } })
        }
      />
      <div className="min-w-0 flex-1">
        <p className={cn("font-semibold", t.completedAt && "text-muted-foreground line-through")}>
          {t.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {t.lead ? (
            <Link to="/leads" search={{ leadId: t.lead.id }} className="hover:underline">
              {t.lead.contact.fullName}
            </Link>
          ) : (
            "No lead"
          )}
          {t.dueAt && (
            <span
              className={cn(!t.completedAt && new Date(t.dueAt) < new Date() && "text-destructive")}
            >
              {" · Due "}
              {new Date(t.dueAt).toLocaleString()}
            </span>
          )}
        </p>
      </div>
      {assigneeSelect(t.assignedTo ?? UNASSIGNED, (v) =>
        reassignMutation.mutate({
          data: { taskId: t.id, assignedTo: v === UNASSIGNED ? null : v },
        }),
      )}
    </li>
  );

  return (
    <section className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">My tasks ({open.length})</h2>
        <Button size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="size-4" /> New task
        </Button>
      </div>
      {tasksQuery.isError ? (
        <p className="px-4 py-6 text-sm text-destructive">Couldn't load tasks.</p>
      ) : open.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {tasksQuery.isLoading ? "Loading tasks..." : "Nothing to do."}
        </p>
      ) : (
        <ul className="divide-y divide-border">{open.map(row)}</ul>
      )}
      {done.length > 0 && (
        <details className="border-t border-border">
          <summary className="cursor-pointer px-4 py-3 text-sm text-muted-foreground">
            Completed ({done.length})
          </summary>
          <ul className="divide-y divide-border">{done.map(row)}</ul>
        </details>
      )}

      <Dialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o);
          if (!o) {
            setTitle("");
            setDueAt("");
            setAssignee(UNASSIGNED);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={createMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due (optional)</Label>
              <Input
                id="task-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                disabled={createMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-assignee">Assignee</Label>
              {assigneeSelect(assignee, setAssignee, "task-assignee")}
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={createMutation.isPending || !title.trim()}
              onClick={() =>
                createMutation.mutate({
                  data: {
                    title: title.trim(),
                    dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
                    assignedTo: assignee === UNASSIGNED ? undefined : assignee,
                  },
                })
              }
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: typeof ListChecks;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className={cn("size-4", tone)} />
      </div>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function TaskGroup({ title, tone, tasks }: { title: string; tone: string; tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="border-b border-border px-4 py-3">
        <h2 className={cn("text-sm font-semibold", tone)}>
          {title} ({tasks.length})
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link
              to="/leads"
              search={{ leadId: t.id }}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-secondary/70"
            >
              <div className="min-w-0">
                <p className="font-semibold">{t.contact.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {t.assignee?.fullName ?? "Unassigned"} · {t.contact.phone ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={cn("font-semibold", LEAD_STATUS_TONE[t.status as LeadStatusValue])}
                >
                  {LEAD_STATUS_LABELS[t.status as LeadStatusValue]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(t.nextActionAt!).toLocaleString()}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
