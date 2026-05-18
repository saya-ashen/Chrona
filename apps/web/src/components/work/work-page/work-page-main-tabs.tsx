import { Activity, AlertTriangle, CheckCircle2, Clock3, GitBranch, Sparkles, type LucideIcon } from "lucide-react";
import { LatestResultPanel } from "@/components/work/latest-result-panel";
import { TaskPlanGraph } from "@/components/tasks/plan/task-plan-graph";
import { buttonVariants } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { formatDateTime } from "./work-page-formatters";
import { WorkPageSectionFrame } from "./work-page-section-frame";
import type { WorkCopy, WorkPageData } from "./work-page-types";

type NodeViewStatus = "completed" | "running" | "waiting" | "blocked" | "pending";

function getNodeViewStatus(
  step: WorkPageData["taskPlan"]["nodes"][number],
  planExecution: WorkPageData["planExecution"],
): NodeViewStatus {
  if (planExecution?.executedNodeIds.includes(step.id) || step.status === "done" || step.status === "skipped") return "completed";
  if (planExecution?.currentNodeId === step.id || step.status === "active") return "running";
  if (planExecution?.waitingNodeIds.includes(step.id) || step.status === "waiting") return "waiting";
  if (planExecution?.blockedNodeIds.includes(step.id) || step.status === "blocked") return "blocked";
  return "pending";
}

function getNodeStatusMeta(status: NodeViewStatus, copy: WorkCopy) {
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

function getNodeStatusClassName(status: NodeViewStatus) {
  switch (status) {
    case "completed":
      return "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
    case "running":
      return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
    case "waiting":
      return "border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100";
    case "blocked":
      return "border-rose-300/25 bg-rose-300/10 text-rose-100";
    default:
      return "border-white/10 bg-white/[0.055] text-slate-300";
  }
}

const bottomTabs = [
  { id: "latest", label: "Latest Output", icon: CheckCircle2 },
  { id: "plan", label: "Task Plan", icon: GitBranch },
  { id: "timeline", label: "Execution Record", icon: Activity },
  { id: "info", label: "Details", icon: Sparkles },
] as const;

type WorkPageMainTabsProps = {
  data: WorkPageData;
  copy: WorkCopy;
  currentRunId: string | null;
  activeTab: (typeof bottomTabs)[number]["id"];
  onTabChange: (tab: (typeof bottomTabs)[number]["id"]) => void;
  completedCount: number;
  nodeCount: number;
  waitingCount: number;
};

export function WorkPageMainTabs({
  data,
  copy,
  currentRunId,
  activeTab,
  onTabChange,
  completedCount,
  nodeCount,
  waitingCount,
}: WorkPageMainTabsProps) {
  return (
    <main className="min-h-0 space-y-4 overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
        {bottomTabs.map((tab) => {
          const Icon: LucideIcon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
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

      {activeTab === "latest" ? (
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
      ) : null}

      {activeTab === "plan" ? (
        <div className="min-h-0 overflow-auto">
          <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 p-4 text-slate-100 shadow-[0_28px_90px_rgba(2,6,23,0.34)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_16%_0%,rgba(34,211,238,0.20),transparent_38%),radial-gradient(circle_at_82%_4%,rgba(168,85,247,0.18),transparent_36%)]" />
            <header className="relative flex flex-col gap-4 pb-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/85">
                  <GitBranch className="size-3.5" />
                  Task Plan Console
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                  Current Plan - {completedCount}/{nodeCount} completed
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                  Live graph, current execution focus, and blocking nodes in one operational surface.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                {[
                  { label: "Done", value: completedCount, icon: CheckCircle2, className: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" },
                  { label: "Need attention", value: waitingCount, icon: AlertTriangle, className: "border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100" },
                  { label: "Total", value: nodeCount, icon: Clock3, className: "border-white/10 bg-white/[0.055] text-slate-200" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className={`rounded-2xl border px-3 py-2 shadow-[0_12px_34px_rgba(2,6,23,0.18)] ${item.className}`}>
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-80">
                        <Icon className="size-3" />
                        {item.label}
                      </div>
                      <p className="mt-1 text-lg font-semibold">{item.value}</p>
                    </div>
                  );
                })}
              </div>
            </header>

            <div className="relative grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="h-[500px] min-h-0 overflow-hidden rounded-[28px] xl:h-[620px]">
                <TaskPlanGraph mode="full" fillHeight plan={data.taskPlan} />
              </div>
              <aside className="min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] shadow-[0_18px_58px_rgba(2,6,23,0.22)]">
                <div className="border-b border-white/10 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/85">Plan Nodes</p>
                  <p className="mt-1 text-xs text-slate-500">Execution order, node identity, and current state.</p>
                </div>
                <ul className="max-h-[620px] divide-y divide-white/10 overflow-auto p-2 text-sm">
                  {data.taskPlan.nodes.map((step) => {
                    const status = getNodeViewStatus(step, data.planExecution);
                    const meta = getNodeStatusMeta(status, copy);
                    return (
                      <li key={step.id} className="rounded-2xl px-3 py-3 transition hover:bg-white/[0.055]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words font-medium text-white">{step.title}</p>
                            <p className="mt-1 line-clamp-2 break-words text-xs text-slate-400">{step.summary || step.id}</p>
                            <p className="mt-2 break-all text-[10px] font-medium uppercase tracking-[0.12em] text-slate-600">{step.id}</p>
                          </div>
                          <div className="shrink-0">
                            <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${getNodeStatusClassName(status)}`}>
                              {meta.label}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </aside>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "timeline" ? (
        <div className="min-h-0 overflow-auto">
          <ExecutionTimeline title="Execution Record" events={data.workstreamItems} currentRunId={currentRunId} />
        </div>
      ) : null}

      {activeTab === "info" ? (
        <div className="min-h-0 overflow-auto space-y-4">
          <WorkPageSectionFrame title="Run Health" bodyClassName="overflow-auto">
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
          </WorkPageSectionFrame>
          <WorkPageSectionFrame title="Plan Summary" bodyClassName="overflow-auto">
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
          </WorkPageSectionFrame>
        </div>
      ) : null}
    </main>
  );
}
