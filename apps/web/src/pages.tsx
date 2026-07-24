import {
  Navigate,
  useLoaderData,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { DashboardPage, type DashboardData } from "@features/dashboard";
import { SchedulePage } from "@features/schedule";
import { TaskListPage } from "@features/task-management";
import { AiClientsDialog } from "@features/ai-clients/ui";
import { TaskWorkspacePage, type TaskPageData } from "@features/task-workspace";
import { GoalAssetWorkbench, GoalListPage, GoalWorkspacePage, type GoalAssetWorkbenchData, type GoalData, type GoalInboxCandidateData } from "@features/goals";
import { ActionCenterPageClient } from "@features/action-center";
import type { ActionCenterProjection } from "@chrona/contracts/api";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { ScheduleAiSettingsPanel } from "@/components/settings/schedule-ai-settings-panel";
import { Badge } from "@shared/ui"
import { Button } from "@shared/ui"
import { Card,
CardDescription,
CardFooter,
CardHeader,
CardTitle, } from "@shared/ui"
import { PageFrame } from "@shared/ui"
import { PageHeader } from "@shared/ui"
import type { getDictionary, Locale } from "@chrona/i18n";
import { localizeHref, resolveLocale } from "@chrona/i18n";
import type { WorkStateView } from "@chrona/domain";
import type { SchedulePageData } from "@features/schedule";

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
export type GoalListRouteData = { goals: GoalData[] };

export type GoalWorkspaceRouteData = { goal: GoalData; assets: GoalAssetWorkbenchData[]; recentAssets: GoalAssetWorkbenchData[]; inboxCandidates: GoalInboxCandidateData[] };

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
    <PageFrame mode="overview" data-domain="attention" className="p-1 sm:p-2">
      <div className="flex w-full flex-1 flex-col gap-4">
        <PageHeader
          title={dictionary.pages.actionCenter.title}
          description={dictionary.pages.actionCenter.subtitle}
        />
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
      <PageFrame mode="focused" data-domain="settings" className="p-1 sm:p-2">
        <div className="flex w-full flex-1 flex-col gap-4">
          <PageHeader
            title={t.title}
            description={t.subtitle}
            meta={<Badge variant="secondary">{t.controlCenter}</Badge>}
          />


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

export function GoalListRoutePage() {
  const { dictionary } = useAppBootOutletData();
  const { goals } = useLoaderData() as GoalListRouteData;
  return <GoalListPage goals={goals} copy={dictionary.pages.goals} />;
}

export function GoalWorkspaceRoutePage() {
  const { dictionary } = useAppBootOutletData();
  const { goal, assets, recentAssets, inboxCandidates } = useLoaderData() as GoalWorkspaceRouteData;
  return <GoalWorkspacePage goal={goal} copy={dictionary.pages.goals} assetWorkbench={<GoalAssetWorkbench goalId={goal.id} workspaceId={goal.workspaceId} copy={dictionary.pages.goals.assetWorkbench} initialAssets={assets} initialRecent={recentAssets} initialCandidates={inboxCandidates} />} />;
}

export function GoalTaskInspectorRoutePage() {
  const { task, dictionary } = useLoaderData() as TaskPageRouteData;
  return (
    <PageFrame mode="workspace" data-domain="tasks" className="p-1 sm:p-2">
      <TaskWorkspacePage data={task} copy={dictionary.components.taskPage} />
    </PageFrame>
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
    <PageFrame mode="workspace" data-domain="tasks" className="p-1 sm:p-2">
      <TaskWorkspacePage data={task} copy={dictionary.components.taskPage} />
    </PageFrame>
  );
}
