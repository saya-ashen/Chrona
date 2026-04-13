"use client";

import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
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
    }>;
  };
  isPending?: boolean;
  onGenerate: () => void;
  currentAction?: {
    label: string;
    href: string;
  } | null;
  currentException?: string | null;
};

function formatDateTime(value: string | null | undefined, fallback: string) {
  return value ? value.slice(0, 16).replace("T", " ") : fallback;
}

function getStepStatusMeta(
  status: TaskPlanSidePanelProps["plan"]["steps"][number]["status"],
  copy: WorkbenchCopy,
) {
  switch (status) {
    case "in_progress":
      return { label: copy.inProgressStep, tone: "info" as const };
    case "waiting_for_user":
      return { label: copy.waitingForUserStep, tone: "warning" as const };
    case "done":
      return { label: copy.doneStep, tone: "success" as const };
    case "blocked":
      return { label: copy.blockedStep, tone: "critical" as const };
    default:
      return { label: copy.pendingStep, tone: "neutral" as const };
  }
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

  return revision;
}

export function TaskPlanSidePanel({
  copy,
  plan,
  isPending = false,
  onGenerate,
  currentAction = null,
  currentException = null,
}: TaskPlanSidePanelProps) {
  const currentStep = plan.steps.find((step) => step.id === plan.currentStepId) ?? null;

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
            <button
              type="button"
              disabled={isPending}
              onClick={onGenerate}
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "mt-4 disabled:opacity-60")}
            >
              {copy.generatePlaceholderPlan}
            </button>
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

            <div className="space-y-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
              {currentStep ? (() => {
                const statusMeta = getStepStatusMeta(currentStep.status, copy);

                return (
                  <div className="rounded-[20px] border border-primary/25 bg-primary/[0.07] p-4 shadow-[0_10px_24px_rgba(59,130,246,0.1)]">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-background text-xs font-semibold text-foreground">
                        {plan.steps.findIndex((step) => step.id === currentStep.id) + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="info">{copy.currentStep}</StatusBadge>
                          <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                          <span className="text-xs text-muted-foreground">{currentStep.phase}</span>
                        </div>
                        <p className="mt-3 font-medium text-foreground">{currentStep.title}</p>
                        <p className="mt-2 text-muted-foreground">{currentStep.objective}</p>
                        {currentException ? <p className="mt-3 text-xs text-amber-700">当前阻塞：{currentException}</p> : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          {currentAction ? (
                            <a href={currentAction.href} className={cn(buttonVariants({ variant: "default", size: "sm" }))}>
                              {currentAction.label}
                            </a>
                          ) : null}
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={onGenerate}
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "disabled:opacity-60")}
                          >
                            {copy.resumeFromPlan}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })() : null}

              {plan.steps.some((step) => step.id !== currentStep?.id) ? (
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/[0.9]">
                    {copy.upcomingSteps}
                  </p>

                  {plan.steps.map((step, index) => {
                    const statusMeta = getStepStatusMeta(step.status, copy);

                    if (step.id === currentStep?.id) {
                      return null;
                    }

                    return (
                      <div
                        key={step.id}
                        className={cn("rounded-[20px] border border-border/70 bg-muted/[0.24] p-4")}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold text-muted-foreground">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-foreground">{step.title}</p>
                              <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                            </div>
                            <p className="mt-2 text-muted-foreground">{step.objective}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {!currentStep ? (
              <button
                type="button"
                disabled={isPending}
                onClick={onGenerate}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full disabled:opacity-60")}
              >
                {copy.generatePlaceholderPlan}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
