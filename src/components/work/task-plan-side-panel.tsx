"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";
import type { WorkbenchCopy } from "./work-page/work-page-types";

type TaskPlanSidePanelProps = {
  copy: WorkbenchCopy;
  plan: {
    state: "empty" | "ready";
    revision: string | null;
    generatedBy: string | null;
    isMock: boolean;
    summary: string | null;
    updatedAt: string | null;
    changeSummary: string | null;
    currentStepId: string | null;
    steps: Array<{
      id: string;
      title: string;
      objective: string;
      phase: string;
      status: "pending" | "in_progress" | "waiting_for_user" | "done" | "blocked";
      needsUserInput: boolean;
      type?: string;
      linkedTaskId?: string | null;
      executionMode?: string | null;
      estimatedMinutes?: number | null;
      priority?: string | null;
    }>;
  };
  isPending?: boolean;
  currentAction?: {
    label: string;
    href: string;
  } | null;
  currentException?: string | null;
};

function formatDateTime(value: string | null | undefined, fallback: string) {
  return value ? value.slice(0, 16).replace("T", " ") : fallback;
}

function getRevisionLabel(revision: string | null) {
  if (!revision) {
    return null;
  }

  if (revision === "updated") {
    return "最近更新";
  }

  if (revision === "generated") {
    return "初次生成";
  }

  if (/^r\d+$/i.test(revision)) {
    return `图计划 ${revision}`;
  }

  return revision;
}

export function TaskPlanSidePanel({
  copy,
  plan,
  isPending = false,
  currentAction = null,
  currentException = null,
}: TaskPlanSidePanelProps) {
  return (
    <div className="space-y-2 xl:flex xl:min-h-0 xl:flex-col xl:max-h-[calc(100vh-15rem)]">
      <div className="rounded-[24px] border border-border/80 bg-card p-4 shadow-[0_16px_36px_rgba(15,23,42,0.07)] xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{copy.taskPath}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {plan.state === "ready" ? copy.planReadySummary : copy.planEmptySummary}
            </p>
          </div>
          {plan.state === "ready" ? (
            <div className="flex flex-wrap gap-2">
              {plan.revision ? <StatusBadge tone="info">{getRevisionLabel(plan.revision)}</StatusBadge> : null}
              {plan.isMock ? <StatusBadge tone="warning">占位计划</StatusBadge> : null}
            </div>
          ) : null}
        </div>

        {plan.state === "empty" ? (
          <div className="mt-4 rounded-[22px] border border-dashed border-border/70 bg-muted/[0.22] p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{copy.noTaskPlan}</p>
            <p className="mt-2">{copy.planEmptySummary}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-sm xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
            <div className="rounded-[20px] border border-border/70 bg-muted/[0.24] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="info">计划整体状态</StatusBadge>
                {plan.generatedBy ? <span className="text-xs text-muted-foreground">来源：{plan.generatedBy}</span> : null}
              </div>
              {plan.summary ? <p className="mt-3 text-muted-foreground">{plan.summary}</p> : null}
              {plan.changeSummary ? <p className="mt-3 text-xs text-muted-foreground">{plan.changeSummary}</p> : null}
              <p className="mt-3 text-xs text-muted-foreground">{copy.lastUpdatedLabel}：{formatDateTime(plan.updatedAt, copy.noValue)}</p>
            </div>

            {currentException ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">当前阻塞：{currentException}</p>
            ) : null}
            {currentAction ? (
              <div className="flex flex-wrap gap-2">
                <a href={currentAction.href} className="text-sm font-medium text-primary underline underline-offset-4">
                  {currentAction.label}
                </a>
              </div>
            ) : null}

            <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
              <TaskPlanGraph plan={plan} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
