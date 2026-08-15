import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Filter,
  History,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Search,
  Trash2,
  UserRoundCheck,
  X,
} from "lucide-react";
import { AppShell, PrimaryAction } from "@/components/crm/AppShell";
import { leads, statusTone, type Lead } from "@/data/crm";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "Manage Leads — Estatly Real Estate CRM" },
      {
        name: "description",
        content:
          "Search, filter and action every real estate enquiry with call, WhatsApp, email and status tools in one place.",
      },
      { property: "og:title", content: "Manage Leads — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "A fast lead workspace for real estate sales teams with instant preview and actions.",
      },
    ],
  }),
  component: LeadsPage,
});

const tabs = ["All", "My Leads", "Team's", "Unassigned", "Deleted", "Duplicate", "Re Enquired"] as const;
const statusFilters = ["All", "New", "Callback", "Follow Up", "Site Visit", "Booked", "Dropped"] as const;

function LeadsPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("All");
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Lead | null>(null);
  const perPage = 10;

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (status !== "All" && l.status !== status) return false;
      if (tab === "My Leads" && l.assigned !== "Jatin Thakkar") return false;
      if (tab === "Unassigned" && !l.untouched) return false;
      if (tab === "Deleted" || tab === "Duplicate") return false;
      if (tab === "Re Enquired" && l.source !== "Website") return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        l.name.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.project.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q)
      );
    });
  }, [tab, status, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * perPage, current * perPage);
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  return (
    <AppShell
      title="Manage Leads"
      actions={<PrimaryAction label="Add Lead" onClick={() => toast.success("Add lead form opened")} />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1.5">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setPage(1);
              }}
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

        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by name, phone, project or source"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as (typeof statusFilters)[number]);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              {statusFilters.map((s) => (
                <option key={s} value={s}>
                  {s === "All" ? "All statuses" : s}
                </option>
              ))}
            </select>
            <button
              onClick={() => toast("Filter panel", { description: "Advanced filters coming from your saved views." })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-input px-3.5 text-sm font-medium transition-colors hover:bg-secondary"
            >
              <Filter className="size-4" /> Filter
            </button>
            <button
              onClick={() => toast.success(`Exported ${filtered.length} leads`)}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-secondary px-3.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Download className="size-4" /> Export
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-xs">
            <Chip label={`Leads: ${filtered.length}`} />
            <Chip label={`View: ${tab}`} />
            {status !== "All" && <Chip label={`Status: ${status}`} onClear={() => setStatus("All")} />}
            {query && <Chip label={`Search: ${query}`} onClear={() => setQuery("")} />}
            {selected.length > 0 && (
              <span className="ml-auto flex items-center gap-2 font-medium text-primary">
                {selected.length} selected
                <button
                  onClick={() => setSelected([])}
                  className="rounded-md px-2 py-1 text-muted-foreground hover:bg-secondary"
                >
                  Clear
                </button>
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="bg-table-head text-table-head-foreground">
                  <Th className="w-12">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allChecked}
                      onChange={(e) =>
                        setSelected(e.target.checked ? rows.map((r) => r.id) : [])
                      }
                      className="size-4 accent-[oklch(0.68_0.11_178)]"
                    />
                  </Th>
                  <Th>Lead Name</Th>
                  <Th>Assigned To</Th>
                  <Th>Source</Th>
                  <Th>Status</Th>
                  <Th>Project</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setPreview(l)}
                    className={cn(
                      "cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-secondary/70",
                      preview?.id === l.id && "bg-accent/60",
                    )}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.name}`}
                        checked={selected.includes(l.id)}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked ? [...prev, l.id] : prev.filter((id) => id !== l.id),
                          )
                        }
                        className="size-4 accent-[oklch(0.68_0.11_178)]"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{l.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.requirement} · {l.budget}
                        {l.untouched && <span className="ml-1 text-warning">· Untouched</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{l.assigned}</p>
                      <p className="text-xs text-muted-foreground">primary</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{l.source}</p>
                      <p className="max-w-[180px] truncate text-xs text-muted-foreground">{l.subSource}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className={cn("font-semibold", statusTone[l.status])}>{l.status}</p>
                      <p className="text-xs text-muted-foreground">{l.subStatus}</p>
                    </td>
                    <td className="px-4 py-3 font-medium">{l.project}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        {(
                          [
                            [Pencil, "Edit", "bg-primary/15 text-primary"],
                            [Phone, "Call", "bg-info/15 text-info"],
                            [MessageCircle, "WhatsApp", "bg-success/15 text-success"],
                            [Mail, "Email", "bg-warning/20 text-warning"],
                            [Trash2, "Delete", "bg-destructive/12 text-destructive"],
                          ] as const
                        ).map(([Icon, label, tone]) => (
                          <button
                            key={label}
                            title={label}
                            aria-label={`${label} ${l.name}`}
                            onClick={() => toast.success(`${label} — ${l.name}`)}
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
                    <td colSpan={7} className="px-4 py-16 text-center text-sm text-muted-foreground">
                      No leads match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <p className="text-muted-foreground">
              Showing {rows.length === 0 ? 0 : (current - 1) * perPage + 1} - {(current - 1) * perPage + rows.length} of{" "}
              {filtered.length} entries
            </p>
            <div className="flex items-center gap-1">
              <PagerBtn onClick={() => setPage(current - 1)} disabled={current === 1}>
                <ChevronLeft className="size-4" />
              </PagerBtn>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={cn(
                    "size-9 rounded-lg text-sm font-medium transition-colors",
                    p === current ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
                  )}
                >
                  {p}
                </button>
              ))}
              <PagerBtn onClick={() => setPage(current + 1)} disabled={current === pageCount}>
                <ChevronRight className="size-4" />
              </PagerBtn>
            </div>
          </div>
        </div>
      </div>

      <LeadPreview lead={preview} onClose={() => setPreview(null)} />
    </AppShell>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Chip({ label, onClear }: { label: string; onClear?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 font-medium text-muted-foreground">
      {label}
      {onClear && (
        <button onClick={onClear} aria-label={`Clear ${label}`} className="hover:text-foreground">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

function PagerBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="grid size-9 place-items-center rounded-lg transition-colors hover:bg-secondary disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const previewTabs = ["Overview", "Status", "History", "Notes", "Document"] as const;

function LeadPreview({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof previewTabs)[number]>("Overview");

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-foreground/25 transition-opacity duration-200",
          lead ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-40 flex h-screen w-full max-w-[440px] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ease-out",
          lead ? "translate-x-0" : "translate-x-full",
        )}
      >
        {lead && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-5 py-4">
              <button
                onClick={onClose}
                aria-label="Close preview"
                className="grid size-8 place-items-center rounded-full hover:bg-secondary"
              >
                <X className="size-4" />
              </button>
              <h2 className="text-base font-semibold">Lead Preview</h2>
              <div className="ml-auto flex gap-1.5">
                {(
                  [
                    [Pencil, "Edit"],
                    [History, "History"],
                    [MessageCircle, "WhatsApp"],
                    [Phone, "Call"],
                  ] as const
                ).map(([Icon, label]) => (
                  <button
                    key={label}
                    aria-label={label}
                    title={label}
                    onClick={() => toast.success(`${label} — ${lead.name}`)}
                    className="grid size-8 place-items-center rounded-md bg-secondary text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>

            <div className="border-b border-border bg-secondary/50 px-5 py-4">
              <p className="text-lg font-bold">{lead.name}</p>
              <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                <p>{lead.phone}</p>
                <p>{lead.email}</p>
                <p>
                  {lead.city} · {lead.requirement} · {lead.budget}
                </p>
              </div>
            </div>

            <div className="flex gap-1 border-b border-border px-3">
              {previewTabs.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "relative px-3 py-3 text-sm font-medium transition-colors",
                    tab === t ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                  {tab === t && (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {tab === "Overview" && (
                <>
                  <Section title="Lead Status">
                    <div className="rounded-xl bg-secondary p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className={cn("font-semibold", statusTone[lead.status])}>
                          {lead.status}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock3 className="size-3.5" /> {lead.nextAction}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{lead.subStatus}</p>
                    </div>
                  </Section>
                  <Section title="Tags">
                    <div className="flex flex-wrap gap-2">
                      {["About to convert", "Cold", "Escalated", "Highlighted", "Hot", "Warm"].map((t) => (
                        <button
                          key={t}
                          onClick={() => toast.success(`Tag "${t}" applied`)}
                          className="rounded-full border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:bg-accent"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </Section>
                  <Section title="Assign To">
                    <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                      <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                        {lead.assigned.charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{lead.assigned}</p>
                        <p className="text-xs text-muted-foreground">primary</p>
                      </div>
                      <button
                        onClick={() => toast.success("Lead re-assigned")}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                      >
                        <UserRoundCheck className="size-3.5" /> Re-Assign
                      </button>
                    </div>
                  </Section>
                  <Section title="Enquiry Info">
                    <dl className="grid grid-cols-2 gap-4 rounded-xl bg-secondary p-4 text-sm">
                      <Field label="Source" value={lead.source} />
                      <Field label="Sub Source" value={lead.subSource} />
                      <Field label="Project" value={lead.project} />
                      <Field label="Created" value={lead.createdAt} />
                      <Field label="Requirement" value={lead.requirement} />
                      <Field label="Budget" value={lead.budget} />
                    </dl>
                  </Section>
                </>
              )}

              {tab === "Status" && (
                <Section title="Change Status">
                  <div className="grid grid-cols-2 gap-2">
                    {["New", "Callback", "Follow Up", "Site Visit", "Booked", "Dropped"].map((s) => (
                      <button
                        key={s}
                        onClick={() => toast.success(`Status set to ${s}`)}
                        className={cn(
                          "rounded-lg border border-input px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent",
                          s === lead.status && "border-primary bg-accent",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {tab === "History" && (
                <ol className="relative space-y-5 border-l border-border pl-5">
                  {lead.history.map((h, i) => (
                    <li key={i}>
                      <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" />
                      <p className="text-sm font-medium">{h.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {h.at} · {h.by}
                      </p>
                    </li>
                  ))}
                </ol>
              )}

              {tab === "Notes" && (
                <div className="space-y-3">
                  {lead.notes.map((n, i) => (
                    <div key={i} className="rounded-xl border border-border p-4">
                      <p className="text-sm">{n.text}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {n.by} · {n.at}
                      </p>
                    </div>
                  ))}
                  <textarea
                    placeholder="Add a note..."
                    rows={3}
                    className="w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                  />
                  <button
                    onClick={() => toast.success("Note saved")}
                    className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Save note
                  </button>
                </div>
              )}

              {tab === "Document" && (
                <div className="grid place-items-center rounded-xl border border-dashed border-border py-16 text-center">
                  <p className="text-sm font-medium">No documents uploaded</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Agreements, KYC and payment receipts will appear here.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
