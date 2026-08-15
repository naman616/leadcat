import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Building2, Copy, Mail, MessageCircle, Pencil, Phone, Search, Trash2, Upload } from "lucide-react";
import { AppShell, PrimaryAction } from "@/components/crm/AppShell";
import { projectList } from "@/data/crm";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Manage Projects — Estatly Real Estate CRM" },
      {
        name: "description",
        content:
          "Manage residential, commercial and agricultural inventory with availability, matching leads and quick actions.",
      },
      { property: "og:title", content: "Manage Projects — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Project inventory with availability toggles and matching-lead counts.",
      },
    ],
  }),
  component: ProjectsPage,
});

const types = ["All", "Residential", "Commercial", "Agricultural"] as const;

function ProjectsPage() {
  const [type, setType] = useState<(typeof types)[number]>("All");
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<Record<string, boolean>>(
    Object.fromEntries(projectList.map((p) => [p.id, p.available])),
  );

  const rows = useMemo(
    () =>
      projectList.filter(
        (p) =>
          (type === "All" || p.type === type) &&
          (p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.city.toLowerCase().includes(query.toLowerCase())),
      ),
    [type, query],
  );

  return (
    <AppShell
      title="Manage Projects"
      actions={<PrimaryAction label="Add Project" onClick={() => toast.success("Add project form opened")} />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1.5">
          {types.map((t) => {
            const count = t === "All" ? projectList.length : projectList.filter((p) => p.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  "rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                  type === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {t} ({count})
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="border-b border-border p-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects or cities"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="bg-table-head text-table-head-foreground">
                  {["Availability", "Project Name", "City", "Data Count", "Matching Leads", "Actions"].map((h) => (
                    <th
                      key={h}
                      className={cn(
                        "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
                        h === "Actions" && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border transition-colors last:border-0 hover:bg-secondary/70">
                    <td className="px-4 py-3">
                      <button
                        role="switch"
                        aria-checked={availability[p.id]}
                        aria-label={`Availability for ${p.name}`}
                        onClick={() => {
                          setAvailability((a) => ({ ...a, [p.id]: !a[p.id] }));
                          toast.success(`${p.name} marked ${availability[p.id] ? "unavailable" : "available"}`);
                        }}
                        className={cn(
                          "relative h-6 w-11 rounded-full transition-colors",
                          availability[p.id] ? "bg-primary" : "bg-muted-foreground/30",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 size-5 rounded-full bg-card shadow transition-all",
                            availability[p.id] ? "left-[22px]" : "left-0.5",
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-2 font-semibold">
                        <Building2 className="size-4 text-primary" />
                        {p.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.units} · {p.price}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-medium">{p.city}</td>
                    <td className="px-4 py-3 tabular-nums">{p.dataCount}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toast(`${p.matching} matching leads for ${p.name}`)}
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        Match ({p.matching})
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {(
                          [
                            [Pencil, "Edit", "bg-primary/15 text-primary"],
                            [MessageCircle, "WhatsApp", "bg-success/15 text-success"],
                            [Mail, "Email", "bg-warning/20 text-warning"],
                            [Upload, "Share", "bg-info/15 text-info"],
                            [Phone, "Call", "bg-info/15 text-info"],
                            [Copy, "Duplicate", "bg-secondary text-muted-foreground"],
                            [Trash2, "Delete", "bg-destructive/12 text-destructive"],
                          ] as const
                        ).map(([Icon, label, tone]) => (
                          <button
                            key={label}
                            title={label}
                            aria-label={`${label} ${p.name}`}
                            onClick={() => toast.success(`${label} — ${p.name}`)}
                            className={cn(
                              "grid size-8 place-items-center rounded-md transition-transform hover:scale-105",
                              tone,
                            )}
                          >
                            <Icon className="size-4" />
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">
                      No projects found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            Showing {rows.length} of {projectList.length} entries
          </div>
        </div>
      </div>
    </AppShell>
  );
}
