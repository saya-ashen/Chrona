"use client";

import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type TaskPlanSidePanelProps = {
  plan: {
    state: "empty" | "ready";
    revision: "generated" | "updated" | null;
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

function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "暂无";
}

function getStepStatusMeta(status: TaskPlanSidePanelProps["plan"]["steps"][number]["status"]) {
  switch (status) {
    case "in_progress":
      return { label: "进行中", tone: "info" as const };
    case "waiting_for_user":
      return { label: "等待你确认", tone: "warning" as const };
    case "done":
      return { label: "已完成", tone: "success" as const };
    case "blocked":
      return { label: "阻塞", tone: "critical" as const };
    default:
      return { label: "待开始", tone: "neutral" as const };
  }
}

function getPlanSummary(plan: TaskPlanSidePanelProps["plan"]) {
  if (plan.isMock) {
    return `当前为占位计划 · ${plan.steps.length} 步`;
  }

  if (plan.revision === "updated") {
    return `已根据当前上下文更新 · ${plan.steps.length} 步`;
  }

  return `已生成任务计划 · ${plan.steps.length} 步`;
}

export function TaskPlanSidePanel({
  plan,
  isPending = false,
  onGenerate,
  currentAction = null,
  currentException = null,
}: TaskPlanSidePanelProps) {
  const currentStep = plan.steps.find((step) => step.id === plan.currentStepId) ?? null;

  return (
    <aside className="space-y-3">
      <div className="rounded-[28px] border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold text-foreground">任务计划</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.state === "ready" ? getPlanSummary(plan) : "生成后会在右侧固定展示当前步骤与恢复入口。"}
            </p>
          </div>
          {plan.state === "ready" ? (
            <div className="flex flex-wrap gap-2">
              {plan.revision ? <StatusBadge tone="info">{plan.revision === "updated" ? "最近更新" : "初次生成"}</StatusBadge> : null}
              {plan.isMock ? <StatusBadge tone="warning">占位计划</StatusBadge> : null}
            </div>
          ) : null}
        </div>

        {plan.state === "empty" ? (
          <div className="mt-4 rounded-3xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">还没有任务计划</p>
            <p className="mt-2">生成后会先给出一版占位推进计划，并按当前运行状态同步当前步骤。</p>
            <button
              type="button"
              disabled={isPending}
              onClick={onGenerate}
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "mt-4 disabled:opacity-60")}
            >
              生成占位计划
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            <div className="rounded-3xl border bg-background/80 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="info">计划整体状态</StatusBadge>
                {plan.generatedBy ? <span className="text-xs text-muted-foreground">来源：{plan.generatedBy}</span> : null}
              </div>
              {plan.summary ? <p className="mt-3 text-muted-foreground">{plan.summary}</p> : null}
              {plan.changeSummary ? <p className="mt-3 text-xs text-muted-foreground">{plan.changeSummary}</p> : null}
              <p className="mt-3 text-xs text-muted-foreground">更新时间：{formatDateTime(plan.updatedAt)}</p>
            </div>

            <div className="space-y-3">
              {currentStep ? (() => {
                const statusMeta = getStepStatusMeta(currentStep.status);

                return (
                  <div className="rounded-3xl border border-primary/30 bg-primary/[0.06] p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background text-xs font-semibold text-foreground">
                        {plan.steps.findIndex((step) => step.id === currentStep.id) + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="info">当前步骤</StatusBadge>
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
                            重新规划后继续
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })() : null}

              {plan.steps.map((step, index) => {
                const statusMeta = getStepStatusMeta(step.status);

                if (step.id === currentStep?.id) {
                  return null;
                }

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "rounded-3xl border border-border/60 bg-background/70 p-4",
                    )}
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

            {!currentStep ? (
              <button
                type="button"
                disabled={isPending}
                onClick={onGenerate}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full disabled:opacity-60")}
              >
                重新生成占位计划
              </button>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
