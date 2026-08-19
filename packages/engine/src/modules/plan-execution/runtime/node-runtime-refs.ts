import type {
  AiVisibleRefBinding,
  CheckpointConfig,
  CheckpointInputFields,
  ConditionConfig,
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeRuntimeInput,
  PlanOutputState,
  SemanticRefHistory,
  TaskConfig,
  WaitConfig,
} from "@chrona/contracts/ai";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";

type RuntimeGoalContext = {
  goal: {
    title: string;
    additionalContext?: string;
    operationalBrief?: {
      outcome: string;
      currentFocus: string;
      strategy: string;
      constraints: string[];
    };
    capturedAt?: string;
  };
  acceptedResults: Array<{
    ref: string;
    taskTitle: string;
    acceptedAt?: string | null;
    summary: string;
    artifactCount: number;
  }>;
  assets?: Array<{
    ref: string;
    title: string;
    description: string;
    kind: string;
    role: string;
    version: number;
    updatedAt: string;
  }>;
};

export type NodeRuntimePlanContext = NodeRuntimeInput["context"]["plan"] & {
  goalContext?: RuntimeGoalContext;
};
export type NodeRuntimeRunContext = NonNullable<NodeRuntimeInput["context"]["run"]>;

type RuntimeNodeViewSource = Pick<
  EffectivePlanNode,
  "config" | "description" | "title" | "type"
> & {
  definition?: Pick<EffectivePlanNode["definition"], "objective">;
};

type SemanticRefPlanNode = Pick<
  EffectivePlanNode,
  "config" | "id" | "localId" | "nodeId" | "title" | "type"
> & {
  activeLayerId?: string | null;
};

type SemanticRefPlan = Pick<
  EffectivePlanGraph,
  "basePlanId" | "graphId" | "resolvedAt"
> & {
  nodes: SemanticRefPlanNode[];
};

function defaultPlanContext(): NodeRuntimePlanContext {
  return {
    title: "Untitled plan",
    goal: "Execute the accepted plan.",
    assumptions: [],
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function dateToken(input: string | undefined): string {
  const parsed = input ? new Date(input) : null;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function branchKey(index: number): string {
  if (index < LETTERS.length) return LETTERS[index];
  return `B${index + 1}`;
}

function nodeObjective(node: RuntimeNodeViewSource): string | undefined {
  const config = node.config as Record<string, unknown>;
  if (typeof config.objective === "string" && config.objective.trim()) {
    return config.objective;
  }
  const definitionObjective = node.definition?.objective;
  if (typeof definitionObjective === "string" && definitionObjective.trim()) {
    return definitionObjective;
  }
  return node.description ?? node.title;
}

function outputSummary(node: EffectivePlanNode): string | undefined {
  const summary = node.result?.outputSummary;
  return typeof summary === "string" && summary.trim() ? summary : undefined;
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}


function dependencyIds(node: EffectivePlanNode): Set<string> {
  return new Set(node.dependencies.filter((id) => typeof id === "string" && id.length > 0));
}

function matchesDependency(candidate: EffectivePlanNode, ids: Set<string>): boolean {
  return ids.has(candidate.id) || ids.has(candidate.nodeId) || ids.has(candidate.localId);
}

export function buildRuntimeNodeView(
  node: RuntimeNodeViewSource,
  ref: string,
): NodeRuntimeInput["node"] {
  switch (node.type) {
    case "task": {
      const config = node.config as TaskConfig & Record<string, unknown>;
      return {
        ref,
        type: node.type,
        title: node.title,
        objective: nodeObjective(node),
        expectedOutput: textField(config.expectedOutput),
        completionCriteria: textField(config.completionCriteria),
      };
    }
    case "condition": {
      const config = node.config as ConditionConfig;
      return {
        ref,
        type: node.type,
        title: node.title,
        objective: nodeObjective(node),
        condition: config.condition,
      };
    }
    case "checkpoint": {
      const config = node.config as CheckpointConfig;
      return {
        ref,
        type: node.type,
        title: node.title,
        objective: nodeObjective(node),
        checkpoint: {
          type: config.checkpointType,
          prompt: config.prompt,
          ...(config.options && config.options.length > 0 ? { options: config.options } : {}),
        },
      };
    }
    case "wait": {
      const config = node.config as WaitConfig;
      return {
        ref,
        type: node.type,
        title: node.title,
        objective: nodeObjective(node),
        wait: {
          waitFor: config.waitFor,
          ...(config.timeout ? { timeout: config.timeout } : {}),
        },
      };
    }
  }
}

type RuntimeVisibleResultManifest = NodeRuntimeInput["context"]["resultManifest"];

function visibleResultManifest(
  planOutput: PlanOutputState | RuntimeVisibleResultManifest | undefined,
): RuntimeVisibleResultManifest {
  if (planOutput && "sourceRevision" in planOutput) return planOutput;
  const manifest = planOutput?.manifest;
  return {
    sourceRevision: manifest?.sourceRevision ?? 0,
    outcome: manifest?.outcome ?? {
      title: "Result pending",
      summary: "No node result has been submitted.",
    },
    currentDeliverableKeys:
      manifest?.deliverables
        .filter((item) => item.status === "current")
        .map((item) => item.deliverableKey) ?? [],
    findingKeys: manifest?.findings.map((item) => item.key) ?? [],
    decisionKeys: manifest?.decisions.map((item) => item.key) ?? [],
    caveatKeys: manifest?.caveats.map((item) => item.key) ?? [],
    nextActionKeys: manifest?.nextActions.map((item) => item.key) ?? [],
  };
}

function compactPreviousResults(input: {
  plan: EffectivePlanGraph;
  history: SemanticRefHistory;
  node: EffectivePlanNode;
  planOutput?: PlanOutputState | RuntimeVisibleResultManifest;
  planContext?: NodeRuntimePlanContext;
  runContext?: NodeRuntimeRunContext;
  userInput?: string;
  inputFields?: CheckpointInputFields;
}): NodeRuntimeInput["context"] {
  const directDependencyIds = dependencyIds(input.node);
  const completed = input.plan.nodes.filter((node) => node.status === "completed" || node.status === "skipped");
  const directDependencies = completed
    .filter((node) => matchesDependency(node, directDependencyIds))
    .map((node) => ({
      nodeRef: refForNode(input.history, node.id).ref,
      title: node.title,
      summary: outputSummary(node),
      ...(node.result?.inputFields ? { inputFields: node.result.inputFields } : {}),
    }));
  const globalItems = completed
    .filter((node) => !matchesDependency(node, directDependencyIds))
    .map((node) => {
      const summary = outputSummary(node);
      return summary ? `${node.title}: ${summary}` : node.title;
    })
    .filter((item) => item.trim().length > 0);
  const { goalContext, ...planContext } = input.planContext ?? defaultPlanContext();

  return {
    plan: planContext,
    ...(input.runContext ? { run: input.runContext } : {}),
    ...(goalContext
      ? {
          goal: goalContext.goal,
          ...(goalContext.assets?.length
            ? { goalAssets: goalContext.assets }
            : {}),
          ...(goalContext.acceptedResults.length > 0
            ? { acceptedGoalResults: goalContext.acceptedResults }
            : {}),
        }
      : {}),
    ...(input.userInput || input.inputFields
      ? {
          currentNodeInput: {
            ...(input.userInput ? { text: input.userInput } : {}),
            ...(input.inputFields ? { fields: input.inputFields } : {}),
          },
        }
      : {}),
    relevantPreviousResults: directDependencies,
    ...(globalItems.length > 0
      ? { globalSummary: globalItems.slice(0, 3).join("; ") + (globalItems.length > 3 ? `; +${globalItems.length - 3} more` : "") }
      : {}),
    resultManifest: visibleResultManifest(input.planOutput),
  };
}

function resolveBranchTarget(
  plan: SemanticRefPlan,
  nextNodeId: string,
): SemanticRefPlanNode | undefined {
  return plan.nodes.find((node) =>
    node.id === nextNodeId || node.localId === nextNodeId || node.nodeId === nextNodeId,
  );
}

export function buildSemanticRefHistory(plan: SemanticRefPlan): SemanticRefHistory {
  const token = dateToken(plan.resolvedAt);
  const taskRef: AiVisibleRefBinding = {
    ref: `T${token}-01`,
    kind: "task",
    label: "Current task",
    version: 1,
    backendId: plan.basePlanId,
  };
  const planRef: AiVisibleRefBinding = {
    ref: `P${token}-01`,
    kind: "plan",
    label: "Current plan",
    version: 1,
    backendId: plan.graphId,
  };
  const nodeRefs = plan.nodes.map((node, index): AiVisibleRefBinding => ({
    ref: `N${token}-${ordinal(index)}`,
    kind: "node",
    label: node.title,
    version: 1,
    backendId: node.id,
    nodeId: node.id,
    nodeLayerId: node.activeLayerId,
  }));
  const branchRefs = plan.nodes.flatMap((node, nodeIndex) => {
    if (node.type !== "condition") return [];
    const config = node.config as ConditionConfig;
    return config.branches.map((branch, branchIndex): AiVisibleRefBinding => {
      const key = branchKey(branchIndex);
      const target = resolveBranchTarget(plan, branch.nextNodeId);
      return {
        ref: `B${token}-${ordinal(nodeIndex)}-${key}`,
        kind: "branch",
        label: branch.label,
        version: 1,
        backendId: `${node.id}:${key}`,
        nodeId: node.id,
        nodeLayerId: node.activeLayerId,
        branchKey: key,
        nextNodeId: target?.id ?? branch.nextNodeId,
        nextNodeLayerId: target?.activeLayerId ?? null,
      };
    });
  });

  return {
    taskRef,
    planRef,
    nodeRefs,
    branchRefs,
    createdAt: plan.resolvedAt,
    version: 1,
  };
}

export function refForNode(history: SemanticRefHistory, nodeId: string): AiVisibleRefBinding {
  const ref = history.nodeRefs.find((candidate) => candidate.nodeId === nodeId || candidate.backendId === nodeId);
  if (!ref) throw new Error(`No AI-visible ref found for node ${nodeId}`);
  return ref;
}

export function branchBindingForRef(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  branchRef: string;
}): AiVisibleRefBinding {
  const history = buildSemanticRefHistory(input.plan);
  const binding = history.branchRefs.find((candidate) =>
    candidate.ref === input.branchRef && candidate.nodeId === input.node.id,
  );
  if (!binding) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "condition branchRef is not valid for the current node",
    );
  }
  if (binding.retiredAt) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "condition branchRef is retired and cannot be selected",
    );
  }
  if (!binding.nextNodeId) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "condition branchRef has no resolved next node",
    );
  }
  return binding;
}

export function buildNodeRuntimeInput(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  planOutput?: PlanOutputState | RuntimeVisibleResultManifest;
  planContext?: NodeRuntimePlanContext;
  runContext?: NodeRuntimeRunContext;
  userInput?: string;
  inputFields?: CheckpointInputFields;
}): NodeRuntimeInput {
  const history = buildSemanticRefHistory(input.plan);
  const currentRef = refForNode(history, input.node.id);
  const branchOptions = input.node.type === "condition"
    ? history.branchRefs
        .filter((branch) => branch.nodeId === input.node.id && !branch.retiredAt)
        .map((branch) => ({
          ref: branch.ref,
          key: branch.branchKey ?? branch.ref,
          label: branch.label,
        }))
    : undefined;

  return {
    node: buildRuntimeNodeView(input.node, currentRef.ref),
    context: compactPreviousResults({ plan: input.plan, history, node: input.node, planOutput: input.planOutput, planContext: input.planContext, runContext: input.runContext, userInput: input.userInput, inputFields: input.inputFields }),
    branchOptions,
  };
}
