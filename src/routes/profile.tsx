import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Pencil, ShieldCheck, Building2, CalendarDays } from "lucide-react";
import { AppShell, PrimaryAction, initials } from "@/components/crm/AppShell";
import { getCurrentUser, updateProfile } from "@/lib/auth.server";
import { ORG_ROLE_LABELS, type OrgRoleValue } from "@/lib/org-role";
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

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — Estatly Real Estate CRM" },
      { name: "description", content: "View and edit your account details and org membership." },
      { property: "og:title", content: "My Profile — Estatly Real Estate CRM" },
      { property: "og:description", content: "Your Estatly CRM profile." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");

  const currentUserQuery = useQuery({
    queryKey: ["current-user"],
    queryFn: () => getCurrentUser(),
  });
  const user = currentUserQuery.data?.user;
  const memberships = currentUserQuery.data?.memberships ?? [];
  const primaryMembership = memberships[0];

  const updateMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["current-user"] });
      setOpen(false);
      toast.success("Profile updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update profile"),
  });

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Full name is required");
      return;
    }
    updateMutation.mutate({ data: { fullName: fullName.trim() } });
  }

  if (currentUserQuery.isLoading) {
    return (
      <AppShell title="My Profile">
        <div className="grid place-items-center py-24 text-sm text-muted-foreground">
          Loading...
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell title="My Profile">
        <div className="grid place-items-center py-24 text-sm text-muted-foreground">
          Not signed in — go to /sign-in.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="My Profile"
      actions={
        <PrimaryAction
          label="Edit Profile"
          onClick={() => {
            setFullName(user.fullName ?? "");
            setOpen(true);
          }}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-20 place-items-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
              {initials(user.fullName ?? user.email)}
            </span>
            <h2 className="mt-4 text-lg font-bold">{user.fullName ?? user.email}</h2>
            {primaryMembership && (
              <p className="text-sm text-muted-foreground">
                {ORG_ROLE_LABELS[primaryMembership.role as OrgRoleValue]} ·{" "}
                {primaryMembership.organization.name}
              </p>
            )}
          </div>

          <div className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
            <div className="flex items-center gap-3">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{user.email}</span>
            </div>
            {primaryMembership && (
              <>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                  <span>{ORG_ROLE_LABELS[primaryMembership.role as OrgRoleValue]}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                  <span>{primaryMembership.organization.name}</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-3">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
              <span>Joined {new Date(user.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h3 className="text-sm font-semibold">Account</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your role and organization are managed by your org's owner or admin from the Team
              page.
            </p>
            <button
              onClick={() => {
                setFullName(user.fullName ?? "");
                setOpen(true);
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-input px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              <Pencil className="size-4" /> Edit name
            </button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update your display name. Email is tied to your login and can't be changed here.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Full Name</Label>
              <Input
                id="profile-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
