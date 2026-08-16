import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Trash2, UsersRound } from "lucide-react";
import { AppShell, PrimaryAction, initials } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { listOrgMembers, addOrgMemberByEmail, removeOrgMember } from "@/lib/org-members.server";
import { ORG_ROLE_VALUES, ORG_ROLE_LABELS, type OrgRoleValue } from "@/lib/org-role";
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
      { name: "description", content: "Roles and org membership for your team." },
      { property: "og:title", content: "Team — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Manage who belongs to your organization and their role.",
      },
    ],
  }),
  component: TeamPage,
});

const roleFilters = ["All", ...ORG_ROLE_VALUES] as const;

const emptyDraft = { email: "", role: "" as OrgRoleValue | "" };

function TeamPage() {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<(typeof roleFilters)[number]>("All");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  const membersQuery = useQuery({ queryKey: ["org-members"], queryFn: () => listOrgMembers() });

  const rows = useMemo(() => {
    const members = membersQuery.data ?? [];
    return members.filter(
      (m) =>
        (role === "All" || m.role === role) &&
        ((m.user.fullName ?? "").toLowerCase().includes(query.toLowerCase()) ||
          m.user.email.toLowerCase().includes(query.toLowerCase())),
    );
  }, [membersQuery.data, role, query]);

  const stats = useMemo(() => {
    const members = membersQuery.data ?? [];
    const byRole: Record<string, number> = {};
    for (const m of members) byRole[m.role] = (byRole[m.role] ?? 0) + 1;
    return { total: members.length, byRole };
  }, [membersQuery.data]);

  const addMutation = useMutation({
    mutationFn: addOrgMemberByEmail,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["org-members"] });
      setDraft(emptyDraft);
      setOpen(false);
      toast.success(`${result.fullName ?? result.email} added to the team`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add member"),
  });

  const removeMutation = useMutation({
    mutationFn: removeOrgMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org-members"] });
      toast.success("Member removed");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove member"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.email.trim() || !draft.role) {
      toast.error("Please fill in email and role");
      return;
    }
    addMutation.mutate({ data: { email: draft.email.trim(), role: draft.role } });
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
          <Stat label="Total Members" value={String(stats.total)} meta="in this org" />
          {(["owner", "admin", "agent"] as const).map((r) => (
            <Stat
              key={r}
              label={ORG_ROLE_LABELS[r]}
              value={String(stats.byRole[r] ?? 0)}
              meta="members"
            />
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-secondary/40 p-1.5">
              {roleFilters.map((r) => (
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
                  {r === "All" ? "All" : ORG_ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              className="h-10 min-w-[220px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-sm">
              <thead>
                <tr className="bg-table-head text-table-head-foreground">
                  {["Member", "Email", "Role", "Joined", "Actions"].map((h) => (
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
                {membersQuery.isLoading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center text-muted-foreground">
                      Loading team...
                    </td>
                  </tr>
                )}
                {!membersQuery.isLoading &&
                  rows.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-secondary/70"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                            {initials(m.user.fullName ?? m.user.email)}
                          </span>
                          <p className="truncate font-semibold">{m.user.fullName ?? "—"}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{m.user.email}</td>
                      <td className="px-4 py-3 font-medium">
                        {ORG_ROLE_LABELS[m.role as OrgRoleValue]}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            title="Email"
                            aria-label={`Email ${m.user.email}`}
                            onClick={() => toast.success(`Email — ${m.user.email}`)}
                            className="grid size-8 place-items-center rounded-md bg-warning/20 text-warning transition-transform hover:scale-105"
                          >
                            <Mail className="size-4" />
                          </button>
                          <button
                            title="Remove"
                            aria-label={`Remove ${m.user.email}`}
                            onClick={() => removeMutation.mutate({ data: { orgMemberId: m.id } })}
                            disabled={removeMutation.isPending}
                            className="grid size-8 place-items-center rounded-md bg-destructive/12 text-destructive transition-transform hover:scale-105"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                {!membersQuery.isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center text-muted-foreground">
                      No team members match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            Showing {rows.length} of {(membersQuery.data ?? []).length} members
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
              Add an existing Estatly account to this org. They need to have signed up already —
              this isn't an email invite yet, just linking an existing account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="member-email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="member-email"
                type="email"
                placeholder="name@example.com"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-role">
                Role <span className="text-destructive">*</span>
              </Label>
              <Select
                value={draft.role}
                onValueChange={(v) => setDraft((d) => ({ ...d, role: v as OrgRoleValue }))}
              >
                <SelectTrigger id="member-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ORG_ROLE_VALUES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ORG_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addMutation.isPending}>
                {addMutation.isPending ? "Adding..." : "Add Member"}
              </Button>
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
