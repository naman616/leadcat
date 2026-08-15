import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { AppShell, PrimaryAction } from "@/components/crm/AppShell";
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

export type ModuleField =
  | { key: string; label: string; type: "text" | "date"; placeholder?: string; required?: boolean }
  | { key: string; label: string; type: "select"; options: readonly string[]; required?: boolean };

export function ModulePage({
  title,
  icon: Icon,
  blurb,
  action,
  items,
  fields,
  recordLabel = "Recently Added",
}: {
  title: string;
  icon: LucideIcon;
  blurb: string;
  action: string;
  items: { label: string; value: string; meta: string }[];
  fields: ModuleField[];
  recordLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [records, setRecords] = useState<Record<string, string>[]>([]);

  function set(key: string, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  function openDialog() {
    setValues({});
    setOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing = fields.find((f) => f.required && !values[f.key]?.trim());
    if (missing) {
      toast.error(`${missing.label} is required`);
      return;
    }
    setRecords((r) => [values, ...r]);
    toast.success(`${action} — saved`);
    setValues({});
    setOpen(false);
  }

  return (
    <AppShell title={title} actions={<PrimaryAction label={action} onClick={openDialog} />}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((i) => (
            <div
              key={i.label}
              className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-[var(--shadow-card)]"
            >
              <p className="text-xs font-medium text-muted-foreground">{i.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{i.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{i.meta}</p>
            </div>
          ))}
        </div>

        {records.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card py-24 text-center shadow-[var(--shadow-card)]">
            <span className="grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
              <Icon className="size-6" />
            </span>
            <h2 className="mt-4 text-base font-semibold">{title}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{blurb}</p>
            <button
              onClick={openDialog}
              className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {action}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">
                {recordLabel} ({records.length})
              </h3>
              <button
                onClick={openDialog}
                className="text-sm font-medium text-primary hover:underline"
              >
                {action}
              </button>
            </div>
            <ul className="divide-y divide-border">
              {records.map((r, i) => (
                <li key={i} className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 text-sm">
                  {fields.map((f) => (
                    <span key={f.key}>
                      <span className="text-muted-foreground">{f.label}: </span>
                      <span className="font-medium">{r[f.key] || "—"}</span>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action}</DialogTitle>
            <DialogDescription>{blurb}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                </Label>
                {f.type === "select" ? (
                  <Select value={values[f.key] ?? ""} onValueChange={(v) => set(f.key, v)}>
                    <SelectTrigger id={f.key}>
                      <SelectValue placeholder={`Select ${f.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={f.key}
                    type={f.type === "date" ? "date" : "text"}
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </div>
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">{action}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
