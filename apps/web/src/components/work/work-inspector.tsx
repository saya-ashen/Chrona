"use client";

import { useState } from "react";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  return (
    <aside aria-label={labels.ariaLabel} className="space-y-4">
      <section className="rounded-[28px] border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{labels.ariaLabel}</h2>
        <Tabs value={activeSection} onValueChange={(value) => setActiveSection(value as InspectorSection)} className="mt-3 gap-0">
          <TabsList aria-label={labels.ariaLabel} className="flex h-auto flex-wrap gap-2 bg-transparent p-0">
            {sections.map((section) => (
              <TabsTrigger key={section} value={section} className="flex-none rounded-full px-3 py-1.5 text-xs" onClick={() => setActiveSection(section)}>
                {labels.sections[section]}
              </TabsTrigger>
            ))}
          </TabsList>

          {sections.map((section) => (
            <TabsContent key={section} value={section} className="mt-4 rounded-[24px] border border-border/60 bg-background/60 p-4 text-sm">
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
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </aside>
  );
}
