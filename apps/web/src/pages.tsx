import { Navigate, useLoaderData, useOutletContext, useParams, useSearchParams } from "react-router-dom";

import { InboxPageClient } from "@/components/inbox/inbox-page-client";
import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { MemoryPageClient } from "@/components/memory/memory-page-client";
import { SchedulePage } from "../../../features/schedule/ui";
import { TaskListPage } from "@/components/tasks/task-list-page";
import { AiClientsDialog } from "../../../features/ai-clients/ui";
import { ScheduleAiSettingsPanel } from "@/components/settings/schedule-ai-settings-panel";
import { TaskWorkspacePage } from "@/components/tasks/task-workspace-page";
import { WorkPageClient } from "@/components/work/work-page-client";
import type { WorkPageData } from "@/components/work/work-page/work-page-types";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { getDictionary, Locale } from "@chrona/i18n";
import { localizeHref, resolveLocale } from "@chrona/i18n";

import type { TaskPageData } from "../../../features/task-workspace";
export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;

export type AppBootData = {
  locale: Locale;
  dictionary: Dictionary;
  defaultWorkspace: Awaited<ReturnType<typeof import("@chrona/engine/modules/workspaces/get-default-workspace").getDefaultWorkspace>>;
};

export type ScheduleRouteData = {
  schedule: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/get-schedule-page").getSchedulePage>>;
};

export type InboxRouteData = {
  inbox: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/get-inbox").getInbox>>;
};

export type DashboardRouteData = {
  dashboard: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/get-dashboard").getDashboard>>;
};

export type MemoryRouteData = {
  memory: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/get-memory-console").getMemoryConsole>>;
};

export type TaskPageRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  task: TaskPageData;
};

export type TaskListRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  tasks: {
    id: string;
    workspaceId: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    kind: string;
    recurrenceRule: string | null;
    dueAt: string | null;
    updatedAt: string;
    projection: {
      runStatus: string | null;
      isRunnable: boolean;
    } | null;
    source: {
      source: "external_calendar";
      sourceName: string;
      sourceColor: string;
    } | null;
  }[];
  workspaceId: string;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: {
    all: number;
    needsMe: number;
    ready: number;
    running: number;
    completed: number;
    failed: number;
  };
};

export type WorkPageRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  work: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/work-page/get-work-page").getWorkPage>>;
};

export function LocaleLandingPage() {
  const params = useParams();
  return <Navigate to={localizeHref(resolveLocale(params.lang), "/dashboard")} replace />;
}

function useAppBootOutletData() {
  return useOutletContext<AppBootData>();
}

export function ScheduleRoutePage() {
  const { defaultWorkspace } = useAppBootOutletData();
  const { schedule } = useLoaderData() as ScheduleRouteData;
  const [searchParams] = useSearchParams();

  return (
    <SchedulePage
      workspaceId={defaultWorkspace.id}
      data={schedule}
      selectedDay={searchParams.get("day") ?? undefined}
      selectedTaskId={searchParams.get("task") ?? undefined}
      selectedView={searchParams.get("view") ?? undefined}
      showNewTask={searchParams.get("new") === "1"}
    />
  );
}

export function InboxRoutePage() {
  const { defaultWorkspace, dictionary } = useAppBootOutletData();
  const { inbox } = useLoaderData() as InboxRouteData;
  const t = dictionary.pages.inbox;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>
      <InboxPageClient
        workspaceId={defaultWorkspace.id}
        initialData={inbox}
        copy={dictionary.components.inboxList}
      />
    </div>
  );
}

export function DashboardRoutePage() {
  const { dictionary } = useAppBootOutletData();
  const { dashboard } = useLoaderData() as DashboardRouteData;

  return <DashboardPage data={dashboard} copy={dictionary.pages.dashboard} />;
}

export function MemoryRoutePage() {
  const { defaultWorkspace, dictionary } = useAppBootOutletData();
  const { memory } = useLoaderData() as MemoryRouteData;
  const t = dictionary.pages.memory;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>
      <MemoryPageClient
        workspaceId={defaultWorkspace.id}
        initialData={memory}
        copy={dictionary.components.memoryConsole}
      />
    </div>
  );
}

export function SettingsRoutePage() {
  const { locale, dictionary } = useAppBootOutletData();
  const [searchParams] = useSearchParams();
  const t = dictionary.pages.settings;
  const panel = searchParams.get("panel");

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-3xl bg-background p-3 sm:p-4">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
                <Badge variant="secondary">{t.controlCenter}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>

          <Separator />

          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <Card className="self-start">
              <CardHeader>
                <CardTitle>{t.aiClientsTitle}</CardTitle>
                <CardDescription>{t.aiClientsDescription}</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button asChild>
                  <LocalizedLink href="/settings?panel=ai-clients">
                  {t.manageAiClients}
                  </LocalizedLink>
                </Button>
              </CardFooter>
            </Card>
            <ScheduleAiSettingsPanel
              title={t.scheduleAiTitle}
              description={t.scheduleAiDescription}
              copy={t.scheduleAiPanel}
            />
          </div>
        </div>
      </div>
      <AiClientsDialog isOpen={panel === "ai-clients"} closeHref={`/${locale}/settings`} />
    </>
  );
}

export function TaskListRoutePage() {
  const { tasks, workspaceId, dictionary, total, page, pageSize, pageCount, counts } =
    useLoaderData() as TaskListRouteData;
  return (
    <TaskListPage
      tasks={tasks}
      workspaceId={workspaceId}
      copy={dictionary}
      total={total}
      page={page}
      pageSize={pageSize}
      pageCount={pageCount}
      counts={counts}
    />
  );
}

export function TaskDetailRoutePage() {
  const { task, dictionary } = useLoaderData() as TaskPageRouteData;

  return <TaskWorkspacePage data={task} copy={dictionary.components.taskPage} />;
}

export function WorkRoutePage() {
  const { work } = useLoaderData() as WorkPageRouteData;

  return <WorkPageClient initialData={work as WorkPageData} />;
}
