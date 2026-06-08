import type { UiDocument } from "@chrona/ui-protocol";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";

type EditableTask = {
  title: string;
  description: string | null;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  executionRuntime: string;
  executionConfig: unknown;
};

function formatText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  if (typeof value === "object") return `${JSON.stringify(value).slice(0, 160)}...`;
  return String(value);
}

function computeTaskDiff(taskPatch: NonNullable<TaskWorkspaceUpdateProposal["taskPatch"]>, originalTask: EditableTask) {
  const diffs: Array<{ label: string; key: string; original: string; proposed: string }> = [];
  if (taskPatch.title !== undefined && taskPatch.title !== originalTask.title) {
    diffs.push({ label: "Title", key: "title", original: originalTask.title, proposed: taskPatch.title });
  }
  if (taskPatch.description !== undefined && taskPatch.description !== originalTask.description) {
    diffs.push({ label: "Description", key: "description", original: formatText(originalTask.description), proposed: formatText(taskPatch.description) });
  }
  if (taskPatch.priority !== undefined && taskPatch.priority !== originalTask.priority) {
    diffs.push({ label: "Priority", key: "priority", original: originalTask.priority, proposed: taskPatch.priority });
  }
  if (taskPatch.dueAt !== undefined && taskPatch.dueAt !== originalTask.dueAt) {
    diffs.push({ label: "Due Date", key: "dueAt", original: originalTask.dueAt ?? "-", proposed: taskPatch.dueAt ?? "-" });
  }
  if (taskPatch.scheduledStartAt !== undefined && taskPatch.scheduledStartAt !== originalTask.scheduledStartAt) {
    diffs.push({ label: "Start", key: "scheduledStartAt", original: originalTask.scheduledStartAt ?? "-", proposed: taskPatch.scheduledStartAt ?? "-" });
  }
  if (taskPatch.scheduledEndAt !== undefined && taskPatch.scheduledEndAt !== originalTask.scheduledEndAt) {
    diffs.push({ label: "End", key: "scheduledEndAt", original: originalTask.scheduledEndAt ?? "-", proposed: taskPatch.scheduledEndAt ?? "-" });
  }
  if (taskPatch.scheduleStatus !== undefined && taskPatch.scheduleStatus !== originalTask.scheduleStatus) {
    diffs.push({ label: "Schedule", key: "scheduleStatus", original: originalTask.scheduleStatus, proposed: taskPatch.scheduleStatus ?? "-" });
  }
  if (taskPatch.executionRuntime !== undefined && taskPatch.executionRuntime !== originalTask.executionRuntime) {
    diffs.push({ label: "Execution Runtime", key: "executionRuntime", original: originalTask.executionRuntime || "-", proposed: taskPatch.executionRuntime ?? "-" });
  }
  if (taskPatch.executionConfig !== undefined && JSON.stringify(taskPatch.executionConfig) !== JSON.stringify(originalTask.executionConfig)) {
    diffs.push({ label: "Execution Config", key: "executionConfig", original: formatText(originalTask.executionConfig), proposed: formatText(taskPatch.executionConfig) });
  }
  return diffs;
}

function computePlanSummary(planPatch: NonNullable<TaskWorkspaceUpdateProposal["planPatch"]>) {
  const points: string[] = [];
  if (planPatch.rationale) points.push(`Rationale: ${planPatch.rationale}`);
  for (const op of planPatch.operations) {
    switch (op.op) {
      case "update_plan": points.push("Update plan fields"); break;
      case "add_node": points.push(`Add node: ${op.node.title}`); break;
      case "update_node": points.push(`Update node ${op.nodeId}`); break;
      case "delete_node": points.push(`Delete node: ${op.nodeId}`); break;
      case "add_edge": points.push(`Add edge ${op.edge.from} -> ${op.edge.to}`); break;
      case "delete_edge": points.push(`Delete edge ${op.from} -> ${op.to}`); break;
      case "replace_subgraph": points.push(`Replace subgraph (+${op.addNodes.length} nodes)`); break;
    }
  }
  return points;
}

function highRiskChanges(proposal: TaskWorkspaceUpdateProposal): string[] {
  const risks: string[] = [];
  const tp = proposal.taskPatch;
  const pp = proposal.planPatch;
  if (tp) {
    if (tp.description === null || tp.description === "") risks.push("Clearing the description");
    if (tp.executionConfig !== undefined) risks.push("Modifying execution configuration");
    if (tp.dueAt !== undefined || tp.scheduledStartAt !== undefined || tp.scheduledEndAt !== undefined) risks.push("Adjusting schedule dates");
  }
  if (pp) {
    if (pp.operations.some((op) => op.op === "replace_subgraph")) risks.push("Replacing subgraph");
    if (pp.operations.some((op) => op.op === "delete_node")) risks.push("Deleting plan node(s)");
  }
  return risks;
}

export function buildTaskWorkspaceDiffPreviewSpec(proposal: TaskWorkspaceUpdateProposal, originalTask: EditableTask): UiDocument {
  const operations = proposal.planPatch?.operations ?? [];
  return {
    root: "root",
    elements: {
      root: {
        type: "WorkspaceDiffPreview",
        props: {
          summary: proposal.summary,
          confidence: proposal.confidence,
          risks: highRiskChanges(proposal),
          warnings: proposal.warnings ?? [],
          taskDiffs: proposal.taskPatch ? computeTaskDiff(proposal.taskPatch, originalTask) : [],
          planSummary: proposal.planPatch ? computePlanSummary(proposal.planPatch) : [],
          addedNodes: operations
            .filter((op) => op.op === "add_node")
            .map((op) => ({ title: op.node.title, estimatedMinutes: "estimatedMinutes" in op.node ? op.node.estimatedMinutes : undefined })),
          deletedNodeIds: operations
            .filter((op) => op.op === "delete_node")
            .map((op) => op.nodeId),
        },
      },
    },
  };
}
