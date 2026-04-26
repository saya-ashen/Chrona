"use client";

import { ListTree } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";
import { StatusBadge } from "@/components/ui/status-badge";
import { useLocale } from "@/i18n/client";
import { useI18n } from "@/i18n/client";
import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import { getPriorityTone } from "@/components/schedule/schedule-page-utils";
import { markTaskDone, reopenTask } from "@/lib/task-actions-client";
import { cn } from "@/lib/utils";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";

type SubtaskData = {
  id: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  persistedStatus: string | null;
  scheduleStatus: string | null;
  dueAt: string | Date | null;
  scheduledStartAt: string | Date | null;
  scheduledEndAt: string | Date | null;
  completedAt: string | Date | null;
  isCompleted: boolean;
};

function formatSubtaskWindow(
  locale: string,
  value: string | Date | null | undefined,
) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function toCompactPlan(planResult: TaskPlanGraphResponse | null) {
  if (!planResult?.planGraph?.nodes) {
    return { state: "empty" as const, currentStepId: null, steps: [], edges: [] };
  }

  return {
    state: "ready" as const,
    currentStepId:
      planResult.planGraph.nodes.find((node) =>
        ["in_progress", "waiting_for_user", "blocked"].includes(node.status),
      )?.id ?? null,
    steps: planResult.planGraph.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      objective: node.title,
      phase: "",
      status: node.status === "skipped" ? "done" : node.status,
      requiresHumanInput: node.requiresHumanInput ?? false,
      type: node.type,
      linkedTaskId: node.linkedTaskId,
      executionMode: node.executionMode,
      estimatedMinutes: node.estimatedMinutes,
      priority: node.priority,
      description: null,
      detailMode: "title_only" as const,
    })),
    edges: planResult.planGraph.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      type: edge.type,
    })),
  };
}

export function ScheduleTaskPlanSubtasks({
  parentTaskId,
  workspaceId,
  refreshKey,
  planResult,
}: {
  parentTaskId: string;
  workspaceId: string;
  refreshKey?: number;
  planResult: TaskPlanGraphResponse | null;
}) {
  const [subtasks, setSubtasks] = useState<SubtaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingSubtaskId, setPendingSubtaskId] = useState<string | null>(null);
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  const fetchSubtasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${parentTaskId}/subtasks`);
      if (!res.ok) {
        setSubtasks([]);
        return;
      }
      const data = await res.json();
      setSubtasks(
        Array.isArray(data) ? data : (data.subtasks ?? data.tasks ?? []),
      );
    } catch {
      setSubtasks([]);
    } finally {
      setLoading(false);
    }
  }, [parentTaskId]);

  useEffect(() => {
    void fetchSubtasks();
  }, [fetchSubtasks, refreshKey]);

  const compactPlan = useMemo(() => toCompactPlan(planResult), [planResult]);

  return (
    <div className="space-y-4">
      {compactPlan.state === "ready" && compactPlan.steps.length > 0 ? (
        <div className="rounded-[1.5rem] border border-border/70 bg-background p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            <ListTree className="size-3.5" />
            <span>Task Plan Graph</span>
          </div>
          <TaskPlanGraph plan={compactPlan} />
        </div>
      ) : null}

      {loading || subtasks.length === 0 ? null : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            <ListTree className="size-3" />
            <span>{copy.childTasksLabel} ({subtasks.length})</span>
          </div>
          <div className="space-y-1">
            {subtasks.map((sub) => (
              <div
                key={sub.id}
                className="rounded-lg border border-border/40 bg-background/60 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <LocalizedLink
                    href={`/workspaces/${workspaceId}/work/${sub.id}`}
                    className="min-w-0 flex-1 space-y-1 transition hover:text-primary"
                  >
                    <div className="truncate font-medium text-foreground">
                      {sub.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <StatusBadge tone={getPriorityTone(sub.priority)}>
                        {sub.priority}
                      </StatusBadge>
                      {sub.persistedStatus ? (
                        <StatusBadge>{sub.persistedStatus}</StatusBadge>
                      ) : null}
                      {sub.scheduleStatus ? (
                        <StatusBadge>{sub.scheduleStatus}</StatusBadge>
                      ) : null}
                      {sub.isCompleted ? (
                        <StatusBadge tone="success">Done</StatusBadge>
                      ) : null}
                      {sub.scheduledStartAt ? (
                        <span>
                          {formatSubtaskWindow(locale, sub.scheduledStartAt)}
                          {sub.scheduledEndAt
                            ? ` → ${formatSubtaskWindow(locale, sub.scheduledEndAt)}`
                            : ""}
                        </span>
                      ) : sub.dueAt ? (
                        <span>Due {formatSubtaskWindow(locale, sub.dueAt)}</span>
                      ) : null}
                    </div>
                  </LocalizedLink>
                  <button
                    type="button"
                    disabled={pendingSubtaskId === sub.id}
                    onClick={() => {
                      void (async () => {
                        try {
                          setPendingSubtaskId(sub.id);
                          if (sub.isCompleted) {
                            await reopenTask({ taskId: sub.id });
                          } else {
                            await markTaskDone({ taskId: sub.id });
                          }
                          await fetchSubtasks();
                        } finally {
                          setPendingSubtaskId(null);
                        }
                      })();
                    }}
                    className={cn(
                      "shrink-0 rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50",
                    )}
                  >
                    {pendingSubtaskId === sub.id
                      ? "..."
                      : sub.isCompleted
                        ? copy.childTaskReopen
                        : copy.childTaskMarkDone}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
