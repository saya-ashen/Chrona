"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock3,
  Ellipsis,
  GitBranch,
  LayoutGrid,
  Share2,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { LatestResultPanel } from "@/components/work/latest-result-panel";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

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
import type { WorkbenchCopy, WorkPageClientProps } from "./work-page/work-page-types";

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

function getExecutionTone(status: string) {
  switch (status) {
    case "completed":
      return "success" as const;
    case "waiting_for_user":
    case "waiting_for_approval":
      return "warning" as const;
    case "blocked":
      return "critical" as const;
    case "running":
    case "started":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

function getNodeStatusMeta(status: NodeViewStatus, copy: WorkbenchCopy) {
  switch (status) {
    case "completed":
      return { label: copy.doneStep, tone: "success" as const };
    case "running":
      return { label: copy.inProgressStep, tone: "info" as const };
    case "waiting":
      return { label: copy.waitingForUserStep, tone: "warning" as const };
    case "blocked":
      return { label: copy.blockedStep, tone: "critical" as const };
    default:
      return { label: copy.pendingStep, tone: "neutral" as const };
  }
}

function SectionFrame({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-border/70 bg-card p-4 shadow-[0_14px_36px_rgba(15,23,42,0.05)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[1.1rem] font-semibold text-foreground">{title}</h3>
        {actions}
      </div>
      <div className={cn("mt-3 min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

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
  const passiveHeroGuidance = getPassiveHeroGuidance(currentRun, data.closure, copy);

  const [composerValue, setComposerValue] = useState(workbenchComposer?.defaultValue ?? "");
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);

  useEffect(() => {
    setComposerValue(workbenchComposer?.defaultValue ?? "");
  }, [workbenchComposer?.defaultValue, workbenchComposer?.mode, currentRun?.id]);

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
  const completedCount = data.taskPlan.steps.filter(
    (step) => getNodeViewStatus(step, data.planExecution) === "completed",
  ).length;
  const waitingCount = data.taskPlan.steps.filter((step) => {
    const status = getNodeViewStatus(step, data.planExecution);
    return status === "waiting" || status === "blocked";
  }).length;
  const rightRailSummary = heroErrorMessage ?? blockerSummary;
  const metricCards = [
    {
      label: "Plan Revision",
      value: data.taskPlan.revision ?? copy.noValue,
      hint: data.taskPlan.changeSummary ?? "Latest accepted plan snapshot",
      icon: Sparkles,
      accent: "from-slate-100 to-white text-slate-700",
    },
    {
      label: "主 Session",
      value: currentRun?.status ?? "inactive",
      hint: currentRun?.updatedAt
        ? `Updated ${formatDateTime(currentRun.updatedAt)}`
        : "Waiting for a live session",
      icon: Activity,
      accent: "from-emerald-50 to-white text-emerald-700",
    },
    {
      label: "当前节点",
      value: data.planExecution?.currentNodeId ?? copy.noValue,
      hint: currentPlanStep?.title ?? "No active node",
      icon: GitBranch,
      accent: "from-blue-50 to-white text-blue-700",
    },
    {
      label: "可执行路径",
      value: `${nodeCount} 个节点`,
      hint: `${completedCount} completed · ${waitingCount} need attention`,
      icon: CheckCircle2,
      accent: "from-violet-50 to-white text-violet-700",
    },
  ];
  const topTabs = [
    { id: "summary", label: "总览", icon: LayoutGrid },
    { id: "stream", label: "执行流", icon: Activity },
    { id: "latest", label: "最新结果", icon: CheckCircle2 },
    { id: "inspector", label: "Inspector", icon: WandSparkles },
  ];
  const visibleChildSteps = data.taskPlan.steps.slice(0, 4);
  const hasMoreChildSteps = data.taskPlan.steps.length > visibleChildSteps.length;
  const dockSummary =
    data.currentIntervention?.actionLabel ??
    currentPlanStep?.title ??
    workbenchComposer?.statusHint ??
    passiveHeroGuidance.description;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <section className="overflow-hidden rounded-[22px] border border-border/70 bg-card shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
        <div className="border-b border-border/60 px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">
                Workspace / Tasks / {data.taskShell.title} / Workbench
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-[1.35rem]">
                  {data.taskShell.title}
                </h1>
                <StatusBadge tone={getExecutionTone(executionStatus)}>{executionStatus}</StatusBadge>
                <StatusBadge tone={data.reliability.isStale ? "warning" : "info"}>{syncLabel}</StatusBadge>
              </div>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground sm:text-sm">
                {data.planExecution?.message ?? taskSummary}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="inline-flex h-8 items-center gap-2 rounded-xl border border-border/70 bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40">
                <Share2 className="size-4" />
                分享
              </button>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-background text-muted-foreground hover:bg-muted/40">
                <Ellipsis className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-2 px-4 py-2.5 md:grid-cols-2 xl:grid-cols-4 xl:px-5">
          {metricCards.map((card) => {
            const Icon = card.icon;

            return (
              <article
                key={card.label}
                className={cn(
                   "rounded-[16px] border border-border/60 bg-gradient-to-br p-2.5 shadow-sm",
                   card.accent,
                 )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                     <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                       {card.value}
                     </p>
                  </div>
                   <div className="rounded-2xl border border-white/70 bg-white/80 p-1.5 shadow-sm">
                     <Icon className="size-4" />
                   </div>
                 </div>
                 <p className="mt-1.5 line-clamp-1 text-[11px] text-muted-foreground">{card.hint}</p>
               </article>
             );
           })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border/60 px-4 py-2 xl:px-5">
          <div className="flex flex-wrap items-center gap-4">
            {topTabs.map((tab, index) => {
              const Icon = tab.icon;

              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                     "inline-flex items-center gap-2 border-b-2 pb-1.5 text-sm font-medium transition-colors",
                    index === 0
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button className="inline-flex h-8 items-center gap-2 rounded-xl border border-border/70 bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted/40">
            视图选项
          </button>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden pb-[5.5rem] xl:grid-cols-[minmax(0,1fr)_292px] 2xl:grid-cols-[minmax(0,1fr)_308px]">
        <main
          className={cn(
            "min-h-0 space-y-4 overflow-y-auto pr-1 xl:grid xl:grid-rows-[minmax(0,1.08fr)_minmax(0,0.98fr)_minmax(0,0.74fr)] xl:gap-4 xl:space-y-0 xl:overflow-hidden",
            isComposerExpanded ? "pb-[22rem] xl:pb-0" : "pb-0",
          )}
        >
          <div className="grid min-h-0 gap-4 xl:h-full xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.78fr)]">
            <SectionFrame
              title="1. 当前可执行路径"
              className="min-h-0 max-h-[360px] xl:h-full xl:max-h-none"
              actions={
                <div className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-sm text-muted-foreground">
                  {completedCount}/{nodeCount} completed
                </div>
              }
              bodyClassName="overflow-hidden"
            >
              <TaskPlanGraph mode="compact" maxViewportHeight={300} plan={data.taskPlan} />
            </SectionFrame>

            <SectionFrame
              title="2. 计划节点状态"
              className="min-h-0 max-h-[360px] xl:h-full xl:max-h-none"
              bodyClassName="overflow-hidden"
            >
              <TaskPlanGraph mode="full" maxViewportHeight={300} plan={data.taskPlan} />
            </SectionFrame>
          </div>

          <div className="grid min-h-0 gap-4 xl:h-full xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <SectionFrame title="3. 主 Session / 执行流" className="min-h-0 max-h-[320px] xl:h-full xl:max-h-none" bodyClassName="overflow-auto pr-1">
              <ExecutionTimeline
                title="主 Session / 执行流"
                events={data.workstreamItems}
                currentRunId={currentRun?.id ?? null}
              />
            </SectionFrame>

            <div className="min-h-0 max-h-[320px] overflow-hidden rounded-[24px] xl:h-full xl:max-h-none">
              <LatestResultPanel
                output={data.latestOutput}
                updatedLabel={copy.updated}
                emptyTitle={copy.resultEmptyTitle}
                emptyDescription={copy.resultEmptyDescription}
                previewTitle={copy.resultPreviewTitle}
                previewItems={[
                  copy.resultPreviewUnderstanding,
                  copy.resultPreviewPlan,
                  copy.resultPreviewDraft,
                  copy.resultPreviewQuestions,
                ]}
                labels={{
                  ariaLabel: copy.latestResultAria,
                  eyebrow: "最新输出",
                  usedByNextAction: copy.usedByNextAction,
                  actionsTitle: copy.resultActionsTitle,
                }}
              />
            </div>
          </div>

          <div className="grid min-h-0 gap-4 xl:h-full xl:grid-cols-1">
            <SectionFrame title="4. 主动子任务 / Child Sessions" className="min-h-0 max-h-[220px] xl:h-full xl:max-h-none" bodyClassName="overflow-auto">
              <div className="overflow-hidden rounded-[20px] border border-border/60 bg-background">
                <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Session / 任务</span>
                  <span>关联节点</span>
                  <span>运行状态</span>
                </div>
                <ul className="divide-y divide-border/50 text-sm">
                  {visibleChildSteps.map((step) => {
                    const status = getNodeViewStatus(step, data.planExecution);
                    const meta = getNodeStatusMeta(status, copy);

                    return (
                      <li key={step.id} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] gap-3 px-4 py-3">
                        <div>
                          <p className="font-medium text-foreground">{step.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{step.objective || step.id}</p>
                        </div>
                        <div className="text-muted-foreground">{step.id}</div>
                        <div className="justify-self-end">
                          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {hasMoreChildSteps ? (
                <details className="mt-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                  <summary className="cursor-pointer list-none font-medium text-foreground">查看其余 {data.taskPlan.steps.length - visibleChildSteps.length} 个子任务</summary>
                  <div className="mt-3 space-y-2">
                    {data.taskPlan.steps.slice(visibleChildSteps.length).map((step) => {
                      const status = getNodeViewStatus(step, data.planExecution);
                      const meta = getNodeStatusMeta(status, copy);

                      return (
                        <div key={step.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{step.title}</p>
                            <p className="truncate text-xs text-muted-foreground">{step.id}</p>
                          </div>
                          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ) : null}
            </SectionFrame>
          </div>
        </main>

        <aside className="min-h-0 space-y-4 overflow-y-auto pr-1 xl:flex xl:flex-col xl:gap-4 xl:space-y-0 xl:self-stretch xl:overflow-hidden">
          <SectionFrame title="Replan Proposal" className="min-h-0 max-h-[144px] xl:flex-[0.62] xl:max-h-none" bodyClassName="overflow-auto">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-6 text-muted-foreground">{suggestedAction}</p>
              <StatusBadge tone="info">低风险</StatusBadge>
            </div>
          </SectionFrame>

          <SectionFrame title="运行健康度" className="min-h-0 max-h-[200px] xl:flex-[0.94] xl:max-h-none" bodyClassName="overflow-auto">
            <div className="space-y-3 text-sm">
              {[
                {
                  label: copy.lastSyncedLabel,
                  value: data.reliability.lastSyncedAt
                    ? formatDateTime(data.reliability.lastSyncedAt)
                    : copy.noValue,
                },
                {
                  label: "Backend 状态",
                  value: data.reliability.stopReason ? "Attention" : "Healthy",
                },
                {
                  label: "Runtime 状态",
                  value: data.reliability.isStale ? copy.staleSync : copy.healthySync,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <span>{item.label}</span>
                  </div>
                  <span className="font-medium text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
            <details className="mt-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
              <summary className="cursor-pointer list-none font-medium text-foreground">查看详细状态</summary>
              <p className="mt-2 leading-6 text-muted-foreground">{riskSummary || syncLabel}</p>
            </details>
          </SectionFrame>

          <SectionFrame title="计划摘要" className="min-h-0 max-h-[188px] xl:flex-[0.86] xl:max-h-none" bodyClassName="overflow-auto">
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                  <span>Revision</span>
                  <span className="font-medium text-foreground">{data.taskPlan.revision ?? copy.noValue}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                  <span>当前节点</span>
                  <span className="font-medium text-foreground">{data.planExecution?.currentNodeId ?? copy.noValue}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                  <span>需关注节点</span>
                  <span className="font-medium text-foreground">{waitingCount}</span>
                </div>
              </div>
              {data.taskPlan.summary || data.taskPlan.changeSummary ? (
                <details className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
                  <summary className="cursor-pointer list-none font-medium text-foreground">展开计划说明</summary>
                  {data.taskPlan.summary ? <p className="mt-2">{data.taskPlan.summary}</p> : null}
                  {data.taskPlan.changeSummary ? <p className="mt-2">{data.taskPlan.changeSummary}</p> : null}
                </details>
              ) : null}
            </div>
          </SectionFrame>

          {rightRailSummary ? (
            <section className="min-h-0 max-h-[132px] overflow-auto rounded-[22px] border border-amber-200/70 bg-amber-50/80 p-4 shadow-[0_14px_32px_rgba(245,158,11,0.08)] xl:flex-[0.58] xl:max-h-none">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-white p-2 text-amber-600 shadow-sm">
                  <Clock3 className="size-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-amber-950">补充提醒</h3>
                  <p className="mt-2 text-sm leading-6 text-amber-900/80">{rightRailSummary}</p>
                </div>
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      <div className="pointer-events-none fixed bottom-3 left-4 right-4 z-40 xl:left-[268px] xl:right-7">
        <div className="mx-auto w-full max-w-[1180px]">
          {isComposerExpanded ? (
            <div className="pointer-events-auto rounded-[26px] border border-border/80 bg-white/96 p-3 shadow-[0_24px_70px_rgba(15,23,42,0.16)] supports-[backdrop-filter]:backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">需要人工输入</p>
                  <p className="truncate text-xs text-muted-foreground">{dockSummary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsComposerExpanded(false)}
                  className="inline-flex h-8 items-center gap-1 rounded-xl border border-border/70 bg-background px-3 text-sm text-muted-foreground hover:bg-muted/40"
                >
                  收起
                  <ChevronDown className="size-4" />
                </button>
              </div>
              <WorkbenchComposerCard
                className="border-border/80 bg-white shadow-none"
                composer={workbenchComposer}
                currentIntervention={data.currentIntervention}
                currentStepTitle={currentPlanStep?.title ?? null}
                composerValue={composerValue}
                onComposerChange={setComposerValue}
                onSubmit={submitWorkbenchInput}
                quickPrompts={quickPrompts}
                errorMessage={heroErrorMessage}
                isPending={isPending}
                passiveDescription={passiveHeroGuidance.description}
                passiveActions={passiveHeroGuidance.actions}
                copy={copy}
                composerResetKey={composerResetKey}
                runId={currentRun?.id ?? null}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsComposerExpanded(true)}
              className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-[22px] border border-border/80 bg-white/96 px-4 py-3 text-left shadow-[0_18px_40px_rgba(15,23,42,0.14)] supports-[backdrop-filter]:backdrop-blur"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">需要人工输入</p>
                  <StatusBadge tone={workbenchComposer ? "warning" : "info"}>{workbenchComposer ? "待处理" : "待命"}</StatusBadge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{dockSummary}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border/70 bg-background px-3 py-1.5 text-sm text-muted-foreground">
                展开
                <ChevronUp className="size-4" />
              </span>
            </button>
          )}
        </div>
      </div>

      {executionStatus === "no_plan" ? (
        <section className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          当前无计划。请先创建或接受计划，再开始执行。
        </section>
      ) : null}
    </div>
  );
}

export { parseDateInputForSubmission };
