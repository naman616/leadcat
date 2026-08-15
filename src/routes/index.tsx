import { createFileRoute } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlarmClock,
  Briefcase,
  Clock,
  MapPin,
  Phone,
  Plus,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import {
  activityTiles,
  dashboardStats,
  funnel,
  leadSources,
  leadTrend,
} from "@/data/crm";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sales Dashboard — Estatly Real Estate CRM" },
      {
        name: "description",
        content:
          "Track leads, source performance, site visits and bookings across every real estate project from one dashboard.",
      },
      { property: "og:title", content: "Sales Dashboard — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Real-time lead, source and conversion analytics for real estate sales teams.",
      },
    ],
  }),
  component: Dashboard,
});

const tileIcons = {
  plus: Plus,
  clock: Clock,
  phone: Phone,
  briefcase: Briefcase,
  map: MapPin,
  alarm: AlarmClock,
  sparkles: Sparkles,
};

function Dashboard() {
  const maxFunnel = funnel[0]!.value;

  return (
    <AppShell title="Dashboard">
      <div className="space-y-5">
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-[var(--shadow-card)] sm:grid-cols-4 xl:grid-cols-8">
          {dashboardStats.map((s) => (
            <div key={s.label} className="bg-card px-4 py-4">
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-bold tracking-tight">{s.value}</p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {activityTiles.map((t) => {
            const Icon = tileIcons[t.icon];
            return (
              <div
                key={t.label}
                className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-[var(--shadow-card)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-muted-foreground">{t.label}</p>
                  <Icon className="size-4 shrink-0 text-primary" />
                </div>
                <p className="mt-3 text-2xl font-bold">{t.value}</p>
              </div>
            );
          })}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Leads From Source <span className="text-muted-foreground">(12,266)</span>
            </h2>
            <span className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Till date
            </span>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {Object.entries(leadSources).map(([group, items]) => (
              <div key={group}>
                <p className="mb-2 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                <ul className="space-y-2">
                  {items.map((s) => (
                    <li
                      key={s.name}
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-transform hover:translate-x-0.5"
                      style={{ backgroundColor: `color-mix(in oklab, ${s.tint} 12%, white)` }}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: s.tint }}
                        />
                        {s.name}
                      </span>
                      <span className="font-semibold tabular-nums">{s.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Leads Received</h2>
              <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <TrendingUp className="size-3.5" /> Till date by week
              </span>
            </div>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={leadTrend} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    {(
                      [
                        ["fb", "var(--chart-2)"],
                        ["gg", "var(--chart-3)"],
                        ["pt", "var(--chart-1)"],
                        ["wi", "var(--chart-5)"],
                      ] as const
                    ).map(([id, color]) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="week"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      fontSize: 12,
                      boxShadow: "var(--shadow-card)",
                    }}
                  />
                  <Area type="monotone" dataKey="facebook" stroke="var(--chart-2)" fill="url(#fb)" strokeWidth={2} />
                  <Area type="monotone" dataKey="google" stroke="var(--chart-3)" fill="url(#gg)" strokeWidth={2} />
                  <Area type="monotone" dataKey="portals" stroke="var(--chart-1)" fill="url(#pt)" strokeWidth={2} />
                  <Area type="monotone" dataKey="walkin" stroke="var(--chart-5)" fill="url(#wi)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h2 className="mb-4 text-sm font-semibold">Conversion Funnel</h2>
            <ul className="space-y-3">
              {funnel.map((f) => (
                <li key={f.stage}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{f.stage}</span>
                    <span className="font-semibold tabular-nums text-muted-foreground">
                      {f.value.toLocaleString()}
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
              <p className="mt-1 text-2xl font-bold text-success">0.60%</p>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
