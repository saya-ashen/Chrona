import type { ExecutionActionInput } from "@chrona/contracts/ai";
import type {
  PlanNodeAction,
  PlanNodeDataModel,
  PlanNodeField,
} from "@/components/tasks/plan/task-plan-graph/types";

export function buildDefaultWorkspaceActionFields(fields: PlanNodeField[]) {
  return Object.fromEntries(
    fields.map((field) => [field.key, field.value || ""]),
  );
}

export function pickDefaultWorkspaceAction(node: PlanNodeDataModel) {
  return (
    node.availableActions?.find((action) => action.emphasis === "primary")
      ?.id ??
    node.availableActions?.[0]?.id ??
    null
  );
}

export function getMissingWorkspaceActionFields(fields: PlanNodeField[], values: Record<string, string>) {
  return fields.filter((field) => field.required && !values[field.key]?.trim());
}

export function getWorkspaceActionDisabledReason(input: {
  fields: PlanNodeField[];
  values: Record<string, string>;
  isDispatching: boolean;
  baseReason?: string;
}) {
  if (input.isDispatching) return "Action is already being sent.";
  if (input.baseReason) return input.baseReason;

  const missingFields = getMissingWorkspaceActionFields(input.fields, input.values);
  if (missingFields.length > 0) {
    return `Complete required field${missingFields.length === 1 ? "" : "s"}: ${missingFields.map((field) => field.label).join(", ")}.`;
  }

  return null;
}

export function buildWorkspaceActionInput(input: {
  node: PlanNodeDataModel;
  selectedAction: PlanNodeAction | null;
  fields: PlanNodeField[];
  values: Record<string, string>;
}): ExecutionActionInput {
  const kind = input.selectedAction?.kind;
  const inputText = buildWorkspaceInputText(input.fields, input.values);
  const selectedDecision = input.values["checkpoint:decision"]?.trim().toLowerCase();

  if (
    kind === "approve" ||
    input.node.interactionType === "approve" ||
    input.node.interactionType === "confirm"
  ) {
    return {
      action: "resume_with_approval",
      nodeId: input.node.id,
      decision: selectedDecision?.includes("reject") ? "reject" : "approve",
      feedback: inputText || undefined,
    };
  }

  if (kind === "retry" || input.node.interactionType === "retry") {
    return {
      action: "retry_node",
      nodeId: input.node.id,
      prompt: inputText || input.node.nextAction || undefined,
    };
  }

  if (kind === "trigger" || input.node.interactionType === "execute") {
    if (input.node.executionMode === "manual") {
      return {
        action: "complete_manual_node",
        nodeId: input.node.id,
        summary: inputText || input.node.nextAction || `Manual node ${input.node.title} completed`,
        output: inputText || undefined,
      };
    }

    return {
      action: "start_manual",
      prompt: inputText || input.node.nextAction || undefined,
    };
  }

  if (input.node.interactionType === "wait") {
    return {
      action: "resume_after_unblock",
      nodeId: input.node.id,
      note: inputText || input.node.nextAction || undefined,
    };
  }

  return {
    action: "resume_with_input",
    nodeId: input.node.id,
    inputText: inputText || input.node.nextAction || "Continue",
  };
}

function buildWorkspaceInputText(fields: PlanNodeField[], values: Record<string, string>) {
  return fields
    .map((field) => {
      const value = values[field.key]?.trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
