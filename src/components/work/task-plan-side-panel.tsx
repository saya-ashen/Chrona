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

export function TaskPlanSidePanel({ plan, isPending = false, onGenerate }: TaskPlanSidePanelProps) {
  return (
    <aside className="space-y-3">
      <div className="rounded-[28px] border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold text-foreground">任务计划</p>
            <p className="mt-1 text-sm text-muted-foreground">右侧只保留整体推进视角，避免和中间协作区重复。</p>
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
            <p className="mt-2">生成后会先给出一版占位任务推进计划，并按当前运行状态同步步骤状态。</p>
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
                <StatusBadge tone="info">当前推进概览</StatusBadge>
                {plan.generatedBy ? <span className="text-xs text-muted-foreground">来源：{plan.generatedBy}</span> : null}
              </div>
              {plan.summary ? <p className="mt-3 text-muted-foreground">{plan.summary}</p> : null}
              {plan.changeSummary ? <p className="mt-3 text-xs text-muted-foreground">{plan.changeSummary}</p> : null}
              <p className="mt-3 text-xs text-muted-foreground">更新时间：{formatDateTime(plan.updatedAt)}</p>
            </div>

            <div className="space-y-3">
              {plan.steps.map((step, index) => {
                const statusMeta = getStepStatusMeta(step.status);

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "rounded-3xl border bg-background/80 p-4",
                      plan.currentStepId === step.id ? "border-primary/30 bg-primary/[0.04]" : "border-border/70",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold text-foreground">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">{step.title}</p>
                          <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                          <span className="text-xs text-muted-foreground">{step.phase}</span>
                        </div>
                        <p className="mt-2 text-muted-foreground">{step.objective}</p>
                        {step.needsUserInput ? (
                          <p className="mt-2 text-xs text-amber-700">当前计划等待你的确认或补充说明后继续。</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              disabled={isPending}
              onClick={onGenerate}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full disabled:opacity-60")}
            >
              重新生成占位计划
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
