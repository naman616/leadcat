import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowLeftRight,
  Building,
  CalendarDays,
  Database,
  Map,
  Megaphone,
  QrCode,
  Settings,
  Shield,
  Tag,
  Users,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { integrations, moduleSettings } from "@/data/crm";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/global-config")({
  head: () => ({
    meta: [
      { title: "Global Config — Estatly Real Estate CRM" },
      {
        name: "description",
        content:
          "Configure modules, integrations and communication channels for your real estate sales organisation.",
      },
      { property: "og:title", content: "Global Config — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Module settings and portal integrations for a real estate CRM workspace.",
      },
    ],
  }),
  component: ConfigPage,
});

const icons = {
  settings: Settings,
  shield: Shield,
  calendar: CalendarDays,
  users: Users,
  database: Database,
  building: Building,
  map: Map,
  qr: QrCode,
  tag: Tag,
  megaphone: Megaphone,
  arrows: ArrowLeftRight,
  zap: Zap,
};

const tabs = Object.keys(integrations) as (keyof typeof integrations)[];

function ConfigPage() {
  const [tab, setTab] = useState<keyof typeof integrations>("3rd Parties");
  const [connected, setConnected] = useState<string[]>(["Facebook", "Google Campaign", "99 Acres"]);

  return (
    <AppShell title="Global Config">
      <div className="space-y-6">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <span className="grid size-14 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
            E
          </span>
          <div>
            <h2 className="text-lg font-bold">Estatly Realty Group</h2>
            <p className="text-sm text-muted-foreground">https://estatly.crm.app</p>
          </div>
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Module Settings
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {moduleSettings.map((m) => {
              const Icon = icons[m.icon];
              return (
                <button
                  key={m.title}
                  onClick={() => toast(`${m.title} settings`, { description: m.desc })}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)]"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">{m.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Integrations
            </h2>
            <div className="flex gap-1 rounded-xl border border-border bg-card p-1.5">
              {tabs.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {integrations[tab].map((name) => {
              const isConnected = connected.includes(name);
              return (
                <div key={name} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid size-9 place-items-center rounded-lg bg-secondary text-sm font-bold">
                      {name.charAt(0)}
                    </span>
                    <p className="truncate text-sm font-semibold">{name}</p>
                  </div>
                  <button
                    onClick={() => {
                      setConnected((c) =>
                        isConnected ? c.filter((n) => n !== name) : [...c, name],
                      );
                      toast.success(`${name} ${isConnected ? "disconnected" : "connected"}`);
                    }}
                    className={cn(
                      "mt-4 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                      isConnected
                        ? "bg-success/15 text-success hover:bg-success/25"
                        : "border border-input hover:bg-secondary",
                    )}
                  >
                    {isConnected ? "Connected" : "Connect Now"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
