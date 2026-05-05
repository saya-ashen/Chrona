import { z } from "zod";

// ─── Node type constants ───

export const AI_PLAN_NODE_TYPES = ["task", "checkpoint", "condition", "wait"] as const;
export const AI_TASK_EXECUTORS = ["user", "ai", "system"] as const;
export const AI_TASK_MODES = ["manual", "assist", "auto"] as const;
export const AI_CHECKPOINT_TYPES = ["confirm", "choose", "input", "edit", "approve"] as const;
export const AI_INPUT_FIELD_TYPES = ["text", "number", "boolean", "choice"] as const;
export const AI_CONDITION_EVALUATORS = ["system", "ai", "user"] as const;
export const AI_WAIT_TIMEOUT_ACTIONS = ["continue", "pause", "fail", "notify_user"] as const;

export type PlanNodeType = (typeof AI_PLAN_NODE_TYPES)[number];
export type TaskExecutor = (typeof AI_TASK_EXECUTORS)[number];
export type TaskMode = (typeof AI_TASK_MODES)[number];
export type CheckpointType = (typeof AI_CHECKPOINT_TYPES)[number];
export type InputFieldType = (typeof AI_INPUT_FIELD_TYPES)[number];
export type ConditionEvaluator = (typeof AI_CONDITION_EVALUATORS)[number];
export type WaitTimeoutAction = (typeof AI_WAIT_TIMEOUT_ACTIONS)[number];

// ═══════════════════════════════════════════════════════════════
// PlanBlueprint — loose AI output format (backward compatible)
// Used by AI tool calls, existing engine code. Fields are optional
// where the AI may omit them; validation normalizes missing values.
// ═══════════════════════════════════════════════════════════════

export interface PlanBlueprintTaskNode {
  id: string;
  type: "task";
  title: string;
  executor?: TaskExecutor;
  mode?: TaskMode;
  expectedOutput?: string;
  completionCriteria?: string;
  estimatedMinutes?: number;
}

export interface PlanBlueprintCheckpointNode {
  id: string;
  type: "checkpoint";
  title: string;
  checkpointType: CheckpointType;
  prompt: string;
  required?: boolean;
  options?: string[];
  inputFields?: Array<{
    key: string;
    label: string;
    inputType: (typeof AI_INPUT_FIELD_TYPES)[number];
    required?: boolean;
    options?: string[];
  }>;
}

export interface PlanBlueprintConditionNode {
  id: string;
  type: "condition";
  title: string;
  condition: string;
  evaluationBy?: ConditionEvaluator;
  branches: Array<{
    label: string;
    nextNodeId: string;
  }>;
  defaultNextNodeId?: string;
}

export interface PlanBlueprintWaitNode {
  id: string;
  type: "wait";
  title: string;
  waitFor: string;
  estimatedMinutes?: number;
  timeout?: {
    minutes: number;
    onTimeout: WaitTimeoutAction;
  };
}

export type PlanBlueprintNode =
  | PlanBlueprintTaskNode
  | PlanBlueprintCheckpointNode
  | PlanBlueprintConditionNode
  | PlanBlueprintWaitNode;

export interface PlanBlueprintEdge {
  from: string;
  to: string;
  label?: string;
}

export interface PlanBlueprint {
  title: string;
  goal: string;
  assumptions?: string[];
  nodes: PlanBlueprintNode[];
  edges: PlanBlueprintEdge[];
}

// ─── Legacy type aliases ───

export type PlanBlueprintNodeType = PlanNodeType;
export type AIPlanNodeType = PlanNodeType;
export type AIPlanNode = PlanBlueprintNode;
export type AITaskNode = PlanBlueprintTaskNode;
export type AICheckpointNode = PlanBlueprintCheckpointNode;
export type AIConditionNode = PlanBlueprintConditionNode;
export type AIWaitNode = PlanBlueprintWaitNode;
export type AIPlanEdge = PlanBlueprintEdge;
export type AIPlanOutput = PlanBlueprint;

// ═══════════════════════════════════════════════════════════════
// EditablePlan — strict internal format (domain layer)
// Always has id, version, and required fields filled in.
// ═══════════════════════════════════════════════════════════════

export interface EditableTaskNode {
  id: string;
  type: "task";
  title: string;
  executor: TaskExecutor;
  mode: TaskMode;
  expectedOutput?: string;
  completionCriteria?: string;
  estimatedMinutes?: number;
}

export interface EditableCheckpointNode {
  id: string;
  type: "checkpoint";
  title: string;
  checkpointType: CheckpointType;
  prompt: string;
  required: boolean;
  options?: string[];
  inputFields?: Array<{
    name: string;
    label: string;
    type?: InputFieldType;
    required?: boolean;
    options?: string[];
  }>;
}

export interface EditableConditionNode {
  id: string;
  type: "condition";
  title: string;
  condition: string;
  evaluationBy: ConditionEvaluator;
  branches: Array<{
    label: string;
    nextNodeId: string;
  }>;
  defaultNextNodeId?: string;
}

export interface EditableWaitNode {
  id: string;
  type: "wait";
  title: string;
  waitFor: string;
  estimatedMinutes?: number;
  timeout?: {
    minutes: number;
    onTimeout: WaitTimeoutAction;
  };
}

export type EditableNode =
  | EditableTaskNode
  | EditableCheckpointNode
  | EditableConditionNode
  | EditableWaitNode;

export interface EditableEdge {
  from: string;
  to: string;
  label?: string;
}

export interface EditablePlan {
  id: string;
  version: number;
  title: string;
  goal: string;
  assumptions?: string[];
  nodes: EditableNode[];
  edges: EditableEdge[];
}

// ═══════════════════════════════════════════════════════════════
// Convert PlanBlueprint → EditablePlan
// ═══════════════════════════════════════════════════════════════

export function upgradeBlueprintToEditable(
  blueprint: PlanBlueprint,
  planId: string,
  version = 1,
): EditablePlan {
  return {
    id: planId,
    version,
    title: blueprint.title,
    goal: blueprint.goal,
    assumptions: blueprint.assumptions,
    nodes: blueprint.nodes.map(upgradeNode),
    edges: blueprint.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
  };
}

function upgradeNode(node: PlanBlueprintNode): EditableNode {
  switch (node.type) {
    case "task":
      return {
        ...node,
        executor: node.executor ?? "ai",
        mode: node.mode ?? "auto",
      };
    case "checkpoint":
      return {
        id: node.id,
        type: "checkpoint",
        title: node.title,
        checkpointType: node.checkpointType,
        prompt: node.prompt,
        required: node.required ?? true,
        options: node.options,
        inputFields: node.inputFields?.map((f) => ({
          name: f.key,
          label: f.label,
          type: f.inputType as InputFieldType | undefined,
          required: f.required,
          options: f.options,
        })),
      };
    case "condition":
      return {
        ...node,
        evaluationBy: node.evaluationBy ?? "system",
      };
    case "wait":
      return {
        ...node,
      };
  }
}

// ═══════════════════════════════════════════════════════════════
// Validation types
// ═══════════════════════════════════════════════════════════════

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ═══════════════════════════════════════════════════════════════
// PlanCompileError
// ═══════════════════════════════════════════════════════════════

export interface PlanCompileIssue {
  path: string;
  message: string;
}

export interface CompiledPlanCompletionPolicy {
  type: "all_tasks_completed";
}

export type AIPlanCompletionPolicy = CompiledPlanCompletionPolicy;

export class PlanCompileError extends Error {
  readonly issues: PlanCompileIssue[];

  constructor(message: string, issues: PlanCompileIssue[]) {
    super(message);
    this.name = "PlanCompileError";
    this.issues = issues;
  }
}

// ═══════════════════════════════════════════════════════════════
// PlanPatch (AI/user editing protocol)
// ═══════════════════════════════════════════════════════════════

export type PlanPatchOperation =
  | { op: "update_plan"; patch: Partial<Pick<EditablePlan, "title" | "goal" | "assumptions">> }
  | { op: "add_node"; node: EditableNode }
  | { op: "update_node"; nodeId: string; patch: Partial<EditableNode> }
  | { op: "delete_node"; nodeId: string }
  | { op: "add_edge"; edge: EditableEdge }
  | { op: "delete_edge"; from: string; to: string }
  | {
      op: "replace_subgraph";
      removeNodeIds: string[];
      addNodes: EditableNode[];
      addEdges: EditableEdge[];
    };

export interface PlanPatch {
  basePlanId: string;
  baseVersion: number;
  rationale?: string;
  operations: PlanPatchOperation[];
}

// ═══════════════════════════════════════════════════════════════
// Zod schemas — for AI output validation (PlanBlueprint, loose)
// ═══════════════════════════════════════════════════════════════

const aiPlanInputFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  inputType: z.enum(AI_INPUT_FIELD_TYPES),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
}).strict();

const planBlueprintTaskNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("task"),
  title: z.string().min(1),
  executor: z.enum(AI_TASK_EXECUTORS).optional(),
  mode: z.enum(AI_TASK_MODES).optional(),
  expectedOutput: z.string().optional(),
  completionCriteria: z.string().optional(),
  estimatedMinutes: z.number().positive().optional(),
}).strict();

const planBlueprintCheckpointNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("checkpoint"),
  title: z.string().min(1),
  checkpointType: z.enum(AI_CHECKPOINT_TYPES),
  prompt: z.string().min(1),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  inputFields: z.array(aiPlanInputFieldSchema).optional(),
}).strict();

const planBlueprintConditionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("condition"),
  title: z.string().min(1),
  condition: z.string().min(1),
  evaluationBy: z.enum(AI_CONDITION_EVALUATORS).optional(),
  branches: z
    .array(
      z.object({
        label: z.string().min(1),
        nextNodeId: z.string().min(1),
      }),
    )
    .min(1, "condition must have at least one branch"),
  defaultNextNodeId: z.string().optional(),
}).strict();

const planBlueprintWaitNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("wait"),
  title: z.string().min(1),
  waitFor: z.string().min(1),
  estimatedMinutes: z.number().positive().optional(),
  timeout: z
    .object({
      minutes: z.number().positive(),
      onTimeout: z.enum(AI_WAIT_TIMEOUT_ACTIONS),
    })
    .strict()
    .optional(),
}).strict();

export const planBlueprintNodeSchema: z.ZodType<PlanBlueprintNode> = z.discriminatedUnion("type", [
  planBlueprintTaskNodeSchema,
  planBlueprintCheckpointNodeSchema,
  planBlueprintConditionNodeSchema,
  planBlueprintWaitNodeSchema,
]);

export const planBlueprintEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
}).strict();

export const planBlueprintSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  assumptions: z.array(z.string().min(1)).optional(),
  nodes: z.array(planBlueprintNodeSchema).min(1, "plan must have at least one node"),
  edges: z.array(planBlueprintEdgeSchema).optional().default([]),
}).strict();

export const aiPlanOutputSchema = planBlueprintSchema;

// ─── AI tool payload types ───

export type GeneratePlanBlueprintToolPayload = PlanBlueprint;
export const generatePlanBlueprintToolPayloadSchema = planBlueprintSchema;

// ─── EditablePlan Zod schema (strict) ───

const editableInputFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(AI_INPUT_FIELD_TYPES).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
}).strict();

const editableTaskNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("task"),
  title: z.string().min(1),
  executor: z.enum(AI_TASK_EXECUTORS),
  mode: z.enum(AI_TASK_MODES),
  expectedOutput: z.string().optional(),
  completionCriteria: z.string().optional(),
  estimatedMinutes: z.number().positive().optional(),
}).strict();

const editableCheckpointNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("checkpoint"),
  title: z.string().min(1),
  checkpointType: z.enum(AI_CHECKPOINT_TYPES),
  prompt: z.string().min(1),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  inputFields: z.array(editableInputFieldSchema).optional(),
}).strict();

const editableConditionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("condition"),
  title: z.string().min(1),
  condition: z.string().min(1),
  evaluationBy: z.enum(AI_CONDITION_EVALUATORS),
  branches: z
    .array(
      z.object({
        label: z.string().min(1),
        nextNodeId: z.string().min(1),
      }),
    )
    .min(1, "condition must have at least one branch"),
  defaultNextNodeId: z.string().optional(),
}).strict();

const editableWaitNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("wait"),
  title: z.string().min(1),
  waitFor: z.string().min(1),
  estimatedMinutes: z.number().positive().optional(),
  timeout: z
    .object({
      minutes: z.number().positive(),
      onTimeout: z.enum(AI_WAIT_TIMEOUT_ACTIONS),
    })
    .strict()
    .optional(),
}).strict();

const editableNodeSchema: z.ZodType<EditableNode> = z.discriminatedUnion("type", [
  editableTaskNodeSchema,
  editableCheckpointNodeSchema,
  editableConditionNodeSchema,
  editableWaitNodeSchema,
]);

export const editableEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
}).strict();

export const editablePlanSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  goal: z.string().min(1),
  assumptions: z.array(z.string().min(1)).optional(),
  nodes: z.array(editableNodeSchema).min(1, "plan must have at least one node"),
  edges: z.array(editableEdgeSchema).optional().default([]),
}).strict();

// ═══════════════════════════════════════════════════════════════
// Legacy validateAIPlanOutput — uses loose PlanBlueprint schema
// ═══════════════════════════════════════════════════════════════

/**
 * @deprecated Use validateEditablePlan from @chrona/domain/plan instead
 */
export interface AIPlanValidationResult {
  valid: AIPlanOutput;
  warnings: string[];
}

/**
 * @deprecated Use validateEditablePlan from @chrona/domain/plan instead
 */
export function validateAIPlanOutput(raw: unknown): AIPlanValidationResult {
  const parsed = aiPlanOutputSchema.safeParse(raw);

  if (!parsed.success) {
    const errorMessages = parsed.error.issues.map(
      (issue) => `[${issue.path.join(".")}] ${issue.message}`,
    );
    return {
      valid: { title: "", goal: "", nodes: [], edges: [] },
      warnings: [`Zod validation failed: ${errorMessages.join("; ")}`],
    };
  }

  const aiPlan = parsed.data as AIPlanOutput;
  const nodeIds = new Set(aiPlan.nodes.map((node) => node.id));
  const warnings: string[] = [];

  const seenNodeIds = new Set<string>();
  for (const node of aiPlan.nodes) {
    if (seenNodeIds.has(node.id)) {
      warnings.push(`Duplicate node id: ${node.id}`);
    }
    seenNodeIds.add(node.id);
  }

  for (const edge of aiPlan.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      warnings.push(`Edge ${edge.from} -> ${edge.to} references missing node ID(s)`);
    }
  }

  for (const node of aiPlan.nodes) {
    if (node.type !== "condition") {
      continue;
    }
    for (const branch of node.branches) {
      if (!nodeIds.has(branch.nextNodeId)) {
        warnings.push(
          `Condition node ${node.id} branch "${branch.label}" references missing nodeId ${branch.nextNodeId}`,
        );
      }
    }
    if (node.defaultNextNodeId && !nodeIds.has(node.defaultNextNodeId)) {
      warnings.push(
        `Condition node ${node.id} defaultNextNodeId ${node.defaultNextNodeId} references missing node`,
      );
    }
  }

  return { valid: aiPlan, warnings };
}
