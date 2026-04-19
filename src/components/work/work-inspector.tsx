"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";

const sections = ["plan", "approvals", "artifacts", "tools", "context"] as const;

type InspectorSection = (typeof sections)[number];
type StepStatus = "pending" | "in_progress" | "waiting_for_user" | "done" | "blocked";
type PlanStep = WorkInspectorProps["plan"]["steps"][number];

type WorkInspectorProps = {
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
      status: StepStatus;
      needsUserInput: boolean;
      type?: string;
      linkedTaskId?: string | null;
      executionMode?: string | null;
      estimatedMinutes?: number | null;
      priority?: string | null;
    }>;
  };
  currentAction?: { label: string; href: string } | null;
  currentException?: string | null;
  isPending?: boolean;
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
  labels: {
    ariaLabel: string;
    sections: Record<InspectorSection, string>;
    emptyValue: string;
    emptyScheduleWindow: string;
    stepStatuses: Record<StepStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" | "critical" }>;
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

export function WorkInspector({
  plan,
  currentAction = null,
  currentException = null,
  isPending = false,
  approvals,
  artifacts,
  toolCalls,
  context,
  labels,
}: WorkInspectorProps) {
  const [activeSection, setActiveSection] = useState<(typeof sections)[number]>("plan");
  const tabRefs = useRef<Record<InspectorSection, HTMLButtonElement | null>>({
    plan: null,
    approvals: null,
    artifacts: null,
    tools: null,
    context: null,
  });
  const currentStep = plan.steps.find((step) => step.id === plan.currentStepId) ?? null;

  function focusSection(nextSection: InspectorSection) {
    setActiveSection(nextSection);
    tabRefs.current[nextSection]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, section: InspectorSection) {
    const sectionIndex = sections.indexOf(section);

    if (sectionIndex === -1) {
      return;
    }

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown": {
        event.preventDefault();
        focusSection(sections[(sectionIndex + 1) % sections.length]);
        return;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        event.preventDefault();
        focusSection(sections[(sectionIndex - 1 + sections.length) % sections.length]);
        return;
      }
      case "Home": {
        event.preventDefault();
        focusSection(sections[0]);
        return;
      }
      case "End": {
        event.preventDefault();
        focusSection(sections[sections.length - 1]);
        return;
      }
      default:
        return;
    }
  }

  return (
    <aside aria-label={labels.ariaLabel} className="space-y-4">
      <section className="rounded-[28px] border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{labels.ariaLabel}</h2>
        <div role="tablist" aria-label={labels.ariaLabel} className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <button
              key={section}
              type="button"
              ref={(node) => {
                tabRefs.current[section] = node;
              }}
              id={`work-inspector-tab-${section}`}
              role="tab"
              aria-selected={activeSection === section}
              aria-controls={`work-inspector-panel-${section}`}
              tabIndex={activeSection === section ? 0 : -1}
              onClick={() => setActiveSection(section)}
              onKeyDown={(event) => handleTabKeyDown(event, section)}
              className={cn(buttonVariants({ variant: activeSection === section ? "secondary" : "ghost", size: "sm" }), "rounded-full")}
            >
              {labels.sections[section]}
            </button>
          ))}
        </div>

        {sections.map((section) => (
          <div
            key={section}
            id={`work-inspector-panel-${section}`}
            role="tabpanel"
            aria-labelledby={`work-inspector-tab-${section}`}
            aria-label={labels.sections[section]}
            hidden={activeSection !== section}
            className="mt-4 rounded-[24px] border border-border/60 bg-background/60 p-4 text-sm"
          >
            {renderSectionPanel(section, {
              plan,
              currentStep,
              currentAction,
              currentException,
              isPending,
              approvals,
              artifacts,
              toolCalls,
              context,
              labels,
            })}
          </div>
        ))}
      </section>
    </aside>
  );
}

function renderSectionPanel(
  section: InspectorSection,
  {
    plan,
    currentStep,
    currentAction,
    currentException,
    isPending,
    approvals,
    artifacts,
    toolCalls,
    context,
    labels,
  }: {
    plan: WorkInspectorProps["plan"];
    currentStep: PlanStep | null;
    currentAction: WorkInspectorProps["currentAction"];
    currentException: WorkInspectorProps["currentException"];
    isPending: boolean;
    approvals: WorkInspectorProps["approvals"];
    artifacts: WorkInspectorProps["artifacts"];
    toolCalls: WorkInspectorProps["toolCalls"];
    context: WorkInspectorProps["context"];
    labels: WorkInspectorProps["labels"];
  },
) {
  if (section === "plan") {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-base font-semibold text-foreground">{labels.planTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan.state === "ready" ? plan.summary ?? labels.planReadySummary : labels.planEmptySummary}
          </p>
        </div>

        {currentException ? <p className="text-xs text-amber-700">{labels.currentBlocker}：{currentException}</p> : null}
        {currentAction ? (
          isInternalAppHref(currentAction.href) ? (
            <LocalizedLink href={currentAction.href} className={buttonVariants({ variant: "default", size: "sm" })}>
              {currentAction.label}
            </LocalizedLink>
          ) : currentAction.href.startsWith("#") ? (
            <a href={currentAction.href} className={buttonVariants({ variant: "default", size: "sm" })}>
              {currentAction.label}
            </a>
          ) : isSafeExternalHref(currentAction.href) ? (
            <a href={currentAction.href} className={buttonVariants({ variant: "default", size: "sm" })}>
              {currentAction.label}
            </a>
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
                <StatusBadge tone="warning">{approval.status}</StatusBadge>
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
                <StatusBadge>{tool.status}</StatusBadge>
              </div>
              {tool.argumentsSummary ? <p className="mt-2 text-muted-foreground">{labels.toolArguments}：{tool.argumentsSummary}</p> : null}
              {tool.resultSummary ? <p className="mt-1 text-muted-foreground">{labels.toolResult}：{tool.resultSummary}</p> : null}
              {tool.errorSummary ? <p className="mt-1 text-red-700">{labels.toolError}：{tool.errorSummary}</p> : null}
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
