import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskPlanGraph, type TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const workInspectorSections = ["plan", "approvals", "artifacts", "tools", "context"] as const;

export type InspectorSection = (typeof workInspectorSections)[number];

type WorkInspectorLabels = {
  ariaLabel: string;
  sections: Record<InspectorSection, string>;
  emptyValue: string;
  emptyScheduleWindow: string;
  stepStatuses: Record<string, { label: string; tone: "outline" | "info" | "success" | "warning" | "critical" }>;
  planTitle: string;
  planReadySummary: string;
  planEmptySummary: string;
  planEmptyTitle: string;
  currentStep: string;
  currentBlocker: string;
  approvalsTitle: string;
  noApprovals: string;
  artifactsTitle: string;
  noArtifacts: string;
  toolsTitle: string;
  noTools: string;
  toolArguments: string;
  toolResult: string;
  toolError: string;
  contextTitle: string;
  priority: string;
  dueAt: string;
  scheduledWindow: string;
  scheduleStatus: string;
  runStatus: string;
  syncStatus: string;
  staleSync: string;
  healthySync: string;
  lastUpdated: string;
  lastSynced: string;
  stopReason: string;
};

export type WorkInspectorSectionContentProps = {
  plan: TaskPlanGraphPlan;
  currentAction?: { label: string; href: string } | null;
  currentException?: string | null;
  approvals: Array<{ id: string; title: string; status: string; summary?: string }>;
  artifacts: Array<{ id: string; title: string; type: string; uri?: string | null; createdAt?: string | null }>;
  toolCalls: Array<{ id: string; toolName: string; status: string; argumentsSummary?: string | null; resultSummary?: string | null; errorSummary?: string | null }>;
  context: {
    priority: string;
    dueAt: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    scheduleStatus: string;
    scheduleSummary: string;
    runStatus: string;
    syncStatus: string | null;
    isStale: boolean;
    lastUpdatedAt: string | null;
    lastSyncedAt: string | null;
    stopReason: string | null;
    blockerSummary: string;
  };
  labels: WorkInspectorLabels;
};

function formatDateTime(value: string | null | undefined, emptyValue: string) {
  return value ? value.slice(0, 16).replace("T", " ") : emptyValue;
}

function formatScheduleWindow(start: string | null | undefined, end: string | null | undefined, emptyScheduleWindow: string) {
  if (start && end) {
    return `${formatDateTime(start, emptyScheduleWindow)} - ${formatDateTime(end, emptyScheduleWindow)}`;
  }

  return emptyScheduleWindow;
}

function isSafeExternalHref(href: string) {
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:";
  } catch {
    return false;
  }
}

function isInternalAppHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

export function renderWorkInspectorSectionPanel(
  section: InspectorSection,
  {
    plan,
    currentAction,
    currentException,
    approvals,
    artifacts,
    toolCalls,
    context,
    labels,
  }: WorkInspectorSectionContentProps,
) {
  if (section === "plan") {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-base font-semibold text-foreground">{labels.planTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan.state === "ready" ? plan.graphSummary ?? labels.planReadySummary : labels.planEmptySummary}
          </p>
        </div>

        {currentException ? <p className="text-xs text-warning-foreground">{labels.currentBlocker}：{currentException}</p> : null}
        {currentAction ? (
          isInternalAppHref(currentAction.href) ? (
            <Button asChild>
              <LocalizedLink href={currentAction.href}>{currentAction.label}</LocalizedLink>
            </Button>
          ) : currentAction.href.startsWith("#") ? (
            <Button asChild>
              <a href={currentAction.href}>{currentAction.label}</a>
            </Button>
          ) : isSafeExternalHref(currentAction.href) ? (
            <Button asChild>
              <a href={currentAction.href}>{currentAction.label}</a>
            </Button>
          ) : null
        ) : null}

        {plan.state === "empty" ? (
          <div className="rounded-[22px] border border-dashed border-border/70 bg-background/70 p-4">
            <p className="font-medium text-foreground">{labels.planEmptyTitle}</p>
          </div>
        ) : (
          <TaskPlanGraph plan={plan} />
        )}
      </div>
    );
  }

  if (section === "approvals") {
    return (
      <div className="space-y-3">
        <p className="text-base font-semibold text-foreground">{labels.approvalsTitle}</p>
        {approvals.length === 0 ? <p className="text-muted-foreground">{labels.noApprovals}</p> : approvals.map((approval) => (
          <div key={approval.id} className="rounded-[22px] border border-border/60 bg-background/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">{approval.title}</p>
              <Badge variant="secondary">{approval.status}</Badge>
            </div>
            {approval.summary ? <p className="mt-2 text-muted-foreground">{approval.summary}</p> : null}
          </div>
        ))}
      </div>
    );
  }

  if (section === "artifacts") {
    return (
      <div className="space-y-3">
        <p className="text-base font-semibold text-foreground">{labels.artifactsTitle}</p>
        {artifacts.length === 0 ? <p className="text-muted-foreground">{labels.noArtifacts}</p> : artifacts.map((artifact) => (
          <div key={artifact.id} className="rounded-[22px] border border-border/60 bg-background/70 p-4">
            {artifact.uri && isInternalAppHref(artifact.uri) ? (
              <LocalizedLink href={artifact.uri} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:text-primary">
                {artifact.title}
              </LocalizedLink>
            ) : artifact.uri && isSafeExternalHref(artifact.uri) ? (
              <a href={artifact.uri} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:text-primary">
                {artifact.title}
              </a>
            ) : (
              <p className="font-medium text-foreground">{artifact.title}</p>
            )}
            <p className="mt-1 text-muted-foreground">{artifact.type}</p>
          </div>
        ))}
      </div>
    );
  }

  if (section === "tools") {
    return (
      <div className="space-y-3">
        <p className="text-base font-semibold text-foreground">{labels.toolsTitle}</p>
        {toolCalls.length === 0 ? <p className="text-muted-foreground">{labels.noTools}</p> : toolCalls.map((tool) => (
          <div key={tool.id} className="rounded-[22px] border border-border/60 bg-background/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">{tool.toolName}</p>
              <Badge>{tool.status}</Badge>
            </div>
            {tool.argumentsSummary ? <p className="mt-2 text-muted-foreground">{labels.toolArguments}：{tool.argumentsSummary}</p> : null}
            {tool.resultSummary ? <p className="mt-1 text-muted-foreground">{labels.toolResult}：{tool.resultSummary}</p> : null}
            {tool.errorSummary ? <p className="mt-1 text-destructive">{labels.toolError}：{tool.errorSummary}</p> : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-muted-foreground">
      <p className="text-base font-semibold text-foreground">{labels.contextTitle}</p>
      <div className="rounded-[22px] border border-border/60 bg-background/70 p-4">
        <p><span className="text-foreground">{labels.priority}：</span>{context.priority}</p>
        <p className="mt-1"><span className="text-foreground">{labels.dueAt}：</span>{formatDateTime(context.dueAt, labels.emptyValue)}</p>
        <p className="mt-1"><span className="text-foreground">{labels.scheduledWindow}：</span>{formatScheduleWindow(context.scheduledStartAt, context.scheduledEndAt, labels.emptyScheduleWindow)}</p>
        <p className="mt-1"><span className="text-foreground">{labels.scheduleStatus}：</span>{context.scheduleStatus}</p>
        <p className="mt-2 text-xs">{context.scheduleSummary}</p>
      </div>
      <div className="rounded-[22px] border border-border/60 bg-background/70 p-4">
        <p><span className="text-foreground">{labels.runStatus}：</span>{context.runStatus}</p>
        <p className="mt-1"><span className="text-foreground">{labels.syncStatus}：</span>{context.isStale ? labels.staleSync : (context.syncStatus ?? labels.healthySync)}</p>
        <p className="mt-1"><span className="text-foreground">{labels.lastUpdated}：</span>{formatDateTime(context.lastUpdatedAt, labels.emptyValue)}</p>
        {context.lastSyncedAt ? <p className="mt-1"><span className="text-foreground">{labels.lastSynced}：</span>{formatDateTime(context.lastSyncedAt, labels.emptyValue)}</p> : null}
        {context.stopReason ? <p className="mt-1"><span className="text-foreground">{labels.stopReason}：</span>{context.stopReason}</p> : null}
        <p className="mt-2 text-xs">{context.blockerSummary}</p>
      </div>
    </div>
  );
}
