import type { LucideIcon } from "lucide-react";
import { AppShell, PrimaryAction } from "@/components/crm/AppShell";
import { toast } from "sonner";

export function ModulePage({
  title,
  icon: Icon,
  blurb,
  action,
  items,
}: {
  title: string;
  icon: LucideIcon;
  blurb: string;
  action: string;
  items: { label: string; value: string; meta: string }[];
}) {
  return (
    <AppShell
      title={title}
      actions={<PrimaryAction label={action} onClick={() => toast.success(`${action} opened`)} />}
    >
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

        <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card py-24 text-center shadow-[var(--shadow-card)]">
          <span className="grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
            <Icon className="size-6" />
          </span>
          <h2 className="mt-4 text-base font-semibold">{title}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{blurb}</p>
          <button
            onClick={() => toast.success(`${action} opened`)}
            className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {action}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
