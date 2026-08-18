import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { getDashboardStats } from "@/lib/dashboard.server";
import { LEAD_STATUS_LABELS, LEAD_STATUS_TONE, type LeadStatusValue } from "@/lib/lead-status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sales Dashboard — Estatly Real Estate CRM" },
      {
        name: "description",
        content:
          "Track leads and source performance across every real estate project from one dashboard.",
      },
      { property: "og:title", content: "Sales Dashboard — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Real-time lead analytics for real estate sales teams.",
      },
    ],
  }),
  component: Dashboard,
});

const statusOrder: LeadStatusValue[] = [
  "New",
  "Callback",
  "FollowUp",
  "SiteVisit",
  "Booked",
  "Dropped",
];

function Dashboard() {
  const statsQuery = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => getDashboardStats(),
  });
  const stats = statsQuery.data;

  if (statsQuery.isLoading) {
    return (
      <AppShell title="Dashboard">
        <div className="grid place-items-center py-24 text-sm text-muted-foreground">
          Loading...
        </div>
      </AppShell>
    );
  }

  if (statsQuery.isError || !stats) {
    return (
      <AppShell title="Dashboard">
        <div className="grid place-items-center py-24 text-sm text-destructive">
          Couldn't load dashboard data.
        </div>
      </AppShell>
    );
  }

  const funnelStages = [
    { label: "Total Leads", value: stats.total },
    {
      label: "Callback / Follow Up",
      value: (stats.byStatus["Callback"] ?? 0) + (stats.byStatus["FollowUp"] ?? 0),
    },
    { label: "Site Visit", value: stats.byStatus["SiteVisit"] ?? 0 },
    { label: "Booked", value: stats.byStatus["Booked"] ?? 0 },
  ];
  const maxFunnel = Math.max(1, funnelStages[0]?.value ?? 1);
  const conversionRate =
    stats.total > 0 ? (((stats.byStatus["Booked"] ?? 0) / stats.total) * 100).toFixed(2) : "0.00";

  return (
    <AppShell title="Dashboard">
      <div className="space-y-5">
        {stats.escalatedFollowUps > 0 && (
          <Link
            to="/tasks"
            className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive transition-colors hover:bg-destructive/15"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span className="font-medium">
              {stats.escalatedFollowUps} follow-up{stats.escalatedFollowUps === 1 ? "" : "s"}{" "}
              overdue by more than 24 hours — review in Tasks
            </span>
          </Link>
        )}

        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-[var(--shadow-card)] sm:grid-cols-4 xl:grid-cols-8">
          <div className="bg-card px-4 py-4">
            <p className="text-xs font-medium text-muted-foreground">Total Leads</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{stats.total}</p>
          </div>
          <div className="bg-card px-4 py-4">
            <p className="text-xs font-medium text-muted-foreground">Unassigned</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{stats.unassigned}</p>
          </div>
          {statusOrder.map((s) => (
            <div key={s} className="bg-card px-4 py-4">
              <p className="text-xs font-medium text-muted-foreground">{LEAD_STATUS_LABELS[s]}</p>
              <p className={cn("mt-1 text-2xl font-bold tracking-tight", LEAD_STATUS_TONE[s])}>
                {stats.byStatus[s] ?? 0}
              </p>
            </div>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Leads by Source</h2>
            </div>
            {stats.bySource.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No leads yet.</p>
            ) : (
              <ul className="space-y-2">
                {stats.bySource.map((s) => (
                  <li
                    key={s.source}
                    className="flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2.5 text-sm"
                  >
                    <span className="font-medium">{s.source}</span>
                    <span className="font-semibold tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h2 className="mb-4 text-sm font-semibold">Conversion Funnel</h2>
            <ul className="space-y-3">
              {funnelStages.map((f) => (
                <li key={f.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{f.label}</span>
                    <span className="font-semibold tabular-nums text-muted-foreground">
                      {f.value}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${Math.max(4, (f.value / maxFunnel) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-xl bg-secondary p-4">
              <p className="text-xs text-muted-foreground">Lead to booking conversion</p>
              <p className="mt-1 text-2xl font-bold text-success">{conversionRate}%</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <h2 className="mb-4 text-sm font-semibold">Recent Leads</h2>
          {stats.recentLeads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No leads yet —{" "}
              <Link to="/leads" className="text-primary hover:underline">
                add your first one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {stats.recentLeads.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-3 text-sm">
                  <span className="font-medium">{l.name}</span>
                  <span className="flex items-center gap-3">
                    <span
                      className={cn("font-semibold", LEAD_STATUS_TONE[l.status as LeadStatusValue])}
                    >
                      {LEAD_STATUS_LABELS[l.status as LeadStatusValue]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(l.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
