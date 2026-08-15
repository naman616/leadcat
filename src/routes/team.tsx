import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Mail, MessageCircle, Phone, Search, Trash2, UsersRound } from "lucide-react";
import { AppShell, PrimaryAction, initials } from "@/components/crm/AppShell";
import { teamMembers as seedMembers, teams, type TeamMember, type TeamRole } from "@/data/crm";
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

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team — Estatly Real Estate CRM" },
      {
        name: "description",
        content: "Sales hierarchy, roles and lead-distribution rules for your team.",
      },
      { property: "og:title", content: "Team — Estatly Real Estate CRM" },
      { property: "og:description", content: "Manage agents, managers and lead-routing rules." },
    ],
  }),
  component: TeamPage,
});

const roles: (TeamRole | "All")[] = ["All", "Admin", "Manager", "Team Lead", "Agent"];

const emptyDraft = {
  name: "",
  email: "",
  phone: "",
  role: "" as TeamRole | "",
  team: "" as string,
  isActive: true,
};

function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>(seedMembers);
  const [role, setRole] = useState<(typeof roles)[number]>("All");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  const rows = useMemo(
    () =>
      members.filter(
        (m) =>
          (role === "All" || m.role === role) &&
          (m.name.toLowerCase().includes(query.toLowerCase()) ||
            m.email.toLowerCase().includes(query.toLowerCase()) ||
            m.team.toLowerCase().includes(query.toLowerCase())),
      ),
    [members, role, query],
  );

  const stats = useMemo(() => {
    const active = members.filter((m) => m.isActive).length;
    const leads = members.filter((m) => m.role === "Team Lead").length;
    const agents = members.filter((m) => m.role === "Agent" || m.role === "Team Lead");
    const avg = agents.length
      ? Math.round(agents.reduce((sum, m) => sum + m.leadsHandled, 0) / agents.length)
      : 0;
    return {
      total: members.length,
      active,
      teamLeads: leads,
      avgLeads: avg,
      teamCount: new Set(members.map((m) => m.team)).size,
    };
  }, [members]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !draft.name.trim() ||
      !draft.email.trim() ||
      !draft.phone.trim() ||
      !draft.role ||
      !draft.team
    ) {
      toast.error("Please fill in name, email, phone, role and team");
      return;
    }
    const member: TeamMember = {
      id: `TM-${(members.length + 1).toString().padStart(2, "0")}`,
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      role: draft.role,
      team: draft.team,
      isActive: draft.isActive,
      joinedAt: new Date().toLocaleDateString("en-GB").replaceAll("/", "-"),
      leadsHandled: 0,
    };
    setMembers((prev) => [member, ...prev]);
    toast.success(`${member.name} added to ${member.team}`);
    setDraft(emptyDraft);
    setOpen(false);
  }

  return (
    <AppShell
      title="Team"
      actions={
        <PrimaryAction
          label="Add Member"
          onClick={() => {
            setDraft(emptyDraft);
            setOpen(true);
          }}
        />
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Total Members"
            value={String(stats.total)}
            meta={`${stats.teamCount} teams`}
          />
          <Stat label="Active" value={String(stats.active)} meta="currently active" />
          <Stat label="Team Leads" value={String(stats.teamLeads)} meta="managers" />
          <Stat label="Avg Leads / Agent" value={String(stats.avgLeads)} meta="lifetime" />
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-secondary/40 p-1.5">
              {roles.map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                    role === r
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, email or team"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="bg-table-head text-table-head-foreground">
                  {["Member", "Contact", "Role", "Team", "Status", "Actions"].map((h) => (
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
                {rows.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-secondary/70"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {initials(m.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{m.name}</p>
                          <p className="text-xs text-muted-foreground">Joined {m.joinedAt}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                      <p className="text-xs text-muted-foreground">{m.phone}</p>
                    </td>
                    <td className="px-4 py-3 font-medium">{m.role}</td>
                    <td className="px-4 py-3 font-medium">{m.team}</td>
                    <td className="px-4 py-3">
                      <button
                        role="switch"
                        aria-checked={m.isActive}
                        aria-label={`Status for ${m.name}`}
                        onClick={() =>
                          setMembers((prev) =>
                            prev.map((x) => (x.id === m.id ? { ...x, isActive: !x.isActive } : x)),
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                          m.isActive
                            ? "bg-success/15 text-success hover:bg-success/25"
                            : "bg-secondary text-muted-foreground hover:bg-accent",
                        )}
                      >
                        <span className="size-1.5 rounded-full bg-current" />
                        {m.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {(
                          [
                            [Phone, "Call", "bg-info/15 text-info"],
                            [MessageCircle, "WhatsApp", "bg-success/15 text-success"],
                            [Mail, "Email", "bg-warning/20 text-warning"],
                          ] as const
                        ).map(([Icon, label, tone]) => (
                          <button
                            key={label}
                            title={label}
                            aria-label={`${label} ${m.name}`}
                            onClick={() => toast.success(`${label} — ${m.name}`)}
                            className={cn(
                              "grid size-8 place-items-center rounded-md transition-transform hover:scale-105",
                              tone,
                            )}
                          >
                            <Icon className="size-4" />
                          </button>
                        ))}
                        <button
                          title="Remove"
                          aria-label={`Remove ${m.name}`}
                          onClick={() => {
                            setMembers((prev) => prev.filter((x) => x.id !== m.id));
                            toast.success(`${m.name} removed from the team`);
                          }}
                          className="grid size-8 place-items-center rounded-md bg-destructive/12 text-destructive transition-transform hover:scale-105"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">
                      No team members match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            Showing {rows.length} of {members.length} members
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UsersRound className="size-4 text-primary" /> Add Member
            </DialogTitle>
            <DialogDescription>
              Add an agent, team lead or manager to your sales organisation and assign them to a
              team.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="member-name">
                Full Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="member-name"
                placeholder="e.g. Sneha Kulkarni"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="member-email">
                  Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="member-email"
                  type="email"
                  placeholder="name@estatly.crm"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="member-phone">
                  Phone <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="member-phone"
                  placeholder="+91 98765 43210"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="member-role">
                  Role <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={draft.role}
                  onValueChange={(v) => setDraft((d) => ({ ...d, role: v as TeamRole }))}
                >
                  <SelectTrigger id="member-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {(["Admin", "Manager", "Team Lead", "Agent"] as const).map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="member-team">
                  Team <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={draft.team}
                  onValueChange={(v) => setDraft((d) => ({ ...d, team: v }))}
                >
                  <SelectTrigger id="member-team">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive members won't receive auto-assigned leads
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.isActive}
                onClick={() => setDraft((d) => ({ ...d, isActive: !d.isActive }))}
                className={cn(
                  "relative h-6 w-11 rounded-full transition-colors",
                  draft.isActive ? "bg-primary" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-5 rounded-full bg-card shadow transition-all",
                    draft.isActive ? "left-[22px]" : "left-0.5",
                  )}
                />
              </button>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Member</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Stat({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
    </div>
  );
}
