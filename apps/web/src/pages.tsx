import { Navigate, useLoaderData, useParams, useSearchParams } from "react-router-dom";

import { InboxPageClient } from "@/components/inbox/inbox-page-client";
import { MemoryPageClient } from "@/components/memory/memory-page-client";
import { SchedulePage } from "@/components/schedule/schedule-page";
import { AdvancedSettingsDialog } from "@/components/settings/advanced-settings-dialog";
import { AiClientsDialog } from "@/components/settings/ai-clients-dialog";
import { ScheduleAiSettingsPanel } from "@/components/settings/schedule-ai-settings-panel";
import { TaskPage } from "@/components/tasks/task-page";
import { WorkPageClient } from "@/components/work/work-page-client";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { WorkspaceOverview } from "@/components/workspaces/workspace-overview";
import type { Locale } from "@/i18n/config";
import { localizeHref } from "@/i18n/routing";
import type { getDictionary } from "@/i18n/get-dictionary";

export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;

export type AppBootData = {
  locale: Locale;
  dictionary: Dictionary;
  defaultWorkspace: Awaited<ReturnType<typeof import("@/modules/workspaces/get-default-workspace").getDefaultWorkspace>>;
  schedule: Awaited<ReturnType<typeof import("@/modules/queries/get-schedule-page").getSchedulePage>>;
  inbox: Awaited<ReturnType<typeof import("@/modules/queries/get-inbox").getInbox>>;
  memory: Awaited<ReturnType<typeof import("@/modules/queries/get-memory-console").getMemoryConsole>>;
  workspaces: Awaited<ReturnType<typeof import("@/modules/queries/get-workspaces").getWorkspaces>>;
};

export type TaskPageRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  task: Awaited<ReturnType<typeof import("@/modules/queries/get-task-page").getTaskPage>>;
};

export type WorkPageRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  work: Awaited<ReturnType<typeof import("@/modules/queries/work-page/get-work-page").getWorkPage>>;
};

export type WorkspaceOverviewRouteData = {
  locale: Locale;
  dictionary: Dictionary;
  workspaceId: string;
  data: Awaited<ReturnType<typeof import("@/modules/queries/get-workspace-overview").getWorkspaceOverview>>;
};

export function LocaleLandingPage() {
  const { locale } = useLoaderData() as AppBootData;
  return <Navigate to={localizeHref(locale, "/schedule")} replace />;
}

export function ScheduleRoutePage() {
  const { defaultWorkspace, schedule } = useLoaderData() as AppBootData;
  const [searchParams] = useSearchParams();

  return (
    <SchedulePage
      workspaceId={defaultWorkspace.id}
      data={schedule}
      selectedDay={searchParams.get("day") ?? undefined}
      selectedTaskId={searchParams.get("task") ?? undefined}
      selectedView={searchParams.get("view") ?? undefined}
    />
  );
}

export function InboxRoutePage() {
  const { defaultWorkspace, inbox, dictionary } = useLoaderData() as AppBootData;
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
  const { defaultWorkspace, memory, dictionary } = useLoaderData() as AppBootData;
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
  const { locale, workspaces, dictionary } = useLoaderData() as AppBootData;
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
        workspaces={workspaces}
      />
    </>
  );
}

export function WorkspacesRoutePage() {
  const { workspaces, dictionary } = useLoaderData() as AppBootData;
  const t = dictionary.pages.workspaces;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>
      <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">{t.notice}</div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((workspace) => (
          <LocalizedLink
            key={workspace.id}
            href={`/workspaces/${workspace.id}`}
            className="rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40"
          >
            <p className="font-medium text-foreground">{workspace.name}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {workspace._count.tasks} {workspace._count.tasks === 1 ? t.taskCountOne : t.taskCountOther}
            </p>
          </LocalizedLink>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceOverviewRoutePage() {
  const { dictionary, data } = useLoaderData() as WorkspaceOverviewRouteData;
  const t = dictionary.pages.workspaceOverview;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>
      <WorkspaceOverview data={data} />
    </div>
  );
}

export function TaskDetailRoutePage() {
  const { task, dictionary } = useLoaderData() as TaskPageRouteData;
  const params = useParams();

  if (params.workspaceId && task.task.workspaceId !== params.workspaceId) {
    return <Navigate to={`/${task.task.workspaceId}/tasks/${task.task.id}`} replace />;
  }

  return <TaskPage data={task} copy={dictionary.components.taskPage} />;
}

export function WorkRoutePage() {
  const { work } = useLoaderData() as WorkPageRouteData;
  const params = useParams();

  if (params.workspaceId && work.taskShell.workspaceId !== params.workspaceId) {
    return <Navigate to={`/${work.taskShell.workspaceId}/work/${work.taskShell.id}`} replace />;
  }

  return <WorkPageClient initialData={work} />;
}
