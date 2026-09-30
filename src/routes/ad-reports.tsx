import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { getAdReport } from "@/lib/ad-reports.server";
import { neutralizeFormula, stringifyCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ad-reports")({
  head: () => ({ meta: [{ title: "Ad Reports — Estatly Real Estate CRM" }] }),
  component: AdReportsPage,
});

const TABS = [
  "Leaderboard",
  "Creative",
  "Campaign ROI",
  "Funnel",
  "First vs last touch",
  "Stale ads",
] as const;
type Tab = (typeof TABS)[number];

const dash = (n: number | null, digits = 0) =>
  n === null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AdReportsPage() {
  const [tab, setTab] = useState<Tab>("Leaderboard");
  const [range, setRange] = useState(() => {
    const to = new Date();
    return { from: isoDay(new Date(to.getTime() - 29 * 86_400_000)), to: isoDay(to) };
  });

  const report = useQuery({
    queryKey: ["ad-report", range],
    queryFn: () => getAdReport({ data: range }),
    enabled: range.from <= range.to,
  });
  const data = report.data;

  const exportLeaderboard = () => {
    if (!data) return;
    downloadCsv(
      stringifyCsv([
        [
          "Ad",
          "Ad set",
          "Campaign",
          "Spend",
          "Leads",
          "Site visits",
          "Bookings",
          "CPL",
          "Cost/site visit",
          "Cost/booking",
          "Booking value",
        ],
        ...data.leaderboard.map((r) => [
          neutralizeFormula(r.adName),
          neutralizeFormula(r.adSetName),
          neutralizeFormula(r.campaignName),
          r.spend,
          r.leads,
          r.siteVisits,
          r.bookings,
          r.cpl,
          r.costPerSiteVisit,
          r.costPerBooking,
          r.bookingValue,
        ]),
      ]),
      `ad-leaderboard-${range.from}-to-${range.to}.csv`,
    );
  };

  return (
    <AppShell
      title="Ad Reports"
      actions={
        <button
          onClick={exportLeaderboard}
          disabled={!data}
          className="inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Download className="size-4" /> Export leaderboard
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
          <label className="text-sm">
            From{" "}
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="ml-1 rounded-lg border border-input bg-background px-2 py-1"
            />
          </label>
          <label className="text-sm">
            To{" "}
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="ml-1 rounded-lg border border-input bg-background px-2 py-1"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1.5">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                tab === t
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {report.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {report.isError && <p className="text-sm text-destructive">Couldn't load the report.</p>}
        {data && data.leaderboard.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            No ads synced yet. Connect an ad account and run the ad spend sync to see reports.
          </p>
        )}

        {data && data.leaderboard.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            {tab === "Leaderboard" && (
              <Table
                head={[
                  "Ad",
                  "Spend",
                  "Leads",
                  "Site visits",
                  "Bookings",
                  "CPL",
                  "Cost / booking",
                  "Booking value",
                ]}
                rows={data.leaderboard.map((r) => [
                  r.adName,
                  dash(r.spend),
                  dash(r.leads),
                  dash(r.siteVisits),
                  dash(r.bookings),
                  dash(r.cpl),
                  dash(r.costPerBooking),
                  dash(r.bookingValue),
                ])}
              />
            )}
            {tab === "Creative" &&
              (data.creative.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No ad set has more than one ad to compare.
                </p>
              ) : (
                data.creative.map((s) => (
                  <div key={s.adSetId} className="border-b border-border last:border-0">
                    <p className="px-4 pt-3 text-sm font-semibold">
                      {s.adSetName}{" "}
                      <span className="font-normal text-muted-foreground">· {s.campaignName}</span>
                    </p>
                    <Table
                      head={["Ad", "Spend", "Leads", "Bookings", "CPL", "Cost / booking"]}
                      rows={s.ads.map((r) => [
                        r.adName,
                        dash(r.spend),
                        dash(r.leads),
                        dash(r.bookings),
                        dash(r.cpl),
                        dash(r.costPerBooking),
                      ])}
                    />
                  </div>
                ))
              ))}
            {tab === "Campaign ROI" && (
              <Table
                head={["Campaign", "Spend", "Booking value", "ROI (x)", "Value by project"]}
                rows={data.roi.map((c) => [
                  c.campaignName,
                  dash(c.spend),
                  dash(c.bookingValue),
                  dash(c.roi, 1),
                  c.byProject.map((p) => `${p.project}: ${dash(p.value)}`).join(", ") || "—",
                ])}
              />
            )}
            {tab === "Funnel" && (
              <>
                <Table
                  head={["Step", "Count", "Drop-off from previous"]}
                  rows={data.funnel.map((s) => [
                    s.label,
                    dash(s.value),
                    s.dropOffPct === null ? "—" : `${s.dropOffPct.toFixed(0)}%`,
                  ])}
                />
                <p className="px-4 pb-3 text-xs text-muted-foreground">
                  Site visits are a lower bound: leads now marked Dropped are not counted.
                </p>
              </>
            )}
            {tab === "First vs last touch" && (
              <Table
                head={[
                  "Ad",
                  "Leads (last touch)",
                  "Leads (first touch)",
                  "Bookings (last)",
                  "Bookings (first)",
                  "",
                ]}
                rows={data.touch.map((r) => [
                  r.adName,
                  dash(r.lastTouchLeads),
                  dash(r.firstTouchLeads),
                  dash(r.lastTouchBookings),
                  dash(r.firstTouchBookings),
                  r.disagrees ? "⚠ disagree" : "",
                ])}
              />
            )}
            {tab === "Stale ads" &&
              (data.stale.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No stale ads. Every ad that spent in the last 7 days got a lead.
                </p>
              ) : (
                <Table
                  head={["Ad", "Ad set", "Campaign"]}
                  rows={data.stale.map((a) => [a.adName, a.adSetName, a.campaignName])}
                />
              ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full min-w-[640px] border-collapse text-sm">
      <thead>
        <tr className="bg-table-head text-table-head-foreground">
          {head.map((h) => (
            <th
              key={h}
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/70">
            {r.map((c, j) => (
              <td key={j} className="px-4 py-3 tabular-nums">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
