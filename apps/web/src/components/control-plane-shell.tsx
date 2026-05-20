"use client";

import { CalendarDays, ClipboardList, Plus, Settings } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AssistantSurfaceDropdown } from "@/components/assistant-surface/assistant-surface-dropdown";
import { AssistantSurfaceTrigger } from "@/components/assistant-surface/assistant-surface-trigger";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskCreateDialog } from "@/components/schedule/dialogs/task-create-dialog";
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
  icon: typeof CalendarDays;
  active: boolean;
};

export function ControlPlaneShell({
  children,
  defaultWorkspace: _defaultWorkspace,
}: ControlPlaneShellProps) {
  const { t } = useI18n();
  const router = useAppRouter();
  const pathname = useAppPathname() ?? "/schedule";
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
      if (segment === "schedule") return t("nav.schedule");
      if (segment === "tasks") return t("nav.tasks");
      if (segment === "settings") return t("nav.settings");
      if (segment === "work") return t("common.work");
      return segment;
    });
  const navItems: NavEntry[] = [
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
      className="h-screen min-h-0 bg-[#f6f8fc] text-foreground"
      style={{ "--sidebar-width": "208px" } as CSSProperties}
    >
      <Sidebar collapsible="none" className="hidden border-r border-border/60 bg-white xl:flex">
        <SidebarHeader className="border-b border-border/60 px-3.5 py-3">
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
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">
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
                      "h-auto rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
                      item.active
                        ? "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary"
                        : "text-slate-700 hover:bg-slate-100 hover:text-foreground",
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
        <header className="relative z-50 border-b border-border/60 bg-white/92 supports-[backdrop-filter]:backdrop-blur">
          <div className="relative flex w-full items-center justify-between gap-3 px-4 py-1.5 sm:px-6 xl:px-7">
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
              <span className="block truncate text-sm font-semibold tracking-tight text-foreground">
                {t("nav.brandTitle")}
              </span>
            </LocalizedLink>

            <div className="min-w-0 flex-1 pr-2">
              <p className="truncate text-xs text-muted-foreground">
                {breadcrumb.join(" / ") || t("nav.schedule")}
              </p>
            </div>

            <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
              <AssistantSurfaceTrigger />
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <Button
                type="button"
                onClick={() => setShowCreateTaskDialog(true)}
                variant="outline"
                size="sm"
                className="h-8 rounded-xl border-border/70 bg-white px-3 text-sm"
              >
                <Plus className="mr-1 size-3.5" />
                {t("nav.newTask")}
              </Button>
              <LocaleSwitcher />
            </div>
            <AssistantSurfaceDropdown />
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 sm:px-6 xl:px-7">
          {children}
        </main>
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
