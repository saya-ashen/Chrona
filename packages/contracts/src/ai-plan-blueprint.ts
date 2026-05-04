import { z } from "zod";

export const AI_PLAN_NODE_TYPES = ["task", "checkpoint", "condition", "wait"] as const;
export const AI_TASK_EXECUTORS = ["user", "ai", "system"] as const;
export const AI_TASK_MODES = ["manual", "assist", "auto"] as const;
export const AI_CHECKPOINT_TYPES = ["confirm", "choose", "input", "edit", "approve"] as const;
export const AI_INPUT_FIELD_TYPES = ["text", "number", "date", "time", "select", "multi_select"] as const;
export const AI_CONDITION_EVALUATORS = ["system", "ai", "user"] as const;
export const AI_WAIT_TIMEOUT_ACTIONS = ["continue", "pause", "fail", "notify_user"] as const;
export const AI_PLAN_COMPLETION_POLICY_TYPES = ["all_tasks_completed", "specific_nodes_completed", "custom"] as const;

export type PlanBlueprintNodeType = (typeof AI_PLAN_NODE_TYPES)[number];

export type PlanBlueprintNode =
  | PlanBlueprintTaskNode
  | PlanBlueprintCheckpointNode
  | PlanBlueprintConditionNode
  | PlanBlueprintWaitNode;

export interface PlanBlueprintTaskNode {
  id: string;
  type: "task";
  title: string;
  executor?: (typeof AI_TASK_EXECUTORS)[number];
  mode?: (typeof AI_TASK_MODES)[number];
  expectedOutput?: string;
  completionCriteria?: string;
  estimatedMinutes?: number;
}

export interface PlanBlueprintCheckpointNode {
  id: string;
  type: "checkpoint";
  title: string;
  checkpointType: (typeof AI_CHECKPOINT_TYPES)[number];
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
  evaluationBy?: (typeof AI_CONDITION_EVALUATORS)[number];
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
    onTimeout: (typeof AI_WAIT_TIMEOUT_ACTIONS)[number];
  };
}

export interface PlanBlueprintEdge {
  from: string;
  to: string;
  label?: string;
}

export interface CompiledPlanCompletionPolicy {
  type: (typeof AI_PLAN_COMPLETION_POLICY_TYPES)[number];
  nodeIds?: string[];
  description?: string;
}

export interface PlanCompileIssue {
  path: string;
  message: string;
}

export class PlanCompileError extends Error {
  readonly issues: PlanCompileIssue[];

  constructor(message: string, issues: PlanCompileIssue[]) {
    super(message);
    this.name = "PlanCompileError";
    this.issues = issues;
  }
}

export interface PlanBlueprint {
  title: string;
  goal: string;
  assumptions?: string[];
  nodes: PlanBlueprintNode[];
  edges: PlanBlueprintEdge[];
}

export type AIPlanNodeType = PlanBlueprintNodeType;
export type AIPlanNode = PlanBlueprintNode;
export type AITaskNode = PlanBlueprintTaskNode;
export type AICheckpointNode = PlanBlueprintCheckpointNode;
export type AIConditionNode = PlanBlueprintConditionNode;
export type AIWaitNode = PlanBlueprintWaitNode;
export type AIPlanEdge = PlanBlueprintEdge;
export type AIPlanCompletionPolicy = CompiledPlanCompletionPolicy;
export type AIPlanOutput = PlanBlueprint;

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

const planBlueprintEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
}).strict();

const planBlueprintNodeSchema: z.ZodType<PlanBlueprintNode> = z.discriminatedUnion("type", [
  planBlueprintTaskNodeSchema,
  planBlueprintCheckpointNodeSchema,
  planBlueprintConditionNodeSchema,
  planBlueprintWaitNodeSchema,
]);

export const planBlueprintSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  assumptions: z.array(z.string().min(1)).optional(),
  nodes: z.array(planBlueprintNodeSchema).min(1, "plan must have at least one node"),
  edges: z.array(planBlueprintEdgeSchema).optional().default([]),
}).strict();

export const aiPlanOutputSchema = planBlueprintSchema;

export type GenerateTaskPlanGraphToolPayload = PlanBlueprint;
export const generateTaskPlanGraphToolPayloadSchema = planBlueprintSchema;

export interface AIPlanValidationResult {
  valid: AIPlanOutput;
  warnings: string[];
}

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
