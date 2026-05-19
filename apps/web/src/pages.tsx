import { Navigate, useLoaderData, useOutletContext, useParams, useSearchParams } from "react-router-dom";

import { InboxPageClient } from "@/components/inbox/inbox-page-client";
import { MemoryPageClient } from "@/components/memory/memory-page-client";
import { SchedulePage } from "@/components/schedule/schedule-page";
import { TaskListPage } from "@/components/tasks/task-list-page";
import { AiClientsDialog } from "@/components/settings/ai-clients-dialog";
import { TaskWorkspacePage } from "@/components/tasks/task-workspace-page";
import { WorkPageClient } from "@/components/work/work-page-client";
import type { WorkPageData } from "@/components/work/work-page/work-page-types";
import { LocalizedLink } from "@/components/i18n/localized-link";
import type { getDictionary, Locale } from "@chrona/i18n";
import { localizeHref, resolveLocale } from "@chrona/i18n";

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
      <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-[30px] border border-border/55 bg-white/70 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:p-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-[24px] bg-[linear-gradient(135deg,rgba(248,250,252,0.94),rgba(238,242,255,0.78))] p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-0.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">{t.title}</h1>
                <span className="rounded-full border border-primary/15 bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                  {t.controlCenter}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-3">
            <div className="rounded-[26px] border border-white/70 bg-slate-950 p-5 text-white shadow-sm">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">{t.aiClientsTitle}</h2>
                <p className="text-sm leading-6 text-white/60">{t.aiClientsDescription}</p>
              </div>
              <div className="mt-4">
                <LocalizedLink
                  href="/settings?panel=ai-clients"
                  className="inline-flex rounded-2xl border border-white/15 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm transition-colors hover:bg-white/90"
                >
                  {t.manageAiClients}
                </LocalizedLink>
              </div>
            </div>
          </div>
        </div>
      </div>
      <AiClientsDialog isOpen={panel === "ai-clients"} closeHref={`/${locale}/settings`} />
    </>
  );
}

export function TaskListRoutePage() {
  const { tasks, workspaceId, dictionary } = useLoaderData() as TaskListRouteData;
  return <TaskListPage tasks={tasks} workspaceId={workspaceId} copy={dictionary} />;
}

export function TaskDetailRoutePage() {
  const { task, dictionary } = useLoaderData() as TaskPageRouteData;

  return <TaskWorkspacePage data={task} copy={dictionary.components.taskPage} />;
}

export function WorkRoutePage() {
  const { work } = useLoaderData() as WorkPageRouteData;

  return <WorkPageClient initialData={work as WorkPageData} />;
}
