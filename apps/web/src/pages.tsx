import { Navigate, useLoaderData, useOutletContext, useParams, useSearchParams } from "react-router-dom";

import { InboxPageClient } from "@/components/inbox/inbox-page-client";
import { MemoryPageClient } from "@/components/memory/memory-page-client";
import { SchedulePage } from "@/components/schedule/schedule-page";
import { TaskListPage } from "@/components/tasks/task-list-page";
import { WorkbenchHubPage } from "@/components/work/workbench-hub-page";
import { AdvancedSettingsDialog } from "@/components/settings/advanced-settings-dialog";
import { AiClientsDialog } from "@/components/settings/ai-clients-dialog";
import { ScheduleAiSettingsPanel } from "@/components/settings/schedule-ai-settings-panel";
import { TaskWorkspacePage } from "@/components/tasks/task-workspace-page";
import { WorkPageClient } from "@/components/work/work-page-client";
import type { WorkPageData } from "@/components/work/work-page/work-page-types";
import { LocalizedLink } from "@/components/i18n/localized-link";
import type { Locale } from "@/i18n/config";
import { resolveLocale } from "@/i18n/config";
import { localizeHref } from "@/i18n/routing";
import type { getDictionary } from "@/i18n/get-dictionary";

export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;

export type AppBootData = {
  locale: Locale;
  dictionary: Dictionary;
  defaultWorkspace: Awaited<ReturnType<typeof import("@chrona/engine/modules/workspaces/get-default-workspace").getDefaultWorkspace>>;
  schedule: Awaited<ReturnType<typeof import("@chrona/engine/modules/scheduling/get-schedule-page").getSchedulePage>>;
  inbox: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/get-inbox").getInbox>>;
  memory: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/get-memory-console").getMemoryConsole>>;
};

export type TaskPageRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  task: Awaited<ReturnType<typeof import("@chrona/engine/modules/tasks/get-task-page").getTaskPage>>;
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
    dueAt: string | null;
    updatedAt: string;
    projection: {
      runStatus: string | null;
      isRunnable: boolean;
    } | null;
  }[];
  workspaceId: string;
};

export type WorkbenchHubRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  tasks: TaskListRouteData["tasks"];
  workspaceId: string;
};

export type WorkPageRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  work: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/work-page/get-work-page").getWorkPage>>;
};

export function LocaleLandingPage() {
  const params = useParams();
  return <Navigate to={localizeHref(resolveLocale(params.lang), "/schedule")} replace />;
}

function useAppBootOutletData() {
  return useOutletContext<AppBootData>();
}

export function ScheduleRoutePage() {
  const { defaultWorkspace, schedule } = useAppBootOutletData();
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
  const { defaultWorkspace, inbox, dictionary } = useAppBootOutletData();
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

export function MemoryRoutePage() {
  const { defaultWorkspace, memory, dictionary } = useAppBootOutletData();
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
      <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">AI Clients</h2>
            <p className="text-sm text-muted-foreground">{t.aiClientsDescription}</p>
          </div>
          <div className="mt-3">
            <LocalizedLink
              href="/settings?panel=ai-clients"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t.manageAiClients}
            </LocalizedLink>
          </div>
        </div>
        <ScheduleAiSettingsPanel
          title={t.scheduleAiTitle}
          description={t.scheduleAiDescription}
        />
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">{t.advancedTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.advancedDescription}</p>
          </div>
          <div className="mt-3">
            <LocalizedLink
              href="/settings?panel=advanced"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t.openAdvancedSettings}
            </LocalizedLink>
          </div>
        </div>
      </div>
      <AiClientsDialog isOpen={panel === "ai-clients"} closeHref={`/${locale}/settings`} />
      <AdvancedSettingsDialog
        isOpen={panel === "advanced"}
        closeHref={`/${locale}/settings`}
      />
    </>
  );
}

export function TaskListRoutePage() {
  const { tasks, workspaceId, dictionary } = useLoaderData() as TaskListRouteData;
  return <TaskListPage tasks={tasks} workspaceId={workspaceId} copy={dictionary} />;
}

export function WorkbenchHubRoutePage() {
  const { tasks, workspaceId, dictionary } = useLoaderData() as WorkbenchHubRouteData;
  return <WorkbenchHubPage tasks={tasks} workspaceId={workspaceId} copy={dictionary} />;
}

export function TaskDetailRoutePage() {
  const { task, dictionary } = useLoaderData() as TaskPageRouteData;

  return <TaskWorkspacePage data={task} copy={dictionary.components.taskPage} />;
}

export function WorkRoutePage() {
  const { work } = useLoaderData() as WorkPageRouteData;

  return <WorkPageClient initialData={work as WorkPageData} />;
}
