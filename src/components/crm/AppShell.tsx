import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Settings2,
  Users,
  Database,
  ReceiptText,
  PieChart,
  Building2,
  Home,
  CalendarCheck,
  ListChecks,
  UsersRound,
  Bell,
  Search,
  ChevronsLeft,
  Plus,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/global-config", label: "Global Config", icon: Settings2 },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/data", label: "Data", icon: Database },
  { to: "/invoice", label: "Invoice", icon: ReceiptText },
  { to: "/reports", label: "Reports", icon: PieChart },
  { to: "/projects", label: "Projects", icon: Building2 },
  { to: "/properties", label: "Properties", icon: Home },
  { to: "/attendance", label: "Attendance", icon: CalendarCheck },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/team", label: "Team", icon: UsersRound },
] as const;

export function AppShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
          collapsed ? "w-[76px]" : "w-[228px]",
        )}
      >
        <div className="flex h-[68px] items-center gap-2 px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Building2 className="size-5" />
          </span>
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-sidebar-accent-foreground">
              estatly
            </span>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {nav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center justify-between border-t border-sidebar-border px-4 py-3 text-xs text-sidebar-foreground/70">
          {!collapsed && <span>v1.0.835</span>}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label="Toggle sidebar"
            className="rounded-md p-1.5 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[68px] items-center gap-4 border-b border-border bg-card px-6">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <div className="ml-auto flex items-center gap-3">
            {actions}
            <button
              aria-label="Search"
              className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Search className="size-[18px]" />
            </button>
            <button
              aria-label="Notifications"
              className="relative grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Bell className="size-[18px]" />
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-destructive" />
            </button>
            <div className="flex items-center gap-2 pl-1">
              <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                JT
              </span>
              <span className="text-sm font-medium">Jatin</span>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

export function PrimaryAction({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
    >
      <Plus className="size-4" />
      {label}
    </button>
  );
}
