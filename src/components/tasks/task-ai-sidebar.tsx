"use client";

import { useMemo, useState } from "react";
import { Bot, Sparkles, RotateCcw, Check } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskDecompositionPanel } from "@/components/schedule/task-decomposition-panel";
import { buttonVariants } from "@/components/ui/button";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";

type SavedTaskAiPlanSummary = {
  id: string;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt: string | null;
  revision?: number;
  summary?: string | null;
  updatedAt: string;
};

type TaskAiSidebarTask = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  scheduleSource: string | null;
  isRunnable: boolean;
  runnabilitySummary: string;
  runnabilityState?: string;
  ownerType?: string;
  savedAiPlan?: SavedTaskAiPlanSummary | null;
};

type TaskAiSidebarProps = {
  task: TaskAiSidebarTask;
};

function formatSavedAt(value: string | null | undefined) {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 16);
}

export function TaskAiSidebar({ task }: TaskAiSidebarProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<SavedTaskAiPlanSummary | null>(task.savedAiPlan ?? null);
  const [planningPrompt, setPlanningPrompt] = useState(task.savedAiPlan?.prompt ?? "");
  const [refreshToken, setRefreshToken] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(task.savedAiPlan === null);
  const [isAccepting, setIsAccepting] = useState(false);

  const accepted = activePlan?.status === "accepted";
  const initialAutoRequest = useMemo(
    () => activePlan === null || forceRefresh,
    [activePlan, forceRefresh],
  );

  async function handleApplyDecomposition(result: TaskPlanGraphResponse) {
    setFeedback(null);
    const response = await fetch("/api/ai/batch-decompose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        replaceExisting: true,
      }),
    });

    if (!response.ok) {
      let message = "任务分解应用失败，请稍后重试。";
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) {
          message = data.error;
        }
      } catch {
        // ignore json parse failures and keep fallback message
      }
      setFeedback(message);
      return;
    }

    const planId = result.savedPlan?.id ?? activePlan?.id;
    if (planId) {
      try {
        setIsAccepting(true);
        const acceptResponse = await fetch("/api/ai/task-plan/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id, planId }),
        });

        if (acceptResponse.ok) {
          const data = (await acceptResponse.json()) as {
            savedPlan?: SavedTaskAiPlanSummary;
          };
          if (data.savedPlan) {
            setActivePlan(data.savedPlan);
          }
        }
      } finally {
        setIsAccepting(false);
      }
    }

    setForceRefresh(false);
    setFeedback("任务规划已接受并应用，新的子任务已经创建。");
  }

  function handlePlanLoaded(meta: SavedTaskAiPlanSummary | null) {
    if (meta) {
      setActivePlan(meta);
    }
    setForceRefresh(false);
  }

  function handleReplan() {
    setFeedback(null);
    setForceRefresh(true);
    setRefreshToken((value) => value + 1);
  }

  return (
    <div className="space-y-4">
      <SurfaceCard className="overflow-hidden border-primary/15 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.16),_transparent_55%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.9))] text-white shadow-[0_24px_80px_-36px_rgba(79,70,229,0.75)]">
        <div className="space-y-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-white/80">
                <Sparkles className="size-3.5" />
                AI cockpit
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold tracking-tight">让 AI 直接产出可应用的任务计划</h2>
                <p className="text-sm leading-6 text-white/70">
                  首次无规划时自动生成；之后优先展示已保存的规划，并允许你带提示词重新规划。
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-2 text-white/80">
              <Bot className="size-5" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <LocalizedLink
              href={`/workspaces/${task.workspaceId}/work/${task.id}`}
              className={buttonVariants({ variant: "default" })}
            >
              Open Workbench
            </LocalizedLink>
            <LocalizedLink
              href="/schedule"
              className={buttonVariants({ variant: "outline" })}
            >
              Return to Schedule
            </LocalizedLink>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="sticky top-6 space-y-4">
        <SurfaceCardHeader>
          <SurfaceCardTitle>AI 任务规划面板</SurfaceCardTitle>
          <SurfaceCardDescription>
            自动保存未接受的规划；接受后保留当前版本，并通过重新规划按钮生成新方案。
          </SurfaceCardDescription>
        </SurfaceCardHeader>

        <div className="space-y-4 px-6 pb-6">
          <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Planning status</p>
                <p className="mt-1 text-sm text-foreground">
                  {activePlan
                    ? accepted
                      ? "当前规划已接受，默认展示已采纳版本。"
                      : "当前规划尚未接受，已自动保存为草稿。"
                    : "还没有保存的 AI 规划，首次打开会自动生成。"}
                </p>
              </div>
              {activePlan ? (
                <span className={cn(
                  "rounded-full px-2 py-1 text-[11px] font-medium",
                  accepted ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
                )}>
                  {accepted ? "Accepted" : "Draft"}
                </span>
              ) : null}
            </div>
            {activePlan ? (
              <p className="text-xs text-muted-foreground">
                最近保存：{formatSavedAt(activePlan.updatedAt)}
                {typeof activePlan.revision === "number" ? ` · 版本：r${activePlan.revision}` : ""}
                {activePlan.summary ? ` · ${activePlan.summary}` : ""}
                {activePlan.prompt ? ` · 提示词：${activePlan.prompt}` : ""}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              规划提示词
            </label>
            <textarea
              value={planningPrompt}
              onChange={(event) => setPlanningPrompt(event.target.value)}
              placeholder="例如：优先考虑法规核查，再安排时间线；或请按我能在一天内完成的粒度拆分"
              rows={3}
              className="w-full resize-none rounded-xl border border-border/70 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {activePlan ? (
              <button
                type="button"
                onClick={handleReplan}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <RotateCcw className="mr-1 size-4" />
                重新规划
              </button>
            ) : null}
            {accepted ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                <Check className="mr-1 size-3.5" />
                已接受，除非重新规划否则不会自动重跑
              </span>
            ) : null}
          </div>

          <TaskDecompositionPanel
            key={`${refreshToken}:${forceRefresh ? "fresh" : activePlan?.id ?? "none"}`}
            taskId={task.id}
            title={task.title}
            description={task.description}
            priority={task.priority}
            dueAt={task.dueAt ? new Date(task.dueAt) : null}
            autoRequest={initialAutoRequest}
            planningPrompt={planningPrompt}
            forceRefresh={forceRefresh}
            onApply={handleApplyDecomposition}
            onPlanLoaded={handlePlanLoaded}
          />

          {feedback ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {isAccepting ? "正在确认并应用规划..." : feedback}
            </p>
          ) : null}
        </div>
      </SurfaceCard>
    </div>
  );
}
