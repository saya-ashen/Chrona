"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph";
import {
  renderWorkInspectorSectionPanel,
  workInspectorSections as sections,
  type InspectorSection,
} from "./work-inspector-sections";

type WorkInspectorProps = {
  plan: TaskPlanGraphPlan;
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
    stepStatuses: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "critical" }>;
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

export function WorkInspector({
  plan,
  currentAction = null,
  currentException = null,
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
            {renderWorkInspectorSectionPanel(section, {
              plan,
              currentAction,
              currentException,
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
