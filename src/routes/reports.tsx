import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { agentReports } from "@/data/crm";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Activity Report — Estatly Real Estate CRM" },
      {
        name: "description",
        content:
          "Per-agent activity reporting: calls, WhatsApp, emails, status edits and notes across your sales team.",
      },
      { property: "og:title", content: "Activity Report — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Measure real estate sales-team productivity with daily activity reporting.",
      },
    ],
  }),
  component: ReportsPage,
});

const filters = ["All", "Active", "Inactive"] as const;

function ReportsPage() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      agentReports.filter(
        (r) =>
          (filter === "All" || (filter === "Active" ? r.active : !r.active)) &&
          r.user.toLowerCase().includes(query.toLowerCase()),
      ),
    [filter, query],
  );

  const totals = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      whatsapp: acc.whatsapp + r.whatsapp,
      statusEdits: acc.statusEdits + r.statusEdits,
      notes: acc.notes + r.notes,
    }),
    { calls: 0, whatsapp: 0, statusEdits: 0, notes: 0 },
  );

  return (
    <AppShell
      title="Activity Report"
      actions={
        <button
          onClick={() => toast.success("Tracker exported")}
          className="inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent"
        >
          <Download className="size-4" /> Export Tracker
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Total Calls", totals.calls],
            ["WhatsApp Sent", totals.whatsapp],
            ["Status Edits", totals.statusEdits],
            ["Notes Added", totals.notes],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1.5">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="border-b border-border p-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by user"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead>
                <tr className="bg-table-head text-table-head-foreground">
                  {["User Name", "Working Hours", "Calls", "WhatsApp", "Email", "SMS", "Status Edits", "Form Edits", "Notes"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user} className="border-b border-border transition-colors last:border-0 hover:bg-secondary/70">
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-2 font-semibold">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            r.active ? "bg-success" : "bg-muted-foreground/40",
                          )}
                        />
                        {r.user}
                      </p>
                      <p className="pl-4 text-xs text-muted-foreground">{r.active ? "Active" : "Inactive"}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{r.workingHours}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold tabular-nums">{r.calls || "--"}</p>
                      <p className="text-xs text-muted-foreground">unique: {r.uniqueCalls || "--"}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{r.whatsapp || "--"}</td>
                    <td className="px-4 py-3 tabular-nums">{r.email || "--"}</td>
                    <td className="px-4 py-3 tabular-nums">{r.sms || "--"}</td>
                    <td className="px-4 py-3 tabular-nums">{r.statusEdits || "--"}</td>
                    <td className="px-4 py-3 tabular-nums">{r.formEdits || "--"}</td>
                    <td className="px-4 py-3 tabular-nums">{r.notes || "--"}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-16 text-center text-muted-foreground">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            Showing {rows.length} of {agentReports.length} entries
          </div>
        </div>
      </div>
    </AppShell>
  );
}
