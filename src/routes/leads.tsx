import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
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
  Upload,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import { LEAD_STATUS_VALUES, LEAD_STATUS_LABELS, LEAD_STATUS_TONE } from "@/lib/lead-status";
import { getFollowUpBucket } from "@/lib/follow-up";
import {
  LEAD_IMPORT_TEMPLATE_CSV,
  parseLeadImportCsv,
  type ParsedLeadImportRow,
} from "@/lib/leads-import";
import { AppShell, PrimaryAction } from "@/components/crm/AppShell";
import { DuplicatesDialog } from "@/components/crm/DuplicatesDialog";
import {
  leadBudgets,
  leadRequirements,
  leadCities,
  leadSourceNames,
  leadProjectNames,
} from "@/data/crm";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  bulkCreateLeads,
  createLead,
  exportLeadsCsv,
  getLead,
  listLeads,
  reassignLead,
  updateLeadStatus,
  addLeadNote,
  setNextAction,
} from "@/lib/leads.server";
import { sendWhatsAppMessage } from "@/lib/whatsapp.server";
import { listOrgMembers } from "@/lib/org-members.server";
import { getCurrentUser } from "@/lib/auth.server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/leads")({
  validateSearch: (search: Record<string, unknown>): { leadId?: string | undefined } => ({
    leadId: typeof search["leadId"] === "string" ? search["leadId"] : undefined,
  }),
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
        content:
          "A fast lead workspace for real estate sales teams with instant preview and actions.",
      },
    ],
  }),
  component: LeadsPage,
});

const statusLabels = LEAD_STATUS_LABELS;
const statusTone = LEAD_STATUS_TONE;

const tabs = ["All", "My Leads", "Unassigned"] as const;
const statusFilters = ["All", ...LEAD_STATUS_VALUES] as const;

function downloadCsvFile(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const emptyDraft = {
  name: "",
  phone: "",
  email: "",
  source: "",
  subSource: "",
  project: "",
  budget: "",
  requirement: "",
  city: "",
  assignedTo: "",
};

function LeadsPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof tabs)[number]>("All");
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  // Deep-linked from Tasks (?leadId=...) — opens straight to that lead's
  // preview. Falls back to nothing selected for a normal /leads visit.
  const [previewId, setPreviewId] = useState<string | null>(search.leadId ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const perPage = 10;

  const currentUserQuery = useQuery({
    queryKey: ["current-user"],
    queryFn: () => getCurrentUser(),
  });
  const currentUserId = currentUserQuery.data?.user?.id;

  const orgMembersQuery = useQuery({ queryKey: ["org-members"], queryFn: () => listOrgMembers() });
  const assignableMembers = (orgMembersQuery.data ?? []).map((m) => ({
    id: m.user.id,
    name: m.user.fullName ?? m.user.email,
  }));

  const filters = useMemo(
    () => ({
      status: status === "All" ? undefined : status,
      assignedTo: tab === "My Leads" ? currentUserId : undefined,
      search: query || undefined,
    }),
    [status, tab, currentUserId, query],
  );

  const leadsQuery = useQuery({
    queryKey: ["leads", filters],
    queryFn: () => listLeads({ data: filters }),
  });

  const filtered = useMemo(() => {
    const allLeads = leadsQuery.data ?? [];
    if (tab === "Unassigned") return allLeads.filter((l) => !l.assignee);
    return allLeads;
  }, [leadsQuery.data, tab]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * perPage, current * perPage);
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  const createLeadMutation = useMutation({
    mutationFn: createLead,
    onSuccess: (lead) => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      setTab("All");
      setStatus("All");
      setQuery("");
      setPage(1);
      setDraft(emptyDraft);
      setAddOpen(false);
      toast.success(`${lead.contact.fullName} added as a new lead`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add lead"),
  });

  function submitLead(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.phone.trim() || !draft.source || !draft.project) {
      toast.error("Please fill in name, phone, source and project");
      return;
    }
    createLeadMutation.mutate({
      data: {
        fullName: draft.name.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim() || undefined,
        source: draft.source,
        subSource: draft.subSource.trim() || undefined,
        project: draft.project,
        budget: draft.budget || undefined,
        requirement: draft.requirement || undefined,
        city: draft.city || undefined,
        assignedTo: draft.assignedTo || undefined,
      },
    });
  }

  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const [bulkFileError, setBulkFileError] = useState<string | null>(null);
  const [bulkRows, setBulkRows] = useState<ParsedLeadImportRow[]>([]);

  const bulkValidRows = bulkRows.filter((r) => r.data !== null);
  const bulkInvalidRows = bulkRows.filter((r) => r.data === null);

  const bulkImportMutation = useMutation({
    mutationFn: bulkCreateLeads,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(`Imported ${result.created} lead${result.created === 1 ? "" : "s"}`);
      if (result.unresolvedAssignees.length > 0) {
        toast(`${result.unresolvedAssignees.length} assignee email(s) not found`, {
          description: `Left unassigned: ${result.unresolvedAssignees.join(", ")}`,
        });
      }
      resetBulkDialog();
      setBulkOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Import failed"),
  });

  function resetBulkDialog() {
    setBulkFileName(null);
    setBulkFileError(null);
    setBulkRows([]);
  }

  const exportCsvMutation = useMutation({
    mutationFn: exportLeadsCsv,
    onSuccess: (csv) => {
      downloadCsvFile(csv, "leads-export.csv");
      toast.success("Leads exported");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Export failed"),
  });

  // Same status/assignedTo/search filters the list view queries with — the
  // "Unassigned" tab's extra client-side filter (see `filtered` above) isn't
  // reflected here, so exporting on that tab currently exports the same rows
  // as "All". Fine for a first cut; revisit if that split matters in practice.
  function handleExportCsv() {
    exportCsvMutation.mutate({ data: filters });
  }

  function handleBulkFile(file: File) {
    setBulkFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { rows, fileError } = parseLeadImportCsv(String(reader.result ?? ""));
      setBulkRows(rows);
      setBulkFileError(fileError);
    };
    reader.onerror = () => setBulkFileError("Couldn't read that file.");
    reader.readAsText(file);
  }

  function downloadImportTemplate() {
    downloadCsvFile(LEAD_IMPORT_TEMPLATE_CSV, "leadcat-leads-template.csv");
  }

  function submitBulkImport() {
    if (bulkValidRows.length === 0) return;
    bulkImportMutation.mutate({
      data: { rows: bulkValidRows.map((r) => r.data!) },
    });
  }

  return (
    <AppShell
      title="Manage Leads"
      actions={
        <>
          <button
            onClick={() => setDuplicatesOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-input px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"
          >
            <Users className="size-4" /> Duplicates
          </button>
          <button
            onClick={() => {
              resetBulkDialog();
              setBulkOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-input px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"
          >
            <Upload className="size-4" /> Bulk Upload
          </button>
          <PrimaryAction
            label="Add Lead"
            onClick={() => {
              setDraft(emptyDraft);
              setAddOpen(true);
            }}
          />
        </>
      }
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
                  {s === "All" ? "All statuses" : statusLabels[s]}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                toast("Filter panel", {
                  description: "Advanced filters coming from your saved views.",
                })
              }
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-input px-3.5 text-sm font-medium transition-colors hover:bg-secondary"
            >
              <Filter className="size-4" /> Filter
            </button>
            <button
              onClick={handleExportCsv}
              disabled={exportCsvMutation.isPending}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-secondary px-3.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
            >
              <Download className="size-4" />{" "}
              {exportCsvMutation.isPending ? "Exporting..." : "Export"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-xs">
            <Chip label={`Leads: ${filtered.length}`} />
            <Chip label={`View: ${tab}`} />
            {status !== "All" && (
              <Chip label={`Status: ${statusLabels[status]}`} onClear={() => setStatus("All")} />
            )}
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
                      onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
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
                {leadsQuery.isLoading && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-16 text-center text-sm text-muted-foreground"
                    >
                      Loading leads...
                    </td>
                  </tr>
                )}
                {leadsQuery.isError && (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-sm text-destructive">
                      Couldn't load leads.{" "}
                      {leadsQuery.error instanceof Error ? leadsQuery.error.message : ""}
                    </td>
                  </tr>
                )}
                {!leadsQuery.isLoading &&
                  !leadsQuery.isError &&
                  rows.map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => setPreviewId(l.id)}
                      className={cn(
                        "cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-secondary/70",
                        previewId === l.id && "bg-accent/60",
                      )}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.contact.fullName}`}
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
                        <p className="font-semibold">{l.contact.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.requirement ?? "—"} · {l.budget ?? "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{l.assignee?.fullName ?? "Unassigned"}</p>
                        <p className="text-xs text-muted-foreground">primary</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{l.source ?? "—"}</p>
                        <p className="max-w-[180px] truncate text-xs text-muted-foreground">
                          {l.subSource ?? ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p
                          className={cn(
                            "flex items-center gap-1.5 font-semibold",
                            statusTone[l.status],
                          )}
                        >
                          {statusLabels[l.status]}
                          {getFollowUpBucket(l.nextActionAt) === "escalated" && (
                            <AlertTriangle
                              className="size-3.5 text-destructive"
                              aria-label="Follow-up escalated"
                            />
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{l.subStatus ?? ""}</p>
                      </td>
                      <td className="px-4 py-3 font-medium">{l.project ?? "—"}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {(
                            [
                              [Pencil, "Edit", "bg-primary/15 text-primary"],
                              [Phone, "Call", "bg-info/15 text-info"],
                              [MessageCircle, "WhatsApp", "bg-success/15 text-success"],
                              [Mail, "Email", "bg-warning/20 text-warning"],
                            ] as const
                          ).map(([Icon, label, tone]) => (
                            <button
                              key={label}
                              title={label}
                              aria-label={`${label} ${l.contact.fullName}`}
                              onClick={() => toast.success(`${label} — ${l.contact.fullName}`)}
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
                {!leadsQuery.isLoading && !leadsQuery.isError && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-16 text-center text-sm text-muted-foreground"
                    >
                      No leads match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <p className="text-muted-foreground">
              Showing {rows.length === 0 ? 0 : (current - 1) * perPage + 1} -{" "}
              {(current - 1) * perPage + rows.length} of {filtered.length} entries
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

      <LeadPreview
        leadId={previewId}
        onClose={() => setPreviewId(null)}
        assignableMembers={assignableMembers}
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Lead</DialogTitle>
            <DialogDescription>
              Capture a new enquiry and drop it straight into the pipeline.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitLead} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="lead-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="lead-name"
                  placeholder="Lead's full name"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-phone">
                  Phone <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="lead-phone"
                  placeholder="+91 98765 43210"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-email">Email</Label>
              <Input
                id="lead-email"
                type="email"
                placeholder="name@example.com"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="lead-source">
                  Source <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={draft.source}
                  onValueChange={(v) => setDraft((d) => ({ ...d, source: v }))}
                >
                  <SelectTrigger id="lead-source">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {leadSourceNames.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-project">
                  Project <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={draft.project}
                  onValueChange={(v) => setDraft((d) => ({ ...d, project: v }))}
                >
                  <SelectTrigger id="lead-project">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {leadProjectNames.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="lead-budget">Budget</Label>
                <Select
                  value={draft.budget}
                  onValueChange={(v) => setDraft((d) => ({ ...d, budget: v }))}
                >
                  <SelectTrigger id="lead-budget">
                    <SelectValue placeholder="Budget" />
                  </SelectTrigger>
                  <SelectContent>
                    {leadBudgets.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-requirement">Requirement</Label>
                <Select
                  value={draft.requirement}
                  onValueChange={(v) => setDraft((d) => ({ ...d, requirement: v }))}
                >
                  <SelectTrigger id="lead-requirement">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {leadRequirements.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-city">City</Label>
                <Select
                  value={draft.city}
                  onValueChange={(v) => setDraft((d) => ({ ...d, city: v }))}
                >
                  <SelectTrigger id="lead-city">
                    <SelectValue placeholder="City" />
                  </SelectTrigger>
                  <SelectContent>
                    {leadCities.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-assigned">Assign To</Label>
              <Select
                value={draft.assignedTo}
                onValueChange={(v) => setDraft((d) => ({ ...d, assignedTo: v }))}
              >
                <SelectTrigger id="lead-assigned">
                  <SelectValue placeholder="Leave unassigned" />
                </SelectTrigger>
                <SelectContent>
                  {assignableMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createLeadMutation.isPending}>
                {createLeadMutation.isPending ? "Adding..." : "Add Lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          setBulkOpen(open);
          if (!open) resetBulkDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Upload Leads</DialogTitle>
            <DialogDescription>
              Import a CSV of leads using the template below. Rows are created unassigned unless
              "Assigned To Email" matches a teammate's org account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <button
              type="button"
              onClick={downloadImportTemplate}
              className="inline-flex items-center gap-2 rounded-lg border border-input px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              <Download className="size-4" /> Download CSV template
            </button>

            <div className="space-y-1.5">
              <Label htmlFor="bulk-file">CSV file</Label>
              <input
                id="bulk-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleBulkFile(file);
                  e.target.value = "";
                }}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3.5 file:py-2 file:text-sm file:font-medium hover:file:bg-accent"
              />
              {bulkFileName && (
                <p className="text-xs text-muted-foreground">Selected: {bulkFileName}</p>
              )}
            </div>

            {bulkFileError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {bulkFileError}
              </p>
            )}

            {bulkRows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Chip label={`${bulkValidRows.length} ready to import`} />
                  {bulkInvalidRows.length > 0 && (
                    <Chip
                      label={`${bulkInvalidRows.length} row(s) with errors — will be skipped`}
                    />
                  )}
                </div>

                <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-table-head text-table-head-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Row</th>
                        <th className="px-3 py-2 text-left font-semibold">Name</th>
                        <th className="px-3 py-2 text-left font-semibold">Phone</th>
                        <th className="px-3 py-2 text-left font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {bulkRows.map((r) => (
                        <tr key={r.line}>
                          <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                          <td className="px-3 py-2">{r.raw["fullName"] || "—"}</td>
                          <td className="px-3 py-2">{r.raw["phone"] || "—"}</td>
                          <td className="px-3 py-2">
                            {r.data ? (
                              <span className="text-success">Valid</span>
                            ) : (
                              <span className="text-destructive">{r.errors.join("; ")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitBulkImport}
              disabled={bulkValidRows.length === 0 || bulkImportMutation.isPending}
            >
              {bulkImportMutation.isPending
                ? "Importing..."
                : `Import ${bulkValidRows.length} lead${bulkValidRows.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DuplicatesDialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen} />
    </AppShell>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn("px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide", className)}
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

const previewTabs = ["Overview", "Status", "History", "Notes"] as const;

function LeadPreview({
  leadId,
  onClose,
  assignableMembers,
}: {
  leadId: string | null;
  onClose: () => void;
  assignableMembers: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof previewTabs)[number]>("Overview");
  const [noteText, setNoteText] = useState("");
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [whatsappBody, setWhatsappBody] = useState("");
  const nextActionInputRef = useRef<HTMLInputElement>(null);

  const leadQuery = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => getLead({ data: { leadId: leadId! } }),
    enabled: !!leadId,
  });

  const lead = leadQuery.data;

  const statusMutation = useMutation({
    mutationFn: updateLeadStatus,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      toast.success("Status updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update status"),
  });

  const reassignMutation = useMutation({
    mutationFn: reassignLead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      toast.success("Lead re-assigned");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not reassign"),
  });

  const nextActionMutation = useMutation({
    mutationFn: setNextAction,
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(variables.data.nextActionAt ? "Follow-up scheduled" : "Follow-up cleared");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not update follow-up"),
  });

  const noteMutation = useMutation({
    mutationFn: addLeadNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      setNoteText("");
      toast.success("Note saved");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save note"),
  });

  const whatsappMutation = useMutation({
    mutationFn: sendWhatsAppMessage,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      setWhatsappBody("");
      setWhatsappOpen(false);
      toast.success("WhatsApp message sent");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not send message"),
  });

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-foreground/25 transition-opacity duration-200",
          leadId ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-40 flex h-screen w-full max-w-[440px] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ease-out",
          leadId ? "translate-x-0" : "translate-x-full",
        )}
      >
        {leadId && (
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
                    onClick={() =>
                      label === "WhatsApp"
                        ? setWhatsappOpen(true)
                        : toast.success(`${label} — ${lead?.contact.fullName ?? ""}`)
                    }
                    className="grid size-8 place-items-center rounded-md bg-secondary text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>

            {leadQuery.isLoading && (
              <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                Loading...
              </div>
            )}
            {leadQuery.isError && (
              <div className="flex-1 grid place-items-center text-sm text-destructive">
                Couldn't load this lead.
              </div>
            )}

            {lead && (
              <>
                <div className="border-b border-border bg-secondary/50 px-5 py-4">
                  <p className="text-lg font-bold">{lead.contact.fullName}</p>
                  <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                    <p>{lead.contact.phone ?? "—"}</p>
                    <p>{lead.contact.email ?? "—"}</p>
                    <p>
                      {lead.contact.city ?? "—"} · {lead.requirement ?? "—"} · {lead.budget ?? "—"}
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
                              {statusLabels[lead.status]}
                            </span>
                            {lead.nextActionAt && (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 text-xs",
                                  getFollowUpBucket(lead.nextActionAt) === "escalated"
                                    ? "font-semibold text-destructive"
                                    : "text-muted-foreground",
                                )}
                              >
                                {getFollowUpBucket(lead.nextActionAt) === "escalated" ? (
                                  <AlertTriangle className="size-3.5" />
                                ) : (
                                  <Clock3 className="size-3.5" />
                                )}{" "}
                                {new Date(lead.nextActionAt).toLocaleString()}
                                {getFollowUpBucket(lead.nextActionAt) === "escalated" &&
                                  " · Escalated"}
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {lead.subStatus ?? "—"}
                          </p>
                        </div>
                      </Section>
                      <Section title="Follow-up">
                        <div className="flex items-center gap-2 rounded-xl border border-border p-3">
                          <input
                            key={lead.id}
                            ref={nextActionInputRef}
                            type="datetime-local"
                            defaultValue={toDateTimeLocalValue(lead.nextActionAt)}
                            className="h-9 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                          />
                          <button
                            onClick={() => {
                              const value = nextActionInputRef.current?.value;
                              if (!value) {
                                toast.error("Pick a date and time first");
                                return;
                              }
                              // The datetime-local input's value has no
                              // timezone designator. Converting to a real
                              // ISO string here, in the browser, uses the
                              // browser's own local timezone — parsing
                              // that same naive string server-side would
                              // instead use the server's timezone, which
                              // for an India-focused app on a UTC server
                              // would silently store times 5.5 hours off
                              // from what was actually picked.
                              const isoValue = new Date(value).toISOString();
                              nextActionMutation.mutate({
                                data: { leadId: lead.id, nextActionAt: isoValue },
                              });
                            }}
                            disabled={nextActionMutation.isPending}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                          >
                            <Clock3 className="size-3.5" /> Save
                          </button>
                          {lead.nextActionAt && (
                            <button
                              onClick={() =>
                                nextActionMutation.mutate({
                                  data: { leadId: lead.id, nextActionAt: null },
                                })
                              }
                              disabled={nextActionMutation.isPending}
                              className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                              aria-label="Clear follow-up"
                              title="Clear"
                            >
                              <X className="size-4" />
                            </button>
                          )}
                        </div>
                      </Section>
                      <Section title="Assign To">
                        <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                          <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                            {(lead.assignee?.fullName ?? "?").charAt(0)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {lead.assignee?.fullName ?? "Unassigned"}
                            </p>
                            <p className="text-xs text-muted-foreground">primary</p>
                          </div>
                          <Select
                            value={lead.assignedTo ?? ""}
                            onValueChange={(v) =>
                              reassignMutation.mutate({ data: { leadId: lead.id, assignedTo: v } })
                            }
                          >
                            <SelectTrigger className="ml-auto w-[160px]">
                              <SelectValue placeholder="Re-assign" />
                            </SelectTrigger>
                            <SelectContent>
                              {assignableMembers.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  <span className="inline-flex items-center gap-1.5">
                                    <UserRoundCheck className="size-3.5" /> {m.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </Section>
                      <Section title="Enquiry Info">
                        <dl className="grid grid-cols-2 gap-4 rounded-xl bg-secondary p-4 text-sm">
                          <Field label="Source" value={lead.source ?? "—"} />
                          <Field label="Sub Source" value={lead.subSource ?? "—"} />
                          <Field label="Project" value={lead.project ?? "—"} />
                          <Field
                            label="Created"
                            value={new Date(lead.createdAt).toLocaleDateString()}
                          />
                          <Field label="Requirement" value={lead.requirement ?? "—"} />
                          <Field label="Budget" value={lead.budget ?? "—"} />
                        </dl>
                      </Section>
                    </>
                  )}

                  {tab === "Status" && (
                    <Section title="Change Status">
                      <div className="grid grid-cols-2 gap-2">
                        {LEAD_STATUS_VALUES.map((s) => (
                          <button
                            key={s}
                            onClick={() =>
                              statusMutation.mutate({ data: { leadId: lead.id, status: s } })
                            }
                            disabled={statusMutation.isPending}
                            className={cn(
                              "rounded-lg border border-input px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent",
                              s === lead.status && "border-primary bg-accent",
                            )}
                          >
                            {statusLabels[s]}
                          </button>
                        ))}
                      </div>
                    </Section>
                  )}

                  {tab === "History" && (
                    <ol className="relative space-y-5 border-l border-border pl-5">
                      {lead.activities.length === 0 && (
                        <p className="text-sm text-muted-foreground">No activity yet.</p>
                      )}
                      {lead.activities.map((a) => (
                        <li key={a.id}>
                          <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" />
                          <p className="text-sm font-medium">{a.body}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(a.createdAt).toLocaleString()} ·{" "}
                            {a.author?.fullName ?? "System"}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}

                  {tab === "Notes" && (
                    <div className="space-y-3">
                      {lead.activities
                        .filter((a) => a.type === "note")
                        .map((n) => (
                          <div key={n.id} className="rounded-xl border border-border p-4">
                            <p className="text-sm">{n.body}</p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {n.author?.fullName ?? "System"} ·{" "}
                              {new Date(n.createdAt).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add a note..."
                        rows={3}
                        className="w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                      />
                      <button
                        onClick={() => {
                          if (!noteText.trim()) return;
                          noteMutation.mutate({ data: { leadId: lead.id, body: noteText.trim() } });
                        }}
                        disabled={noteMutation.isPending}
                        className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                      >
                        {noteMutation.isPending ? "Saving..." : "Save note"}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </aside>

      <Dialog open={whatsappOpen} onOpenChange={setWhatsappOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WhatsApp {lead?.contact.fullName}</DialogTitle>
            <DialogDescription>
              Sends to {lead?.contact.phone ?? "this lead"} and logs it on the timeline.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={whatsappBody}
            onChange={(e) => setWhatsappBody(e.target.value)}
            placeholder="Type a message..."
            rows={4}
            className="w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          <DialogFooter>
            <Button
              onClick={() => {
                if (!lead?.contact.phone || !whatsappBody.trim()) return;
                whatsappMutation.mutate({
                  data: {
                    leadId: lead.id,
                    toNumber: lead.contact.phone,
                    body: whatsappBody.trim(),
                  },
                });
              }}
              disabled={whatsappMutation.isPending || !whatsappBody.trim() || !lead?.contact.phone}
            >
              {whatsappMutation.isPending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

/** For pre-filling an <input type="datetime-local">'s defaultValue. */
function toDateTimeLocalValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
