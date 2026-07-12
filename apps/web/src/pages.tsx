import {
  Navigate,
  useLoaderData,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { SchedulePage } from "../../../features/schedule/ui";
import { TaskListPage } from "@/components/tasks/task-list-page";
import { AiClientsDialog } from "../../../features/ai-clients/ui";
import { ScheduleAiSettingsPanel } from "@/components/settings/schedule-ai-settings-panel";
import { TaskWorkspacePage } from "@/components/tasks/task-workspace-page";
import { ActionCenterPageClient } from "@/components/action-center/action-center-page-client";
import type { ActionCenterProjection } from "@chrona/contracts/api";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Badge } from "shared/ui/badge";
import { Button } from "shared/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "shared/ui/card";
import { PageFrame } from "shared/ui/page-frame";
import { Separator } from "@/components/ui/separator";
import type { getDictionary, Locale } from "@chrona/i18n";
import { localizeHref, resolveLocale } from "@chrona/i18n";
import type { WorkStateView } from "@chrona/domain";
import type { DashboardData } from "@/components/dashboard/dashboard-types";
import type { SchedulePageData } from "@features/schedule/ui/schedule-page-types";

import type { TaskPageData } from "../../../features/task-workspace";
export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;

export type AppBootData = {
  locale: Locale;
  dictionary: Dictionary;
  defaultWorkspace: { id: string; name: string };
};

export type ScheduleRouteData = {
  schedule: SchedulePageData;
};

export type DashboardRouteData = {
  dashboard: DashboardData;
};

export type ActionCenterRouteData = {
  actionCenter: ActionCenterProjection;
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
    autoPlanGeneration: boolean;
    autoExecute: boolean;
    projection: {
      runStatus: string | null;
      isRunnable: boolean;
      latestArtifactTitle?: string | null;
      latestRunStatus?: string | null;
    } | null;
    result?: {
      runId: string | null;
      runStatus: string | null;
      provider: string | null;
      occurrenceId: string | null;
      executedAt: string | null;
      artifact: {
        id: string;
        title: string;
        type: string;
        uri: string;
        runId: string;
        createdAt: string;
      } | null;
    } | null;
    stateView: WorkStateView;
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

export function LocaleLandingPage() {
  const params = useParams();
  return (
    <Navigate
      to={localizeHref(resolveLocale(params.lang), "/dashboard")}
      replace
    />
  );
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

export function DashboardRoutePage() {
  const { dictionary } = useAppBootOutletData();
  const { dashboard } = useLoaderData() as DashboardRouteData;

  return (
    <DashboardPage
      data={dashboard}
      copy={dictionary.pages.dashboard}
      workspaceId={dashboard.workspaceId}
    />
  );
}

export function ActionCenterRoutePage() {
  const { defaultWorkspace, dictionary } = useAppBootOutletData();
  const { actionCenter } = useLoaderData() as ActionCenterRouteData;

  return (
    <PageFrame mode="overview">
      <div className="flex w-full flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {dictionary.pages.actionCenter.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {dictionary.pages.actionCenter.subtitle}
          </p>
        </div>
        <Separator />
        <ActionCenterPageClient
          workspaceId={defaultWorkspace.id}
          initialData={actionCenter}
          copy={{
            ...dictionary.components.actionCenterList,
            ...dictionary.pages.actionCenter,
          }}
        />
      </div>
    </PageFrame>
  );
}

export function SettingsRoutePage() {
  const { locale, dictionary } = useAppBootOutletData();
  const [searchParams] = useSearchParams();
  const t = dictionary.pages.settings;
  const panel = searchParams.get("panel");

  return (
    <>
      <PageFrame mode="focused">
        <div className="flex w-full flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {t.title}
                </h1>
                <Badge variant="secondary">{t.controlCenter}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>

          <Separator />

          <div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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
      </PageFrame>
      <AiClientsDialog
        isOpen={panel === "ai-clients"}
        closeHref={`/${locale}/settings`}
      />
    </>
  );
}

export function TaskListRoutePage() {
  const {
    tasks,
    workspaceId,
    dictionary,
    total,
    page,
    pageSize,
    pageCount,
    counts,
  } = useLoaderData() as TaskListRouteData;
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

  return (
    <PageFrame mode="workspace">
      <TaskWorkspacePage data={task} copy={dictionary.components.taskPage} />
    </PageFrame>
  );
}
