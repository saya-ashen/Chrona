"use client";

import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Home,
  PanelsTopLeft,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useAppPathname } from "@/lib/router";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";

type ControlPlaneShellProps = {
  children: ReactNode;
  defaultWorkspace: {
    id: string;
    name: string;
  };
};

type NavEntry = {
  href: string;
  label: string;
  icon: typeof Home;
  active: boolean;
};

export function ControlPlaneShell({ children, defaultWorkspace }: ControlPlaneShellProps) {
  const { t } = useI18n();
  const pathname = useAppPathname() ?? "/schedule";
  const workbenchHref = pathname.includes("/work/") ? pathname : null;
  const breadcrumb = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "schedule") return t("nav.schedule");
      if (segment === "inbox") return t("nav.inbox");
      if (segment === "memory") return t("nav.memory");
      if (segment === "settings") return t("nav.settings");
      if (segment === "workspaces") return t("nav.workspaces");
      if (segment === "tasks") return "Tasks";
      if (segment === "work") return "Workbench";
      return segment;
    });
  const navItems: NavEntry[] = [
    { href: "/schedule", label: "首页", icon: Home, active: pathname === "/schedule" },
    { href: "/workspaces", label: "任务", icon: ClipboardList, active: pathname.startsWith("/workspaces") && !pathname.includes("/work/") },
    { href: "/schedule", label: "计划", icon: PanelsTopLeft, active: pathname.startsWith("/schedule") },
    { href: "/schedule", label: t("nav.schedule"), icon: CalendarDays, active: pathname.startsWith("/schedule") },
    ...(workbenchHref
      ? [{ href: workbenchHref, label: "Workbench", icon: Sparkles, active: pathname === workbenchHref }]
      : []),
    { href: "/settings", label: t("nav.settings"), icon: Settings, active: pathname.startsWith("/settings") },
  ];

  return (
    <div className="flex h-screen bg-[#f6f8fc] text-foreground">
      <aside className="hidden w-[208px] shrink-0 border-r border-border/60 bg-white xl:flex xl:flex-col">
        <div className="border-b border-border/60 px-3.5 py-3">
          <LocalizedLink
            href="/schedule"
            aria-label={t("nav.brandTitle")}
            className="group flex min-w-0 items-center gap-3"
          >
            <img
              src="/favicon.png"
              alt=""
              aria-hidden="true"
              className="h-9 w-9 shrink-0 rounded-xl object-cover mix-blend-multiply dark:mix-blend-screen"
            />
            <span className="min-w-0">
                <span className="block truncate text-[1.35rem] font-semibold tracking-tight leading-none text-foreground">
                  {t("nav.brandTitle")}
                </span>
              </span>
          </LocalizedLink>
        </div>

        <div className="px-3.5 py-3">
          <div className="rounded-2xl border border-border/70 bg-white p-2 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-xs font-semibold text-white">
                {defaultWorkspace.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Workspace</p>
                <p className="truncate text-sm font-medium text-foreground">{defaultWorkspace.name}</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground" />
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-border/70 bg-[#f8fafc] px-2.5 py-1.5 text-sm text-muted-foreground">
            <Search className="size-4" />
            <span className="flex-1">搜索</span>
            <span className="rounded-md border border-border/70 bg-white px-1.5 py-0.5 text-[11px]">⌘ K</span>
          </div>
        </div>

        <nav aria-label="Primary" className="flex-1 px-2.5 pb-3">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <LocalizedLink
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
                    item.active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-700 hover:bg-slate-100 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </LocalizedLink>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-border/60 px-3.5 py-2.5">
          <p className="text-xs text-muted-foreground">空间</p>
          <div className="mt-2.5 space-y-1 text-sm">
            <div className="rounded-xl px-3 py-1.5 text-slate-700 hover:bg-slate-100">AI Docs</div>
            <div className="rounded-xl px-3 py-1.5 text-slate-700 hover:bg-slate-100">产品与增长</div>
            <div className="rounded-xl px-3 py-1.5 text-slate-700 hover:bg-slate-100">+ 新建空间</div>
          </div>
        </div>

        <div className="border-t border-border/60 px-3.5 py-2.5">
          <div className="flex items-center gap-3 rounded-2xl bg-[#f8fafc] px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
              W
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Wayne</p>
              <p className="truncate text-xs text-muted-foreground">wayne@chrona.ai</p>
            </div>
            <ChevronDown className="size-4 text-muted-foreground" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border/60 bg-white/92 supports-[backdrop-filter]:backdrop-blur">
          <div className="flex w-full items-center justify-between gap-3 px-4 py-1.5 sm:px-6 xl:px-7">
            <LocalizedLink
              href="/schedule"
              aria-label={t("nav.brandTitle")}
              className="flex min-w-0 items-center gap-3 xl:hidden"
            >
              <img
                src="/favicon.png"
                alt=""
                aria-hidden="true"
                 className="h-8 w-8 shrink-0 rounded-xl object-cover mix-blend-multiply dark:mix-blend-screen"
              />
              <span className="block truncate text-sm font-semibold tracking-tight text-foreground">{t("nav.brandTitle")}</span>
            </LocalizedLink>

            <div className="min-w-0 flex-1">
               <p className="truncate text-xs text-muted-foreground">{breadcrumb.join(" / ") || t("nav.schedule")}</p>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                   className: "h-8 rounded-xl border-border/70 bg-white px-3 text-sm",
                })}
              >
                新建
                <ChevronDown className="ml-2 size-4" />
              </button>
               <button type="button" className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-foreground">
                 <Bell className="size-5" />
               </button>
               <button type="button" className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-foreground">
                 <CircleHelp className="size-5" />
               </button>
              <LocaleSwitcher />
              <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white sm:flex">
                W
              </div>
            </div>
          </div>
        </header>
         <main className="flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-6 xl:px-7 xl:overflow-hidden">
           {children}
         </main>
      </div>
    </div>
  );
}
