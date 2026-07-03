"use client";

import { CalendarDays, ClipboardList, LayoutDashboard, Plus, Settings } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AssistantSurfaceHeaderDrawerButton } from "@/components/assistant-surface/assistant-surface-header-drawer-button";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskCreateDialog } from "../../schedule/ui";
import { createTaskFromSchedule } from "@/lib/task-actions-client";
import { useAppPathname, useAppRouter } from "@/lib/router";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useI18n } from "@chrona/i18n/react";

export type ControlPlaneShellProps = {
  children: ReactNode;
  defaultWorkspace: {
    id: string;
    name: string;
  };
};

type NavEntry = {
  href: string;
  label: string;
  icon: typeof CalendarDays;
  active: boolean;
};

export function ControlPlaneShell({
  children,
  defaultWorkspace: _defaultWorkspace,
}: ControlPlaneShellProps) {
  const { t } = useI18n();
  const router = useAppRouter();
  const pathname = useAppPathname();
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const taskDialogDefaults = useMemo(() => {
    const initialStartAt = new Date();
    initialStartAt.setHours(9, 0, 0, 0);
    const initialEndAt = new Date(initialStartAt);
    initialEndAt.setHours(10, 0, 0, 0);

    return { initialStartAt, initialEndAt };
  }, [showCreateTaskDialog]);
  const breadcrumb = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "dashboard") return t("nav.dashboard");
      if (segment === "schedule") return t("nav.schedule");
      if (segment === "tasks") return t("nav.tasks");
      if (segment === "settings") return t("nav.settings");
      if (segment === "work") return t("common.work");
      return segment;
    });
  const navItems: NavEntry[] = [
    {
      href: "/dashboard",
      label: t("nav.dashboard"),
      icon: LayoutDashboard,
      active: pathname.startsWith("/dashboard"),
    },
    {
      href: "/schedule",
      label: t("nav.schedule"),
      icon: CalendarDays,
      active: pathname.startsWith("/schedule"),
    },
    {
      href: "/tasks",
      label: t("nav.tasks"),
      icon: ClipboardList,
      active: pathname.startsWith("/tasks"),
    },
    // Inbox and Memory intentionally stay out of primary navigation. Dashboard
    // owns concise attention/recovery visibility until separate pages have clear,
    // actionable product value.
    {
      href: "/settings",
      label: t("nav.settings"),
      icon: Settings,
      active: pathname.startsWith("/settings"),
    },
  ];

  return (
    <SidebarProvider
      defaultOpen
      className="h-screen min-h-0 bg-canvas text-foreground"
      style={{ "--sidebar-width": "200px" } as CSSProperties}
    >
      <Sidebar collapsible="none" className="hidden border-r border-border/60 bg-sidebar xl:flex">
        <SidebarHeader className="border-b border-border/60 px-3.5 py-3.5">
          <LocalizedLink
            href="/schedule"
            aria-label={t("nav.brandTitle")}
            className="group flex min-w-0 items-center gap-2.5"
          >
            <img
              src="/favicon.png"
              alt=""
              aria-hidden="true"
              className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-border/60 mix-blend-multiply dark:mix-blend-screen"
            />
            <span className="min-w-0">
              <span className="block truncate text-[1.3rem] font-semibold tracking-tight leading-none text-foreground">
                {t("nav.brandTitle")}
              </span>
              <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                {t("nav.brandTagline")}
              </span>
            </span>
          </LocalizedLink>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="px-2.5 py-3">
            <SidebarGroupContent>
              <SidebarMenu aria-label="Primary" className="gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <SidebarMenuItem key={`${item.href}-${item.label}`}>
                  <SidebarMenuButton
                    render={
                      <LocalizedLink
                        href={item.href}
                        aria-current={item.active ? "page" : undefined}
                      />
                    }
                    isActive={item.active}
                    className={cn(
                      "h-auto rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      item.active
                        ? "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary [&_svg]:text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-50 border-b border-border/60 bg-background/85 supports-[backdrop-filter]:backdrop-blur-md">
          <div className="relative flex w-full items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6 xl:px-7">
            <div className="flex min-w-0 shrink items-center gap-3">
              <LocalizedLink
                href="/schedule"
                aria-label={t("nav.brandTitle")}
                className="flex shrink-0 items-center gap-2 xl:hidden"
              >
                <img
                  src="/favicon.png"
                  alt=""
                  aria-hidden="true"
                  className="h-8 w-8 shrink-0 rounded-xl object-cover ring-1 ring-border/60 mix-blend-multiply dark:mix-blend-screen"
                />
                <span className="hidden truncate text-sm font-semibold tracking-tight text-foreground sm:block">
                  {t("nav.brandTitle")}
                </span>
              </LocalizedLink>

              <p className="hidden min-w-0 truncate text-xs font-medium text-muted-foreground xl:block">
                {breadcrumb.join(" / ") || t("nav.schedule")}
              </p>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-center">
              <AssistantSurfaceHeaderDrawerButton disabled />
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Button
                type="button"
                onClick={() => setShowCreateTaskDialog(true)}
                variant="default"
                size="sm"
                className="h-10 gap-1.5 px-3 sm:px-3.5"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">{t("nav.newTask")}</span>
              </Button>
              <LocaleSwitcher />
            </div>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] sm:px-6 xl:px-7 xl:pb-3">
          {children}
        </main>

        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md xl:hidden"
        >
          <ul className="mx-auto flex max-w-lg items-stretch justify-around">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={`mobile-${item.href}`} className="flex-1">
                  <LocalizedLink
                    href={item.href}
                    aria-current={item.active ? "page" : undefined}
                    className={cn(
                      "flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors",
                      item.active
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-5" />
                    <span className="truncate">{item.label}</span>
                  </LocalizedLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <TaskCreateDialog
        isOpen={showCreateTaskDialog}
        initialStartAt={taskDialogDefaults.initialStartAt}
        initialEndAt={taskDialogDefaults.initialEndAt}
        isPending={isCreatingTask}
        onClose={() => setShowCreateTaskDialog(false)}
        onSubmit={async (input) => {
          try {
            setIsCreatingTask(true);
            await createTaskFromSchedule({
              workspaceId: _defaultWorkspace.id,
              title: input.title,
              description: input.description || null,
              priority: input.priority,
              autoPlanGeneration: input.autoPlanGenerationEnabled || input.autoExecute,
              autoExecute: input.autoExecute,
              autoPlanGenerationTiming: input.autoPlanGenerationTiming,
              autoExecuteTiming: input.autoExecuteTiming,
            });
            router.refresh();
          } finally {
            setIsCreatingTask(false);
          }
        }}
      />
    </SidebarProvider>
  );
}
