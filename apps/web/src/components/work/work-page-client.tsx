"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock3,
  Ellipsis,
  GitBranch,
  Sparkles,
} from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
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
  const dockSummary =
    data.currentIntervention?.actionLabel ??
    currentPlanStep?.title ??
    workbenchComposer?.statusHint ??
    passiveHeroGuidance.description;

  const [activeTab, setActiveTab] = useState<"latest" | "plan" | "timeline" | "info">("latest");
  const bottomTabs = [
    { id: "latest", label: "Latest Output", icon: CheckCircle2 },
    { id: "plan", label: "Task Plan", icon: GitBranch },
    { id: "timeline", label: "Execution Record", icon: Activity },
    { id: "info", label: "Details", icon: Sparkles },
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <section className="shrink-0 overflow-hidden rounded-[22px] border border-border/70 bg-card shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
        <div className="px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">
                {data.taskShell.title} / Workbench
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-[1.35rem]">
                  {data.taskShell.title}
                </h1>
                <StatusBadge tone={getExecutionTone(executionStatus)}>{executionStatus}</StatusBadge>
                <StatusBadge tone={data.reliability.isStale ? "warning" : "info"}>{syncLabel}</StatusBadge>
              </div>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground sm:text-sm">
                {passiveHeroGuidance.description || taskSummary}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <LocalizedLink
                href="/schedule"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40"
              >
                <CalendarDays className="size-4" />
                Schedule
              </LocalizedLink>
              <LocalizedLink
                href={`/workspaces/${data.taskShell.workspaceId}/tasks/${data.taskShell.id}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40"
              >
                Details
              </LocalizedLink>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-background text-muted-foreground hover:bg-muted/40">
                <Ellipsis className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden pb-[5.5rem] xl:grid-cols-[minmax(0,1fr)_292px] 2xl:grid-cols-[minmax(0,1fr)_308px]">
        <main className="min-h-0 space-y-4 overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
            {bottomTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={
                    activeTab === tab.id
                      ? buttonVariants({ variant: "default", size: "sm", className: "rounded-xl" })
                      : buttonVariants({ variant: "ghost", size: "sm", className: "rounded-xl" })
                  }
                >
                  <Icon className="size-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === "latest" && (
            <div className="min-h-0 overflow-auto">
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
                  eyebrow: "Latest Output",
                  usedByNextAction: copy.usedByNextAction,
                  actionsTitle: copy.resultActionsTitle,
                }}
              />
            </div>
          )}

          {activeTab === "plan" && (
            <div className="min-h-0 overflow-auto space-y-4">
              <details open className="overflow-hidden rounded-[24px] border border-border/70 bg-card shadow-[0_14px_36px_rgba(15,23,42,0.05)]">
                <summary className="cursor-pointer list-none p-4 font-semibold text-foreground">
                  Current Plan — {completedCount}/{nodeCount} completed
                </summary>
                <div className="h-[420px] overflow-hidden px-4 pb-4 xl:h-[520px]">
                  <TaskPlanGraph mode="full" maxViewportHeight={520} plan={data.taskPlan} />
                </div>
              </details>
              <SectionFrame title="Plan Nodes" className="min-h-0" bodyClassName="overflow-auto">
                <div className="overflow-hidden rounded-[20px] border border-border/60 bg-background">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    <span>Step</span>
                    <span>Node ID</span>
                    <span>Status</span>
                  </div>
                  <ul className="divide-y divide-border/50 text-sm">
                    {data.taskPlan.steps.map((step) => {
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
              </SectionFrame>
            </div>
          )}

          {activeTab === "timeline" && (
            <div className="min-h-0 overflow-auto">
              <ExecutionTimeline
                title="Execution Record"
                events={data.workstreamItems}
                currentRunId={currentRun?.id ?? null}
              />
            </div>
          )}

          {activeTab === "info" && (
            <div className="min-h-0 overflow-auto space-y-4">
              <SectionFrame title="Run Health" bodyClassName="overflow-auto">
                <div className="space-y-3 text-sm">
                  {[
                    { label: copy.lastSyncedLabel, value: data.reliability.lastSyncedAt ? formatDateTime(data.reliability.lastSyncedAt) : copy.noValue },
                    { label: "Backend", value: data.reliability.stopReason ? "Attention" : "Healthy" },
                    { label: "Runtime", value: data.reliability.isStale ? copy.staleSync : copy.healthySync },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              </SectionFrame>
              <SectionFrame title="Plan Summary" bodyClassName="overflow-auto">
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                    <span>Revision</span>
                    <span className="font-medium text-foreground">{data.taskPlan.revision ?? copy.noValue}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                    <span>Current Node</span>
                    <span className="font-medium text-foreground">{data.planExecution?.currentNodeId ?? copy.noValue}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                    <span>Need Attention</span>
                    <span className="font-medium text-foreground">{waitingCount}</span>
                  </div>
                </div>
              </SectionFrame>
            </div>
          )}
        </main>

        <aside className="min-h-0 space-y-4 overflow-y-auto pr-1 xl:flex xl:flex-col xl:gap-4 xl:space-y-0 xl:self-stretch xl:overflow-hidden">
          <SectionFrame title="Quick Actions" bodyClassName="overflow-auto">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-6 text-muted-foreground">{suggestedAction}</p>
              <StatusBadge tone="info">OK</StatusBadge>
            </div>
          </SectionFrame>

          <SectionFrame title="Sync Status" bodyClassName="overflow-auto">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  <span>{copy.syncStatusLabel}</span>
                </div>
                <span className="font-medium text-foreground">{syncLabel}</span>
              </div>
            </div>
            {riskSummary ? (
              <details className="mt-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                <summary className="cursor-pointer list-none font-medium text-foreground">Details</summary>
                <p className="mt-2 leading-6">{riskSummary}</p>
              </details>
            ) : null}
          </SectionFrame>

          {rightRailSummary && rightRailSummary !== copy.noBlockingAction ? (
            <section className="shrink-0 rounded-[22px] border border-amber-200/70 bg-amber-50/80 p-4 shadow-[0_14px_32px_rgba(245,158,11,0.08)]">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-white p-2 text-amber-600 shadow-sm">
                  <Clock3 className="size-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-amber-950">Heads Up</h3>
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
                  <p className="text-sm font-semibold text-foreground">Add Input</p>
                  <p className="truncate text-xs text-muted-foreground">{dockSummary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsComposerExpanded(false)}
                  className="inline-flex h-8 items-center gap-1 rounded-xl border border-border/70 bg-background px-3 text-sm text-muted-foreground hover:bg-muted/40"
                >
                  Collapse
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
                  <p className="text-sm font-semibold text-foreground">Add Input</p>
                  <StatusBadge tone={workbenchComposer ? "warning" : "info"}>{workbenchComposer ? "Needed" : "Standby"}</StatusBadge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{dockSummary}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border/70 bg-background px-3 py-1.5 text-sm text-muted-foreground">
                Expand
                <ChevronUp className="size-4" />
              </span>
            </button>
          )}
        </div>
      </div>

      {executionStatus === "no_plan" ? (
        <section className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No plan yet. Create or accept a plan before execution.
        </section>
      ) : null}
    </div>
  );
}

export { parseDateInputForSubmission };
