import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CalendarClock, CalendarDays, ListChecks } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { getTasks } from "@/lib/tasks.server";
import { LEAD_STATUS_LABELS, LEAD_STATUS_TONE, type LeadStatusValue } from "@/lib/lead-status";
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

function bucketOf(task: Task): "overdue" | "today" | "upcoming" {
  const due = new Date(task.nextActionAt!);
  const now = new Date();
  if (due.getTime() < now.getTime()) return "overdue";
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  return sameDay ? "today" : "upcoming";
}

function TasksPage() {
  const tasksQuery = useQuery({ queryKey: ["tasks"], queryFn: () => getTasks() });
  const tasks = tasksQuery.data ?? [];

  const buckets = useMemo(() => {
    const grouped = { overdue: [] as Task[], today: [] as Task[], upcoming: [] as Task[] };
    for (const t of tasksQuery.data ?? []) grouped[bucketOf(t)].push(t);
    return grouped;
  }, [tasksQuery.data]);

  return (
    <AppShell title="Tasks">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Overdue"
            value={buckets.overdue.length}
            tone="text-destructive"
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
            <TaskGroup title="Overdue" tone="text-destructive" tasks={buckets.overdue} />
            <TaskGroup title="Due Today" tone="text-warning" tasks={buckets.today} />
            <TaskGroup title="Upcoming" tone="text-info" tasks={buckets.upcoming} />
          </div>
        )}
      </div>
    </AppShell>
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
