import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, Phone, Pencil, ShieldCheck, Users2, CalendarDays, Target } from "lucide-react";
import { AppShell, PrimaryAction, initials } from "@/components/crm/AppShell";
import { agentReports, currentUser } from "@/data/crm";
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
      { name: "description", content: "View and edit your account details, role and activity." },
      { property: "og:title", content: "My Profile — Estatly Real Estate CRM" },
      { property: "og:description", content: "Your Estatly CRM profile and activity summary." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const [profile, setProfile] = useState({
    name: currentUser.name,
    email: currentUser.email,
    phone: currentUser.phone,
  });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(profile);

  const activity = agentReports.find((a) => a.user === currentUser.name);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      toast.error("Full name is required");
      return;
    }
    setProfile(draft);
    setOpen(false);
    toast.success("Profile updated");
  }

  return (
    <AppShell
      title="My Profile"
      actions={
        <PrimaryAction
          label="Edit Profile"
          onClick={() => {
            setDraft(profile);
            setOpen(true);
          }}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-20 place-items-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
              {initials(profile.name)}
            </span>
            <h2 className="mt-4 text-lg font-bold">{profile.name}</h2>
            <p className="text-sm text-muted-foreground">
              {currentUser.role} · {currentUser.team}
            </p>
            <span
              className={
                currentUser.isActive
                  ? "mt-3 inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success"
                  : "mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground"
              }
            >
              <span className="size-1.5 rounded-full bg-current" />
              {currentUser.isActive ? "Active" : "Inactive"}
            </span>
          </div>

          <div className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
            <div className="flex items-center gap-3">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{profile.email}</span>
            </div>
            <div className="flex items-center gap-3">
              <Phone className="size-4 shrink-0 text-muted-foreground" />
              <span>{profile.phone}</span>
            </div>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
              <span>{currentUser.role}</span>
            </div>
            <div className="flex items-center gap-3">
              <Users2 className="size-4 shrink-0 text-muted-foreground" />
              <span>{currentUser.team}</span>
            </div>
            <div className="flex items-center gap-3">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
              <span>Joined {currentUser.joinedAt}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Leads Handled"
              value={currentUser.leadsHandled.toLocaleString()}
              meta="lifetime"
            />
            <Stat
              label="Calls Today"
              value={String(activity?.calls ?? 0)}
              meta={`${activity?.uniqueCalls ?? 0} unique`}
            />
            <Stat label="WhatsApp Sent" value={String(activity?.whatsapp ?? 0)} meta="today" />
            <Stat label="Notes Added" value={String(activity?.notes ?? 0)} meta="today" />
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Target className="size-4 text-primary" /> Today's Activity
            </h3>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field label="Working Hours" value={activity?.workingHours ?? "—"} />
              <Field label="Status Edits" value={String(activity?.statusEdits ?? 0)} />
              <Field label="Form Edits" value={String(activity?.formEdits ?? 0)} />
              <Field label="Emails" value={String(activity?.email ?? 0)} />
              <Field label="SMS" value={String(activity?.sms ?? 0)} />
              <Field label="Status" value={activity?.active ? "Active" : "Inactive"} />
            </dl>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h3 className="text-sm font-semibold">Account</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Role and team are managed by your organisation admin from the Team page.
            </p>
            <button
              onClick={() => {
                setDraft(profile);
                setOpen(true);
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-input px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              <Pencil className="size-4" /> Edit contact details
            </button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Update your name, email and phone number.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Full Name</Label>
              <Input
                id="profile-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-phone">Phone</Label>
              <Input
                id="profile-phone"
                value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
