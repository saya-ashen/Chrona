"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/task/shared/task-context-links";
import { useI18n } from "@/i18n/client";

type WorkspaceOverviewProps = {
  data: {
    running: Array<{ taskId: string; workspaceId: string; title: string; latestRunStatus: string | null }>;
    waitingForApproval: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      actionRequired: string | null;
      latestRunStatus: string | null;
    }>;
    blockedOrFailed: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      persistedStatus: string;
      latestRunStatus: string | null;
    }>;
    scheduleRisks: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      scheduleStatus: string | null;
      actionRequired: string | null;
      latestRunStatus: string | null;
    }>;
    upcomingDeadlines: Array<{ taskId: string; workspaceId: string; title: string; dueAt: Date | null; latestRunStatus: string | null }>;
    recentlyUpdated: Array<{ taskId: string; workspaceId: string; title: string; lastActivityAt: Date | null; latestRunStatus: string | null }>;
  };
};

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "-";
}

type OverviewItem = {
  taskId: string;
  workspaceId: string;
  title: string;
  meta: string;
  latestRunStatus?: string | null;
};

export function WorkspaceOverview({ data }: WorkspaceOverviewProps) {
  const { t } = useI18n();
  const sections = [
    {
      title: t("components.workspaceOverview.runningTasks"),
      items: data.running.map((item): OverviewItem => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.title,
        meta: item.latestRunStatus ?? t("components.workspaceOverview.noRunYet"),
        latestRunStatus: item.latestRunStatus,
      })),
    },
    {
      title: t("components.workspaceOverview.waitingForApproval"),
      items: data.waitingForApproval.map((item): OverviewItem => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.title,
        meta: item.actionRequired ?? t("components.workspaceOverview.openTask"),
        latestRunStatus: item.latestRunStatus,
      })),
    },
    {
      title: t("components.workspaceOverview.blockedOrFailed"),
      items: data.blockedOrFailed.map((item): OverviewItem => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.title,
        meta: item.persistedStatus,
        latestRunStatus: item.latestRunStatus,
      })),
    },
    {
      title: t("components.workspaceOverview.scheduleRisks"),
      items: data.scheduleRisks.map((item): OverviewItem => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.title,
        meta: [item.scheduleStatus, item.actionRequired].filter(Boolean).join(" · "),
        latestRunStatus: item.latestRunStatus,
      })),
    },
    {
      title: t("components.workspaceOverview.upcomingDeadlines"),
      items: data.upcomingDeadlines.map((item): OverviewItem => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.title,
        meta: formatDate(item.dueAt),
        latestRunStatus: item.latestRunStatus,
      })),
    },
    {
      title: t("components.workspaceOverview.recentlyUpdated"),
      items: data.recentlyUpdated.map((item): OverviewItem => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.title,
        meta: item.lastActivityAt ? item.lastActivityAt.toISOString() : t("components.workspaceOverview.noActivityYet"),
        latestRunStatus: item.latestRunStatus,
      })),
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {sections.map((section) => (
        <SurfaceCard key={section.title} className="space-y-4">
          <SurfaceCardHeader>
            <SurfaceCardTitle>{section.title}</SurfaceCardTitle>
            <SurfaceCardDescription>{t("components.workspaceOverview.sectionDescription")}</SurfaceCardDescription>
          </SurfaceCardHeader>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            {section.items.length === 0 ? (
              <p>{t("components.workspaceOverview.noItems")}</p>
            ) : (
              section.items.map((item) => (
                <SurfaceCard
                  key={`${section.title}-${item.taskId}`}
                  as="div"
                  variant="inset"
                  padding="sm"
                  className="space-y-3 rounded-2xl"
                >
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.taskId}</p>
                    <p className="text-xs text-muted-foreground">{item.meta}</p>
                  </div>
                  {item.latestRunStatus ? <StatusBadge tone="info">{item.latestRunStatus}</StatusBadge> : null}
                  <TaskContextLinks workspaceId={item.workspaceId} taskId={item.taskId} latestRunStatus={item.latestRunStatus} size="xs" />
                </SurfaceCard>
              ))
            )}
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}
