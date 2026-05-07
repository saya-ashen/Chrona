"use client";

import type { ReactNode } from "react";
import { WandSparkles, X } from "lucide-react";
import { TaskPlanGenerationPanel } from "@/components/task/ai/task-plan-generation-panel";
import type { TaskConfigFormDraft } from "@/components/schedule/task-config-form";
import { TaskWorkspaceAssistant } from "@/components/tasks/task-workspace-assistant";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { TaskPlanReadModel, TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";
import { cn } from "@/lib/utils";

type AssistantCurrentTask = {
  title: string;
  description: string | null;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
  status: string;
};

type AssistantCurrentPlan = {
  id: string;
  status: string;
  revision: number;
  summary: string | null;
  nodes: Array<{
    id: string;
    title: string;
    objective: string;
    description: string | null;
    status: string;
    estimatedMinutes: number | null;
    priority: string | null;
    executionMode: string;
    dependsOn: string[];
  }>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    type: string;
  }>;
} | null;

type TaskAiWorkspacePanelProps = {
  taskId: string;
  planningTaskDraft: TaskConfigFormDraft;
  savedPlan: TaskPlanReadModel | null;
  generationStatus: "idle" | "generating" | "waiting_acceptance" | "accepted";
  acceptedPlanId: string | null;
  hasUnsavedConfigChanges: boolean;
  unsavedConfigDraft: TaskConfigFormDraft | null;
  onPlanLoaded: (savedPlan: TaskPlanReadModel | null) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onSaveConfigBeforeRegenerate: () => Promise<void>;
  buildCurrentTask: () => AssistantCurrentTask;
  buildCurrentPlan: () => AssistantCurrentPlan;
  onProposal: (proposal: TaskWorkspaceUpdateProposal) => void;
  onApplyProposal?: (proposal: TaskWorkspaceUpdateProposal, messageId: string) => Promise<void>;
  onDismissProposal?: () => void;
  isApplying?: boolean;
  requestGenerationKey?: number;
  showInlineGenerateButton?: boolean;
  emptyPlanDescription?: string;
  onClose?: () => void;
  headerActions?: ReactNode;
  className?: string;
};

export function TaskAiWorkspacePanel({
  taskId,
  planningTaskDraft,
  savedPlan,
  generationStatus,
  acceptedPlanId,
  hasUnsavedConfigChanges,
  unsavedConfigDraft,
  onPlanLoaded,
  onApplyPlan,
  onSaveConfigBeforeRegenerate,
  buildCurrentTask,
  buildCurrentPlan,
  onProposal,
  onApplyProposal,
  onDismissProposal,
  isApplying,
  requestGenerationKey,
  showInlineGenerateButton = true,
  emptyPlanDescription,
  onClose,
  headerActions,
  className,
}: TaskAiWorkspacePanelProps) {
  return (
    <SurfaceCard
      as="section"
      variant="inset"
      padding="sm"
      className={cn(
        "flex h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-[1.35rem] border border-border/50 bg-background/65 shadow-none",
        className,
      )}
    >
      <div className="border-b border-border/50 bg-[linear-gradient(180deg,hsl(var(--muted)/0.2),transparent)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-8 min-w-8 items-center justify-center rounded-[0.85rem] bg-primary/8 px-2 text-primary ring-1 ring-primary/10">
              <WandSparkles className="size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">AI workspace</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Plan, revise, and apply task changes from one thread.
              </p>
            </div>
          </div>
          {headerActions ?? (onClose ? (
            <button
              type="button"
              onClick={onClose}
              className={buttonVariants({ variant: "ghost", size: "sm", className: "size-8 rounded-lg p-0" })}
              aria-label="Close AI workspace"
            >
              <X className="size-4" />
            </button>
          ) : null)}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <TaskWorkspaceAssistant
          embedded
          className="h-full"
          taskId={taskId}
          buildCurrentTask={buildCurrentTask}
          buildCurrentPlan={buildCurrentPlan}
          onProposal={onProposal}
          onApply={onApplyProposal}
          onDismiss={onDismissProposal}
          isApplying={isApplying}
          inputPlaceholder="Ask AI to plan, revise, or update this task..."
          leadingContent={(
            <TaskPlanGenerationPanel
              taskId={taskId}
              title={planningTaskDraft.title}
              description={planningTaskDraft.description}
              priority={planningTaskDraft.priority}
              dueAt={planningTaskDraft.dueAt}
              autoRequest={false}
              savedPlan={savedPlan}
              generationStatus={generationStatus}
              onPlanLoaded={onPlanLoaded}
              onApply={onApplyPlan}
              activeAcceptedPlanId={acceptedPlanId}
              hasUnsavedConfigChanges={hasUnsavedConfigChanges}
              unsavedConfigDraft={unsavedConfigDraft}
              onSaveConfigBeforeRegenerate={onSaveConfigBeforeRegenerate}
              showGraph={false}
              requestGenerationKey={requestGenerationKey}
              showEmptyGenerateButton={showInlineGenerateButton}
              emptyStateDescription={emptyPlanDescription}
            />
          )}
        />
      </div>
    </SurfaceCard>
  );
}
