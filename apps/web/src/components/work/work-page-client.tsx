"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { LatestResultPanel } from "@/components/work/latest-result-panel";
import { TaskPlanSidePanel } from "@/components/work/task-plan-side-panel";
import { useI18n } from "@/i18n/client";

import { DEFAULT_WORK_PAGE_COPY } from "./work-page/work-page-copy";
import { useWorkPageController } from "./work-page/use-work-page-controller";
import { WorkbenchComposerCard } from "./work-page/workbench-composer-card";
import {
  formatDateTime,
  getSyncStatusLabel,
  parseDateInputForSubmission,
} from "./work-page/work-page-formatters";
import {
  getCurrentException,
  getCurrentPlanAction,
  getPassiveHeroGuidance,
  getQuickPrompts,
  getTaskSummary,
  getWorkbenchComposer,
} from "./work-page/work-page-selectors";
import type { WorkPageClientProps } from "./work-page/work-page-types";



type NodeViewStatus = "completed" | "running" | "waiting" | "blocked" | "pending";

function getNodeViewStatus(
  step: WorkPageClientProps["initialData"]["taskPlan"]["steps"][number],
  planExecution: WorkPageClientProps["initialData"]["planExecution"],
): NodeViewStatus {
  if (planExecution?.executedNodeIds.includes(step.id) || step.status === "done") return "completed";
  if (planExecution?.currentNodeId === step.id || step.status === "in_progress") return "running";
  if (planExecution?.waitingNodeIds.includes(step.id) || step.status === "waiting_for_user") return "waiting";
  if (planExecution?.blockedNodeIds.includes(step.id) || step.status === "blocked") return "blocked";
  return "pending";
}

const NODE_STATUS_STYLE: Record<NodeViewStatus, string> = {
  completed: "border-emerald-300 bg-emerald-50 text-emerald-700",
  running: "border-blue-300 bg-blue-50 text-blue-700",
  waiting: "border-amber-300 bg-amber-50 text-amber-700",
  blocked: "border-rose-300 bg-rose-50 text-rose-700",
  pending: "border-border bg-background text-muted-foreground",
};

export function WorkPageClient({ initialData }: WorkPageClientProps) {
  const { messages } = useI18n();
  const workPageMessages = messages.components?.workPage ?? {};
  const copy = {
    ...DEFAULT_WORK_PAGE_COPY,
    ...workPageMessages,
  };

  const {
    data,
    isPending,
    heroErrorMessage,
    composerResetKey,
    submitWorkbenchInput,
  } = useWorkPageController(initialData, copy);

  const currentRun = data.currentRun;
  const currentException = getCurrentException(data, copy);
  const taskSummary = getTaskSummary(data, copy);
  const workbenchComposer = getWorkbenchComposer(
    currentRun,
    data.currentIntervention,
    data.closure,
    data.taskShell,
    copy,
    data.planExecution,
  );
  const currentPlanAction = getCurrentPlanAction(currentRun, data.taskPlan, copy);
  const currentPlanStep = data.taskPlan.steps.find(
    (step) => step.id === data.taskPlan.currentStepId,
  ) ?? null;
  const quickPrompts = workbenchComposer
    ? getQuickPrompts(workbenchComposer, currentRun, data.currentIntervention, copy)
    : [];
  const passiveHeroGuidance = getPassiveHeroGuidance(
    currentRun,
    data.closure,
    copy,
  );

  const [composerValue, setComposerValue] = useState(
    workbenchComposer?.defaultValue ?? "",
  );

  useEffect(() => {
    setComposerValue(workbenchComposer?.defaultValue ?? "");
  }, [
    workbenchComposer?.defaultValue,
    workbenchComposer?.mode,
    currentRun?.id,
  ]);

  const syncLabel = getSyncStatusLabel(data.reliability.syncStatus, copy) ?? copy.noValue;
  const blockerSummary =
    currentException ??
    data.reliability.stopReason ??
    data.taskShell.blockReason?.actionRequired ??
    copy.noBlockingAction;
  const suggestedAction =
    data.currentIntervention?.actionLabel ?? currentPlanAction?.label ?? copy.noSuggestedAction;
  const riskSummary = [
    data.reliability.isStale ? copy.staleSync : syncLabel,
    data.reliability.stuckFor ? `${copy.stuckFor}: ${data.reliability.stuckFor}` : null,
    data.reliability.lastSyncedAt
      ? `${copy.lastSyncedLabel}: ${formatDateTime(data.reliability.lastSyncedAt)}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const executionStatus = data.planExecution?.status ?? "no_plan";
  const nodeCount = data.taskPlan.steps.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="rounded-[24px] border border-border/70 bg-card p-5 shadow-sm">
        <p className="text-xs text-muted-foreground">Workspace / Tasks / Workbench</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Workbench / Execution Cockpit</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold">{data.taskShell.title}</h2>
          <StatusBadge>{executionStatus}</StatusBadge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{data.planExecution?.message ?? taskSummary}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Plan Revision", data.taskPlan.revision ?? "-"],
            ["主 Session", currentRun?.status ?? "inactive"],
            ["当前节点", data.planExecution?.currentNodeId ?? "-"],
            ["可执行路径数量", `${nodeCount}`],
          ].map(([k,v]) => <div key={String(k)} className="rounded-xl border border-border/70 bg-background p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-xl font-semibold">{v}</p></div>)}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="space-y-4">
          <section className="rounded-[20px] border border-border/70 bg-card p-4">
            <h3 className="text-lg font-semibold">当前可执行路径</h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {data.taskPlan.steps.map((step) => {
                const s = getNodeViewStatus(step, data.planExecution);
                return <div key={step.id} className={`rounded-lg border px-3 py-2 text-sm ${NODE_STATUS_STYLE[s]}`}>{step.title}</div>;
              })}
            </div>
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-[20px] border border-border/70 bg-card p-4">
              <h3 className="text-lg font-semibold">计划节点状态</h3>
              <table className="mt-3 w-full text-sm"><thead className="text-muted-foreground"><tr><th className="text-left">Node</th><th className="text-left">类型</th><th className="text-left">执行方式</th><th className="text-left">状态</th></tr></thead><tbody>{data.taskPlan.steps.map((step)=><tr key={step.id} className="border-t border-border/50"><td className="py-2">{step.id}</td><td>{step.type ?? step.phase}</td><td>{step.executionMode ?? "auto"}</td><td>{getNodeViewStatus(step,data.planExecution)}</td></tr>)}</tbody></table>
            </article>
            <article className="rounded-[20px] border border-border/70 bg-card p-4">
              <ExecutionTimeline title="主 Session / 执行流" events={data.workstreamItems} currentRunId={currentRun?.id ?? null} />
            </article>
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <LatestResultPanel output={data.latestOutput} updatedLabel={copy.updated} emptyTitle={copy.resultEmptyTitle} emptyDescription={copy.resultEmptyDescription} previewTitle={copy.resultPreviewTitle} previewItems={[copy.resultPreviewUnderstanding,copy.resultPreviewPlan,copy.resultPreviewDraft,copy.resultPreviewQuestions]} labels={{ariaLabel:copy.latestResultAria,eyebrow:"最新输出",usedByNextAction:copy.usedByNextAction,actionsTitle:copy.resultActionsTitle}} />
            <article className="rounded-[20px] border border-border/70 bg-card p-4">
              <h3 className="text-lg font-semibold">Child Sessions</h3>
              <ul className="mt-3 space-y-2 text-sm">{data.taskPlan.steps.map((s)=><li key={s.id} className="rounded-lg border border-border/60 p-2"><div className="font-medium">{s.title}</div><div className="text-muted-foreground">{s.id} · {getNodeViewStatus(s,data.planExecution)}</div></li>)}</ul>
            </article>
          </section>
          <WorkbenchComposerCard composer={workbenchComposer} currentIntervention={data.currentIntervention} currentStepTitle={currentPlanStep?.title ?? null} composerValue={composerValue} onComposerChange={setComposerValue} onSubmit={submitWorkbenchInput} quickPrompts={quickPrompts} errorMessage={heroErrorMessage} isPending={isPending} passiveDescription={passiveHeroGuidance.description} passiveActions={passiveHeroGuidance.actions} copy={copy} composerResetKey={composerResetKey} runId={currentRun?.id ?? null} />
        </main>
        <aside className="space-y-4">
          <TaskPlanSidePanel plan={data.taskPlan} copy={copy} isPending={isPending} currentAction={currentPlanAction} currentException={currentException} />
          <section className="rounded-[20px] border border-border/70 bg-card p-4"><h3 className="font-semibold">需要人工输入</h3><p className="mt-2 text-sm text-muted-foreground">{blockerSummary}</p></section>
          <section className="rounded-[20px] border border-border/70 bg-card p-4"><h3 className="font-semibold">Replan Proposal</h3><p className="mt-2 text-sm text-muted-foreground">{suggestedAction}</p></section>
          <section className="rounded-[20px] border border-border/70 bg-card p-4"><h3 className="font-semibold">运行健康度</h3><p className="mt-2 text-sm text-muted-foreground">{riskSummary || syncLabel}</p></section>
        </aside>
      </div>

      {executionStatus === "no_plan" ? <section className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">当前无计划。请先创建或接受计划，再开始执行。</section> : null}
    </div>
  );
}

export { parseDateInputForSubmission };
