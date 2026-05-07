import type {
  CheckpointConfig,
  CompiledPlan,
  CompiledNode,
  ConditionConfig,
  EffectivePlanNode,
  NodeConfig,
  TaskConfig,
  TaskPlanReadModel,
  WaitConfig,
} from "@chrona/contracts/ai";
import type { PlanStep, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph";

type PlanDisplayType = "task" | "checkpoint" | "condition" | "wait";

function normalizePlanNodeTypeForDisplay(rawType: unknown): PlanDisplayType {
  switch (rawType) {
    case "task":
    case "checkpoint":
    case "condition":
    case "wait":
      return rawType;
    case "step":
    case "deliverable":
    case "tool_action":
      return "task";
    case "decision":
      return "condition";
    case "user_input":
      return "checkpoint";
    default:
      return "task";
  }
}

function currentStepIdFromSteps(steps: PlanStep[]) {
  return steps.find((step) => ["in_progress", "waiting_for_user", "blocked"].includes(step.status))?.id ?? null;
}

function nodeConfigToMetadata(node: {
  config: NodeConfig;
  executor?: string;
  mode?: string;
}): Record<string, unknown> {
  const base = {
    executor: node.executor,
    mode: node.mode,
  };

  switch ((node.config as { condition?: unknown; checkpointType?: unknown; waitFor?: unknown }).condition ? "condition" : null) {
    default:
      break;
  }

  if ("checkpointType" in node.config) {
    const config = node.config as CheckpointConfig;
    return {
      ...base,
      checkpointType: config.checkpointType,
      prompt: config.prompt,
      required: config.required,
      options: config.options,
      inputFields: config.inputFields,
    };
  }

  if ("condition" in node.config) {
    const config = node.config as ConditionConfig;
    return {
      ...base,
      condition: config.condition,
      evaluationBy: config.evaluationBy,
      branches: config.branches,
      defaultNextNodeId: config.defaultNextNodeId,
    };
  }

  if ("waitFor" in node.config) {
    const config = node.config as WaitConfig;
    return {
      ...base,
      waitFor: config.waitFor,
      timeout: config.timeout,
    };
  }

  const config = node.config as TaskConfig;
  return {
    ...base,
    expectedOutput: config.expectedOutput,
    completionCriteria: config.completionCriteria,
  };
}

function mapEffectiveStatus(status: EffectivePlanNode["status"]): PlanStep["status"] {
  switch (status) {
    case "ready":
    case "pending":
    case "paused":
      return "pending";
    case "running":
      return "in_progress";
    case "waiting_for_approval":
      return "waiting_for_approval";
    case "waiting_for_user":
      return "waiting_for_user";
    case "blocked":
      return "blocked";
    case "completed":
      return "done";
    case "failed":
      return "blocked";
    case "cancelled":
      return "skipped";
    default:
      return "pending";
  }
}

function effectiveNodeToPlanStep(node: EffectivePlanNode): PlanStep {
  return {
    id: node.id,
    title: node.title,
    objective: node.description ?? node.title,
    phase: node.type,
    status: mapEffectiveStatus(node.status),
    requiresHumanInput:
      node.mode === "manual" ||
      node.status === "waiting_for_user" ||
      node.status === "waiting_for_approval",
    requiresHumanApproval: node.status === "waiting_for_approval",
    type: node.type,
    displayType: normalizePlanNodeTypeForDisplay(node.type),
    linkedTaskId: node.linkedTaskId ?? null,
    executionMode: node.mode ?? null,
    estimatedMinutes: node.estimatedMinutes ?? null,
    priority: node.priority ?? null,
    completionSummary: node.result?.outputSummary ?? null,
    metadata: nodeConfigToMetadata(node),
    readiness: node.ready ? "ready" : node.status === "blocked" ? "blocked" : "waiting",
    dependencies: node.dependencies,
  };
}

export function compiledPlanToGraphPlan(
  plan: CompiledPlan | null | undefined,
  meta?: Partial<Omit<TaskPlanGraphPlan, "state" | "currentStepId" | "steps" | "edges">>,
): TaskPlanGraphPlan | null {
  if (!plan?.nodes?.length) {
    return null;
  }

  const steps: PlanStep[] = plan.nodes.map((node: CompiledNode) => ({
    id: node.id,
    title: node.title,
    objective: node.description ?? node.title,
    phase: node.type,
    status: "pending",
    requiresHumanInput: node.mode === "manual",
    type: node.type,
    displayType: normalizePlanNodeTypeForDisplay(node.type),
    linkedTaskId: node.linkedTaskId,
    executionMode: node.mode ?? null,
    estimatedMinutes: node.estimatedMinutes ?? null,
    priority: node.priority ?? null,
    metadata: nodeConfigToMetadata(node),
  }));

  return {
    state: "ready",
    currentStepId: currentStepIdFromSteps(steps),
    steps,
    edges: (plan.edges ?? []).map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      type: "sequential",
      label: edge.label,
    })),
    ...meta,
  };
}

export function taskPlanReadModelToGraphPlan(
  readModel: TaskPlanReadModel | null | undefined,
): TaskPlanGraphPlan | null {
  if (!readModel?.effectivePlan?.nodes?.length) {
    return readModel?.compiledPlan ? compiledPlanToGraphPlan(readModel.compiledPlan) : null;
  }

  const steps = readModel.effectivePlan.nodes.map(effectiveNodeToPlanStep);
  const activeEdges = readModel.effectivePlan.edges.filter((edge) => edge.active !== false);

  return {
    state: "ready",
    currentStepId: currentStepIdFromSteps(steps),
    steps,
    edges: activeEdges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      type: "sequential",
      label: edge.label,
    })),
    revision: `r${readModel.revision}`,
    generatedBy: readModel.generatedBy,
    summary: readModel.summary,
    updatedAt: readModel.updatedAt,
  };
}

export function summarizeCompiledPlan(plan: CompiledPlan | null | undefined) {
  if (!plan) {
    return { totalEstimatedMinutes: 0, nodeCount: 0, warnings: [] as string[] };
  }

  const totalEstimatedMinutes = plan.nodes.reduce(
    (sum, node) => sum + (node.estimatedMinutes ?? 0),
    0,
  );
  const warnings = plan.validationWarnings.map(
    (w) => `${w.path}: ${w.message}`,
  );

  return {
    totalEstimatedMinutes,
    nodeCount: plan.nodes.length,
    warnings,
  };
}
