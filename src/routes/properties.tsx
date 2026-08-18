import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, Search } from "lucide-react";
import { AppShell, PrimaryAction } from "@/components/crm/AppShell";
import {
  UNIT_STATUS_VALUES,
  UNIT_STATUS_LABELS,
  UNIT_STATUS_TONE,
  type UnitStatusValue,
} from "@/lib/inventory-enums";
import {
  createTower,
  createUnit,
  listProjects,
  listTowers,
  listUnits,
  updateUnitStatus,
} from "@/lib/inventory.server";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
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

export const Route = createFileRoute("/properties")({
  head: () => ({
    meta: [
      { title: "Properties — Estatly Real Estate CRM" },
      {
        name: "description",
        content: "Unit-level inventory across towers, floors and configurations.",
      },
      { property: "og:title", content: "Properties — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Track unit availability, holds and bookings across every tower.",
      },
    ],
  }),
  component: PropertiesPage,
});

const statusFilters = ["All", ...UNIT_STATUS_VALUES] as const;

const emptyDraft = {
  projectId: "",
  towerId: "",
  newTowerName: "",
  unitNumber: "",
  configuration: "",
  floor: "",
  area: "",
  price: "",
};

function PropertiesPage() {
  const queryClient = useQueryClient();
  const [projectFilter, setProjectFilter] = useState<string>("All");
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("All");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => listProjects() });
  const projects = projectsQuery.data ?? [];

  const unitsQuery = useQuery({
    queryKey: ["units", projectFilter, status],
    queryFn: () =>
      listUnits({
        data: {
          projectId: projectFilter === "All" ? undefined : projectFilter,
          status: status === "All" ? undefined : status,
        },
      }),
  });
  const units = unitsQuery.data ?? [];
  const filteredUnits = units.filter(
    (u) =>
      !query ||
      u.unitNumber.toLowerCase().includes(query.toLowerCase()) ||
      u.project.name.toLowerCase().includes(query.toLowerCase()),
  );

  const counts = {
    total: units.length,
    Available: units.filter((u) => u.status === "Available").length,
    Blocked: units.filter((u) => u.status === "Blocked").length,
    Booked: units.filter((u) => u.status === "Booked").length,
    Registered: units.filter((u) => u.status === "Registered").length,
  };

  const towersQuery = useQuery({
    queryKey: ["towers", draft.projectId],
    queryFn: () => listTowers({ data: { projectId: draft.projectId } }),
    enabled: !!draft.projectId,
  });
  const towers = towersQuery.data ?? [];

  const createTowerMutation = useMutation({
    mutationFn: createTower,
    onSuccess: (tower) => {
      void queryClient.invalidateQueries({ queryKey: ["towers", draft.projectId] });
      setDraft((d) => ({ ...d, towerId: tower.id, newTowerName: "" }));
      toast.success(`Tower "${tower.name}" added`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add tower"),
  });

  const createUnitMutation = useMutation({
    mutationFn: createUnit,
    onSuccess: (unit) => {
      void queryClient.invalidateQueries({ queryKey: ["units"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDraft(emptyDraft);
      setAddOpen(false);
      toast.success(`Unit ${unit.unitNumber} added`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add unit"),
  });

  const updateStatusMutation = useMutation({
    mutationFn: updateUnitStatus,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["units"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update status"),
  });

  function submitUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.projectId || !draft.unitNumber.trim()) {
      toast.error("Please select a project and enter a unit number");
      return;
    }
    createUnitMutation.mutate({
      data: {
        projectId: draft.projectId,
        towerId: draft.towerId || undefined,
        unitNumber: draft.unitNumber.trim(),
        configuration: draft.configuration.trim() || undefined,
        floor: draft.floor.trim() || undefined,
        area: draft.area.trim() || undefined,
        price: draft.price.trim() || undefined,
      },
    });
  }

  return (
    <AppShell
      title="Properties"
      actions={
        <PrimaryAction
          label="Add Property"
          onClick={() => {
            setDraft(emptyDraft);
            setAddOpen(true);
          }}
        />
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Total Units" value={counts.total} tone="text-foreground" />
          {UNIT_STATUS_VALUES.map((s) => (
            <Stat
              key={s}
              label={UNIT_STATUS_LABELS[s]}
              value={counts[s]}
              tone={UNIT_STATUS_TONE[s]}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by unit number or project"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="All">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
            {statusFilters.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  status === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {s === "All" ? "All" : UNIT_STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="bg-table-head text-table-head-foreground">
                  {[
                    "Project",
                    "Tower",
                    "Unit",
                    "Configuration",
                    "Floor",
                    "Area",
                    "Price",
                    "Status",
                  ].map((h) => (
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
                {unitsQuery.isLoading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                      Loading units...
                    </td>
                  </tr>
                )}
                {unitsQuery.isError && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-destructive">
                      Couldn't load units.
                    </td>
                  </tr>
                )}
                {!unitsQuery.isLoading &&
                  !unitsQuery.isError &&
                  filteredUnits.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-secondary/70"
                    >
                      <td className="px-4 py-3 font-medium">{u.project.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.tower?.name ?? "—"}</td>
                      <td className="px-4 py-3 font-semibold">{u.unitNumber}</td>
                      <td className="px-4 py-3">{u.configuration ?? "—"}</td>
                      <td className="px-4 py-3">{u.floor ?? "—"}</td>
                      <td className="px-4 py-3">{u.area ?? "—"}</td>
                      <td className="px-4 py-3">{u.price ?? "—"}</td>
                      <td className="px-4 py-3">
                        <select
                          value={u.status}
                          onChange={(e) =>
                            updateStatusMutation.mutate({
                              data: { unitId: u.id, status: e.target.value as UnitStatusValue },
                            })
                          }
                          className={cn(
                            "h-8 rounded-lg border border-input bg-background px-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-ring/40",
                            UNIT_STATUS_TONE[u.status],
                          )}
                        >
                          {UNIT_STATUS_VALUES.map((s) => (
                            <option key={s} value={s}>
                              {UNIT_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                {!unitsQuery.isLoading && !unitsQuery.isError && filteredUnits.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                      No units found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            Showing {filteredUnits.length} of {units.length} entries
          </div>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Property</DialogTitle>
            <DialogDescription>
              Add a unit — tower, floor, configuration and pricing — to a project.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitUnit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="unit-project">
                Project <span className="text-destructive">*</span>
              </Label>
              <Select
                value={draft.projectId}
                onValueChange={(v) => setDraft((d) => ({ ...d, projectId: v, towerId: "" }))}
              >
                <SelectTrigger id="unit-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {draft.projectId && (
              <div className="space-y-1.5">
                <Label htmlFor="unit-tower">Tower</Label>
                <Select
                  value={draft.towerId}
                  onValueChange={(v) => setDraft((d) => ({ ...d, towerId: v }))}
                >
                  <SelectTrigger id="unit-tower">
                    <SelectValue placeholder="No tower" />
                  </SelectTrigger>
                  <SelectContent>
                    {towers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    placeholder="New tower name"
                    value={draft.newTowerName}
                    onChange={(e) => setDraft((d) => ({ ...d, newTowerName: e.target.value }))}
                    className="h-9"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!draft.newTowerName.trim() || createTowerMutation.isPending}
                    onClick={() =>
                      createTowerMutation.mutate({
                        data: { projectId: draft.projectId, name: draft.newTowerName.trim() },
                      })
                    }
                  >
                    <Plus className="size-3.5" /> Add
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unit-number">
                  Unit Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="unit-number"
                  placeholder="e.g. B-1204"
                  value={draft.unitNumber}
                  onChange={(e) => setDraft((d) => ({ ...d, unitNumber: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit-config">Configuration</Label>
                <Input
                  id="unit-config"
                  placeholder="e.g. 2BHK"
                  value={draft.configuration}
                  onChange={(e) => setDraft((d) => ({ ...d, configuration: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unit-floor">Floor</Label>
                <Input
                  id="unit-floor"
                  placeholder="e.g. 12"
                  value={draft.floor}
                  onChange={(e) => setDraft((d) => ({ ...d, floor: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit-area">Area</Label>
                <Input
                  id="unit-area"
                  placeholder="e.g. 980 sq ft"
                  value={draft.area}
                  onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit-price">Price</Label>
                <Input
                  id="unit-price"
                  placeholder="e.g. ₹ 78,00,000"
                  value={draft.price}
                  onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createUnitMutation.isPending}>
                {createUnitMutation.isPending ? "Adding..." : "Add Property"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <ListChecks className={cn("size-4", tone)} />
      </div>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}
