import { Activity, CheckCircle2, GitBranch, Sparkles, type LucideIcon } from "lucide-react";
import { LatestResultPanel } from "@/components/work/latest-result-panel";
import { TaskPlanGraph } from "@/components/task/plan/task-plan-graph";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { formatDateTime } from "./work-page-formatters";
import { WorkPageSectionFrame } from "./work-page-section-frame";
import type { WorkbenchCopy, WorkPageData } from "./work-page-types";

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

const bottomTabs = [
  { id: "latest", label: "Latest Output", icon: CheckCircle2 },
  { id: "plan", label: "Task Plan", icon: GitBranch },
  { id: "timeline", label: "Execution Record", icon: Activity },
  { id: "info", label: "Details", icon: Sparkles },
] as const;

type WorkPageMainTabsProps = {
  data: WorkPageData;
  copy: WorkbenchCopy;
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
        <div className="min-h-0 overflow-auto space-y-4">
          <details open className="overflow-hidden rounded-[24px] border border-border/70 bg-card shadow-[0_14px_36px_rgba(15,23,42,0.05)]">
            <summary className="cursor-pointer list-none p-4 font-semibold text-foreground">
              Current Plan - {completedCount}/{nodeCount} completed
            </summary>
            <div className="h-[420px] overflow-hidden px-4 pb-4 xl:h-[520px]">
              <TaskPlanGraph mode="full" maxViewportHeight={520} plan={data.taskPlan} />
            </div>
          </details>
          <WorkPageSectionFrame title="Plan Nodes" className="min-h-0" bodyClassName="overflow-auto">
            <div className="overflow-hidden rounded-[20px] border border-border/60 bg-background">
              <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                <span>Step</span>
                <span>Node ID</span>
                <span>Status</span>
              </div>
              <ul className="divide-y divide-border/50 text-sm">
                {data.taskPlan.nodes.map((step) => {
                  const status = getNodeViewStatus(step, data.planExecution);
                  const meta = getNodeStatusMeta(status, copy);
                  return (
                    <li key={step.id} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] gap-3 px-4 py-3">
                      <div>
                        <p className="font-medium text-foreground">{step.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{step.summary || step.id}</p>
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
          </WorkPageSectionFrame>
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
