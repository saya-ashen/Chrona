"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";

type EditableTask = {
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
};

type Props = {
  proposal: TaskWorkspaceUpdateProposal;
  originalTask: EditableTask;
  onApply: (proposal: TaskWorkspaceUpdateProposal) => void;
  onCancel: () => void;
  isApplying: boolean;
  applyError: string | null;
};

function FieldDiffRow({
  label,
  original,
  proposed,
}: {
  label: string;
  original: string;
  proposed: string;
}) {
  const changed = original !== proposed;
  return (
    <div
      className={cn(
        "grid grid-cols-[120px_1fr_1fr] gap-2 text-xs py-1.5 border-b border-border/30",
        changed && "bg-amber-50/30 -mx-2 px-2",
      )}
    >
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className={cn("text-muted-foreground/70 line-through", changed && "text-red-600/60")}>
        {original || <em>empty</em>}
      </span>
      <span className={cn(changed && "font-medium text-emerald-700")}>
        {proposed || <em>empty</em>}
      </span>
    </div>
  );
}

function formatText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.length > 160 ? value.slice(0, 160) + "..." : value;
  if (typeof value === "object") return JSON.stringify(value).slice(0, 160) + "...";
  return String(value);
}

function computeTaskDiff(taskPatch: NonNullable<TaskWorkspaceUpdateProposal["taskPatch"]>, originalTask: EditableTask) {
  const diffs: Array<{ label: string; key: string; original: string; proposed: string }> = [];
  if (taskPatch.title !== undefined && taskPatch.title !== originalTask.title) {
    diffs.push({ label: "Title", key: "title", original: originalTask.title, proposed: taskPatch.title });
  }
  if (taskPatch.description !== undefined && taskPatch.description !== originalTask.description) {
    diffs.push({
      label: "Description",
      key: "description",
      original: formatText(originalTask.description),
      proposed: formatText(taskPatch.description),
    });
  }
  if (taskPatch.priority !== undefined && taskPatch.priority !== originalTask.priority) {
    diffs.push({ label: "Priority", key: "priority", original: originalTask.priority, proposed: taskPatch.priority });
  }
  if (taskPatch.dueAt !== undefined && taskPatch.dueAt !== originalTask.dueAt) {
    diffs.push({
      label: "Due Date",
      key: "dueAt",
      original: originalTask.dueAt ?? "-",
      proposed: taskPatch.dueAt ?? "-",
    });
  }
  if (taskPatch.scheduledStartAt !== undefined && taskPatch.scheduledStartAt !== originalTask.scheduledStartAt) {
    diffs.push({
      label: "Start",
      key: "scheduledStartAt",
      original: originalTask.scheduledStartAt ?? "-",
      proposed: taskPatch.scheduledStartAt ?? "-",
    });
  }
  if (taskPatch.scheduledEndAt !== undefined && taskPatch.scheduledEndAt !== originalTask.scheduledEndAt) {
    diffs.push({
      label: "End",
      key: "scheduledEndAt",
      original: originalTask.scheduledEndAt ?? "-",
      proposed: taskPatch.scheduledEndAt ?? "-",
    });
  }
  if (taskPatch.scheduleStatus !== undefined && taskPatch.scheduleStatus !== originalTask.scheduleStatus) {
    diffs.push({
      label: "Schedule",
      key: "scheduleStatus",
      original: originalTask.scheduleStatus,
      proposed: taskPatch.scheduleStatus ?? "-",
    });
  }
  if (taskPatch.runtimeModel !== undefined && taskPatch.runtimeModel !== originalTask.runtimeModel) {
    diffs.push({
      label: "Model",
      key: "runtimeModel",
      original: originalTask.runtimeModel ?? "-",
      proposed: taskPatch.runtimeModel ?? "-",
    });
  }
  if (taskPatch.prompt !== undefined && taskPatch.prompt !== originalTask.prompt) {
    diffs.push({
      label: "Prompt",
      key: "prompt",
      original: formatText(originalTask.prompt),
      proposed: formatText(taskPatch.prompt),
    });
  }
  if (taskPatch.runtimeConfig !== undefined && JSON.stringify(taskPatch.runtimeConfig) !== JSON.stringify(originalTask.runtimeConfig)) {
    diffs.push({
      label: "Runtime Config",
      key: "runtimeConfig",
      original: formatText(originalTask.runtimeConfig),
      proposed: formatText(taskPatch.runtimeConfig),
    });
  }
  return diffs;
}

function computePlanSummary(planPatch: NonNullable<TaskWorkspaceUpdateProposal["planPatch"]>) {
  const points: string[] = [];

  if (planPatch.summary) {
    points.push(`Summary: ${planPatch.summary}`);
  }

  if (planPatch.operation === "replace_plan") {
    const count = planPatch.nodes?.length ?? 0;
    points.push(`Replace entire plan with ${count} new node${count !== 1 ? "s" : ""}`);
    if (planPatch.edges?.length) {
      points.push(`${planPatch.edges.length} new edge${planPatch.edges.length !== 1 ? "s" : ""}`);
    }
  } else if (planPatch.operation === "add_node") {
    const names = planPatch.nodes?.map((n) => n.title).join(", ") ?? "";
    points.push(`Add node${(planPatch.nodes?.length ?? 0) > 1 ? "s" : ""}: ${names}`);
  } else if (planPatch.operation === "delete_node") {
    const ids = planPatch.deletedNodeIds?.join(", ") ?? "";
    points.push(`Delete node${(planPatch.deletedNodeIds?.length ?? 0) > 1 ? "s" : ""}: ${ids}`);
  } else if (planPatch.operation === "update_node") {
    const count = planPatch.nodePatches?.length ?? 0;
    points.push(`Update ${count} node${count !== 1 ? "s" : ""}`);
  } else if (planPatch.operation === "reorder_nodes") {
    const count = planPatch.reorder?.length ?? 0;
    points.push(`Reorder ${count} node${count !== 1 ? "s" : ""}`);
  } else if (planPatch.operation === "update_dependencies") {
    points.push("Update dependencies between nodes");
  } else if (planPatch.operation === "materialize_child_tasks") {
    points.push("Materialize plan nodes into child tasks");
  } else if (planPatch.operation === "update_plan_summary") {
    points.push("Update plan summary");
  }
  return points;
}

function isHighRisk(
  proposal: TaskWorkspaceUpdateProposal,
): string[] {
  const risks: string[] = [];
  const tp = proposal.taskPatch;
  const pp = proposal.planPatch;

  if (tp) {
    if (tp.prompt === null || tp.prompt === "") risks.push("Clearing/nullifying the prompt");
    if (tp.description === null || tp.description === "") risks.push("Clearing the description");
    if (tp.runtimeConfig !== undefined) risks.push("Modifying runtime configuration");
    if (tp.dueAt !== undefined || tp.scheduledStartAt !== undefined || tp.scheduledEndAt !== undefined) {
      risks.push("Adjusting schedule dates");
    }
  }

  if (pp) {
    if (pp.operation === "replace_plan") risks.push("Replacing the entire plan");
    if (pp.operation === "delete_node") risks.push("Deleting plan node(s)");
    if (pp.operation === "materialize_child_tasks") risks.push("Materializing into child tasks");
  }

  return risks;
}

export function TaskWorkspaceDiffPreview({
  proposal,
  originalTask,
  onApply,
  onCancel,
  isApplying,
  applyError,
}: Props) {
  const taskDiffs = proposal.taskPatch ? computeTaskDiff(proposal.taskPatch, originalTask) : [];
  const planSummary = proposal.planPatch ? computePlanSummary(proposal.planPatch) : [];
  const risks = isHighRisk(proposal);

  return (
    <SurfaceCard variant="highlight" className="space-y-4" padding="lg">
      <SurfaceCardHeader>
        <div className="flex items-center justify-between gap-2">
          <SurfaceCardTitle>Proposed Changes</SurfaceCardTitle>
          <StatusBadge
            tone={
              proposal.confidence === "high"
                ? "success"
                : proposal.confidence === "medium"
                  ? "warning"
                  : "neutral"
            }
          >
            {proposal.confidence} confidence
          </StatusBadge>
        </div>
        <SurfaceCardDescription>{proposal.summary}</SurfaceCardDescription>
      </SurfaceCardHeader>

      {risks.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">High Risk Changes</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-amber-700 space-y-0.5">
                {risks.map((risk, i) => (
                  <li key={i}>{risk}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {proposal.warnings && proposal.warnings.length > 0 ? (
        <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          {proposal.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="size-3 text-amber-500 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      ) : null}

      {taskDiffs.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Task Changes ({taskDiffs.length})
          </p>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
            {taskDiffs.map((diff) => (
              <FieldDiffRow key={diff.key} label={diff.label} original={diff.original} proposed={diff.proposed} />
            ))}
          </div>
        </div>
      ) : null}

      {planSummary.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Plan Changes
          </p>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-4 space-y-2">
            <StatusBadge tone="info">{proposal.planPatch?.operation ?? "custom"}</StatusBadge>
            <ul className="list-disc pl-4 text-sm text-muted-foreground space-y-1">
              {planSummary.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>

            {proposal.planPatch?.nodes && proposal.planPatch.nodes.length > 0 ? (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-foreground">Nodes:</p>
                {proposal.planPatch.nodes.map((node, i) => (
                  <div key={i} className="rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-xs">
                    <span className="font-medium text-foreground">{node.title}</span>
                    {node.estimatedDurationMinutes ? (
                      <span className="ml-2 text-muted-foreground">({node.estimatedDurationMinutes}m)</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {proposal.planPatch?.deletedNodeIds && proposal.planPatch.deletedNodeIds.length > 0 ? (
              <div className="mt-2 text-xs text-red-600">
                <span className="font-medium">To delete: </span>
                {proposal.planPatch.deletedNodeIds.join(", ")}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => onApply(proposal)}
          disabled={isApplying}
          className={cn(
            buttonVariants({ variant: "default" }),
            isApplying && "opacity-50 cursor-not-allowed",
          )}
        >
          {isApplying ? (
            <>Applying...</>
          ) : proposal.requiresConfirmation ? (
            <>
              <AlertTriangle className="size-4" />
              Accept & Apply
            </>
          ) : (
            <>
              <Check className="size-4" />
              Apply Changes
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={isApplying}
          className={buttonVariants({ variant: "outline" })}
        >
          <X className="size-4" />
          Cancel
        </button>

        {applyError ? (
          <span className="text-sm text-red-600">{applyError}</span>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
