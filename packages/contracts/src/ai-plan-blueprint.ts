import { z } from "zod";

// ─── Node type constants ───

export const AI_PLAN_NODE_TYPES = [
  "task",
  "checkpoint",
  "condition",
  "wait",
] as const;
export const AI_TASK_EXECUTORS = ["user", "ai", "system"] as const;
export const AI_TASK_MODES = ["manual", "assist", "auto"] as const;
export const AI_USER_INTERACTION_LEVELS = ["not_expected", "possible"] as const;
export const AI_CHECKPOINT_SCHEMA_SOURCES = ["static", "ai"] as const;
export const AI_CHECKPOINT_TYPES = [
  "confirm",
  "choose",
  "input",
  "edit",
  "approve",
] as const;
export const AI_INPUT_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "choice",
] as const;
export const AI_CONDITION_EVALUATORS = ["ai", "user"] as const;
export const AI_WAIT_TIMEOUT_ACTIONS = [
  "continue",
  "pause",
  "fail",
  "notify_user",
] as const;

export type PlanNodeType = (typeof AI_PLAN_NODE_TYPES)[number];
export type TaskExecutor = (typeof AI_TASK_EXECUTORS)[number];
export type TaskMode = (typeof AI_TASK_MODES)[number];
export type UserInteractionLevel = (typeof AI_USER_INTERACTION_LEVELS)[number];
export type CheckpointSchemaSource = (typeof AI_CHECKPOINT_SCHEMA_SOURCES)[number];
export type CheckpointType = (typeof AI_CHECKPOINT_TYPES)[number];
export type InputFieldType = (typeof AI_INPUT_FIELD_TYPES)[number];
export type ConditionEvaluator = (typeof AI_CONDITION_EVALUATORS)[number];
export type WaitTimeoutAction = (typeof AI_WAIT_TIMEOUT_ACTIONS)[number];

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
    edges: blueprint.edges.map((e) => ({
      from: e.from,
      to: e.to,
      label: e.label,
    })),
  };
}

function upgradeNode(node: PlanBlueprintNode): EditableNode {
  switch (node.type) {
    case "task":
      return {
        ...node,
        executor: node.executor ?? "ai",
        mode: node.mode ?? "auto",
        userInteraction: node.userInteraction ?? { level: "not_expected" },
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
        interaction: node.interaction,
      };
    case "condition":
      return {
        ...node,
        evaluationBy: node.evaluationBy ?? "ai",
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

// ═══════════════════════════════════════════════════════════════
// Zod schemas — for AI output validation (PlanBlueprint, loose)
// ═══════════════════════════════════════════════════════════════

const aiPlanInputFieldSchema = z
  .object({
    key: z.string().min(1).describe("Stable input field key."),
    label: z.string().min(1).describe("User-facing input field label."),
    inputType: z.enum(AI_INPUT_FIELD_TYPES).describe("Input control type."),
    required: z.boolean().optional().describe("Whether this field is required."),
    options: z.array(z.string()).optional().describe("Allowed options for choice-style fields."),
  })
  .describe("Structured user input field for checkpoint nodes.")
  .strict();
const taskUserInteractionSchema = z
  .discriminatedUnion("level", [
    z.object({ level: z.literal("not_expected") }).strict(),
    z.object({
      level: z.literal("possible"),
      reason: z.string().trim().min(1).describe("Concrete condition that may require user participation during execution."),
    }).strict(),
  ])
  .describe("Plan-time expectation of whether this task may need user participation. This is advisory and never restricts runtime input requests.");

const checkpointInteractionSchema = z
  .discriminatedUnion("schemaSource", [
    z.object({ schemaSource: z.literal("static") }).strict(),
    z.object({
      schemaSource: z.literal("ai"),
      instruction: z.string().trim().min(1).describe("Instruction for the runtime AI to construct the required input request from execution context."),
    }).strict(),
  ])
  .describe("Whether a required checkpoint form is known during planning or must be defined by AI at runtime.");

export const planBlueprintTaskNodeSchema = z
  .object({
    id: z.string().min(1).describe("Stable local node id, ideally snake_case."),
    type: z.literal("task").describe("Core execution node."),
    title: z.string().min(1).describe("Short node label shown to the user."),
    executor: z.enum(AI_TASK_EXECUTORS).optional().describe("Who performs this task node."),
    mode: z.enum(AI_TASK_MODES).optional().describe("How this task node is executed."),
    expectedOutput: z.string().optional().describe("What successful completion should produce."),
    completionCriteria: z.string().optional().describe("How to determine this node is done."),
    estimatedMinutes: z.number().positive().optional().describe("Best-effort duration estimate for this node."),
    userInteraction: taskUserInteractionSchema.optional().describe("Expected user participation. Omitted legacy plans are treated as not_expected."),
  })
  .describe("Task node. Only task nodes may include executor/mode/output fields.")
  .strict();

export const planBlueprintCheckpointNodeSchema = z
  .object({
    id: z.string().min(1).describe("Stable local node id, ideally snake_case."),
    type: z.literal("checkpoint").describe("Human interaction gate node."),
    title: z.string().min(1).describe("Short node label shown to the user."),
    checkpointType: z.enum(AI_CHECKPOINT_TYPES).describe("Checkpoint subtype for confirmation, choice, input, edit, or approval."),
    prompt: z.string().min(1).describe("Prompt shown to the user for this checkpoint."),
    required: z.boolean().optional().describe("Whether this checkpoint can be skipped."),
    options: z.array(z.string()).optional().describe("Available options for choose-style checkpoints."),
    inputFields: z.array(aiPlanInputFieldSchema).optional().describe("Input fields for input-style checkpoints."),
    interaction: checkpointInteractionSchema.optional().describe("Input schema source. Omitted legacy checkpoints retain their existing static behavior."),
  })
  .describe("Checkpoint node. Use for human confirmation, choice, input, edit, or approval.")
  .strict();

export const planBlueprintConditionNodeSchema = z
  .object({
    id: z.string().min(1).describe("Stable local node id, ideally snake_case."),
    type: z.literal("condition").describe("Branching logic gate node."),
    title: z.string().min(1).describe("Short node label shown to the user."),
    condition: z.string().min(1).describe("Human-readable branching condition."),
    evaluationBy: z.enum(AI_CONDITION_EVALUATORS).optional().describe("Who evaluates the condition branch."),
    branches: z
      .array(
        z.object({
          label: z.string().min(1).describe("Branch label shown on the outgoing edge."),
          nextNodeId: z.string().min(1).describe("Target node id for this branch."),
        }).strict().describe("Condition branch target."),
      )
      .min(1, "condition must have at least one branch"),
    defaultNextNodeId: z.string().optional().describe("Optional fallback branch target if no explicit branch matches."),
  })
  .describe("Condition node. Only condition nodes may include condition/evaluation/branches fields.")
  .strict();

export const planBlueprintWaitNodeSchema = z
  .object({
    id: z.string().min(1).describe("Stable local node id, ideally snake_case."),
    type: z.literal("wait").describe("Pause or external-event dependency node."),
    title: z.string().min(1).describe("Short node label shown to the user."),
    waitFor: z.string().min(1).describe("What external event or duration this node waits for."),
    estimatedMinutes: z.number().positive().optional().describe("Best-effort duration estimate for this wait."),
    timeout: z
      .object({
        minutes: z.number().positive().describe("Timeout duration in minutes."),
        onTimeout: z.enum(AI_WAIT_TIMEOUT_ACTIONS).describe("Action to take when the wait times out."),
      })
      .describe("Optional timeout policy for this wait node.")
      .strict()
      .optional(),
  })
  .describe("Wait node. Only wait nodes may include waitFor/timeout fields.")
  .strict();

export const planBlueprintNodeSchema = z
  .discriminatedUnion("type", [
    planBlueprintTaskNodeSchema,
    planBlueprintCheckpointNodeSchema,
    planBlueprintConditionNodeSchema,
    planBlueprintWaitNodeSchema,
  ])
  .describe("Plan node. Must be exactly one of: task, checkpoint, condition, wait.");

export const planBlueprintEdgeSchema = z
  .object({
    from: z.string().min(1).describe("Source node id."),
    to: z.string().min(1).describe("Target node id."),
    label: z.string().optional().describe("Optional edge label, especially for condition branches."),
  })
  .describe("Directed edge between two nodes.")
  .strict();

export const planBlueprintSchema = z
  .object({
    title: z.string().min(1).describe("Brief plan title."),
    goal: z.string().min(1).describe("What this plan is meant to achieve."),
    assumptions: z.array(z.string().min(1)).optional().describe("Optional assumptions the plan relies on."),
    nodes: z
      .array(planBlueprintNodeSchema)
      .min(1, "plan must have at least one node")
      .describe("Execution nodes in dependency order. Provide at least one node."),
    edges: z.array(planBlueprintEdgeSchema).optional().default([]).describe("Main flow edges between nodes."),
  })
  .describe("Structured task execution blueprint as a DAG.")
  .strict();

// ─── AI tool payload types ───

export type GeneratePlanBlueprintToolPayload = PlanBlueprint;

// ─── EditablePlan Zod schema (strict) ───

const editableInputFieldSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(AI_INPUT_FIELD_TYPES).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
  })
  .strict();

export const editableTaskNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("task"),
    title: z.string().min(1),
    executor: z.enum(AI_TASK_EXECUTORS),
    mode: z.enum(AI_TASK_MODES),
    expectedOutput: z.string().optional(),
    completionCriteria: z.string().optional(),
    userInteraction: taskUserInteractionSchema,
    estimatedMinutes: z.number().positive().optional(),
  })
  .strict();

export const editableCheckpointNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("checkpoint"),
    title: z.string().min(1),
    checkpointType: z.enum(AI_CHECKPOINT_TYPES),
    prompt: z.string().min(1),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
    inputFields: z.array(editableInputFieldSchema).optional(),
    interaction: checkpointInteractionSchema.optional(),
  })
  .strict();

export const editableConditionNodeSchema = z
  .object({
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
  })
  .strict();

export const editableWaitNodeSchema = z
  .object({
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
  })
  .strict();

export const editableNodeSchema = z.discriminatedUnion("type", [
  editableTaskNodeSchema,
  editableCheckpointNodeSchema,
  editableConditionNodeSchema,
  editableWaitNodeSchema,
]);

export const editableEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
  })
  .strict();

export const editablePlanSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    title: z.string().min(1),
    goal: z.string().min(1),
    assumptions: z.array(z.string().min(1)).optional(),
    nodes: z
      .array(editableNodeSchema)
      .min(1, "plan must have at least one node"),
    edges: z.array(editableEdgeSchema).optional().default([]),
  })
  .strict();

// ─── PlanPatch schema (AI/user editing protocol) ───

const editablePlanMetadataPatchSchema = z
  .object({
    title: z.string().min(1).optional(),
    goal: z.string().min(1).optional(),
    assumptions: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const planPatchOperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("update_plan"),
      patch: editablePlanMetadataPatchSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("add_node"),
      node: editableNodeSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("update_node"),
      nodeId: z.string().min(1),
      patch: z.record(z.string(), z.unknown()).refine(
        (patch) => patch.type === undefined,
        "node type cannot be changed by update_node",
      ),
    })
    .strict(),
  z
    .object({
      op: z.literal("delete_node"),
      nodeId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_edge"),
      edge: editableEdgeSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("delete_edge"),
      from: z.string().min(1),
      to: z.string().min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("replace_subgraph"),
      removeNodeIds: z.array(z.string().min(1)),
      addNodes: z.array(editableNodeSchema),
      addEdges: z.array(editableEdgeSchema),
    })
    .strict(),
]);

export const planPatchSchema = z
  .object({
    basePlanId: z.string().min(1),
    baseVersion: z.number().int().positive(),
    rationale: z.string().optional(),
    operations: z.array(planPatchOperationSchema).min(1),
  })
  .strict();

// ═══════════════════════════════════════════════════════════════
// Schema-derived types
// ═══════════════════════════════════════════════════════════════

export type PlanBlueprintTaskNode = z.infer<typeof planBlueprintTaskNodeSchema>;
export type PlanBlueprintCheckpointNode = z.infer<typeof planBlueprintCheckpointNodeSchema>;
export type PlanBlueprintConditionNode = z.infer<typeof planBlueprintConditionNodeSchema>;
export type PlanBlueprintWaitNode = z.infer<typeof planBlueprintWaitNodeSchema>;
export type PlanBlueprintNode = z.infer<typeof planBlueprintNodeSchema>;
export type PlanBlueprintEdge = z.infer<typeof planBlueprintEdgeSchema>;
export type PlanBlueprint = z.infer<typeof planBlueprintSchema>;

export type EditableTaskNode = z.infer<typeof editableTaskNodeSchema>;
export type EditableCheckpointNode = z.infer<typeof editableCheckpointNodeSchema>;
export type EditableConditionNode = z.infer<typeof editableConditionNodeSchema>;
export type EditableWaitNode = z.infer<typeof editableWaitNodeSchema>;
export type EditableNode = z.infer<typeof editableNodeSchema>;
export type EditableEdge = z.infer<typeof editableEdgeSchema>;
export type EditablePlan = z.infer<typeof editablePlanSchema>;
export type PlanPatchOperation = z.infer<typeof planPatchOperationSchema>;
export type PlanPatch = z.infer<typeof planPatchSchema>;
