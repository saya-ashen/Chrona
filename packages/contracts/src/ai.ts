/**
 * AI feature shared contracts and DTO-like types.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────
// AI Plan Output Schema (canonical AI/tool payload)
// ────────────────────────────────────────────────────

/**
 * Canonical payload contract for AI-generated planning output.
 *
 * This is the authoritative shape for the `generate_task_plan_graph` business
 * tool payload and other provider-facing plan-generation results.
 *
 * Downstream runtime/storage types such as `TaskPlanGraph` are derived from
 * this contract and may use a different internal shape.
 */
export const AI_PLAN_NODE_TYPES = ["task", "checkpoint", "condition", "wait"] as const;
export const AI_TASK_EXECUTORS = ["user", "ai", "system"] as const;
export const AI_TASK_MODES = ["manual", "assist", "auto"] as const;
export const AI_CHECKPOINT_TYPES = ["confirm", "choose", "input", "edit", "approve"] as const;
export const AI_INPUT_FIELD_TYPES = ["text", "number", "date", "time", "select", "multi_select"] as const;
export const AI_CONDITION_EVALUATORS = ["system", "ai", "user"] as const;
export const AI_WAIT_TIMEOUT_ACTIONS = ["continue", "pause", "fail", "notify_user"] as const;
export const AI_PLAN_COMPLETION_POLICY_TYPES = ["all_tasks_completed", "specific_nodes_completed", "custom"] as const;

export type AIPlanNodeType = (typeof AI_PLAN_NODE_TYPES)[number];

export type AIPlanNode =
  | AITaskNode
  | AICheckpointNode
  | AIConditionNode
  | AIWaitNode;

export interface AITaskNode {
  id: string;
  type: "task";
  title: string;
  description?: string;
  executor?: (typeof AI_TASK_EXECUTORS)[number];
  mode?: (typeof AI_TASK_MODES)[number];
  expectedOutput?: string;
  completionCriteria?: string;
  priority?: "low" | "medium" | "high";
  estimatedMinutes?: number;
  dueAt?: string;
  constraints?: string[];
}

export interface AICheckpointNode {
  id: string;
  type: "checkpoint";
  title: string;
  description?: string;
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
  targetNodeId?: string;
}

export interface AIConditionNode {
  id: string;
  type: "condition";
  title: string;
  description?: string;
  condition: string;
  evaluationBy?: (typeof AI_CONDITION_EVALUATORS)[number];
  branches: Array<{
    label: string;
    nextNodeId: string;
  }>;
  defaultNextNodeId?: string;
}

export interface AIWaitNode {
  id: string;
  type: "wait";
  title: string;
  description?: string;
  waitFor: string;
  timeout?: {
    minutes: number;
    onTimeout: (typeof AI_WAIT_TIMEOUT_ACTIONS)[number];
  };
}

export interface AIPlanEdge {
  from: string;
  to: string;
  label?: string;
}

export interface AIPlanCompletionPolicy {
  type: (typeof AI_PLAN_COMPLETION_POLICY_TYPES)[number];
  nodeIds?: string[];
  description?: string;
}

export interface AIPlanOutput {
  title: string;
  goal: string;
  summary?: string;
  nodes: AIPlanNode[];
  edges: AIPlanEdge[];
  completionPolicy?: AIPlanCompletionPolicy;
}

// ────────────────────────────────────────────────────
// Zod schemas for AI plan output validation
// ────────────────────────────────────────────────────

const aiPlanInputFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  inputType: z.enum(AI_INPUT_FIELD_TYPES),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

const aiTaskNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("task"),
  title: z.string().min(1),
  description: z.string().optional(),
  executor: z.enum(AI_TASK_EXECUTORS).optional(),
  mode: z.enum(AI_TASK_MODES).optional(),
  expectedOutput: z.string().optional(),
  completionCriteria: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  estimatedMinutes: z.number().positive().optional(),
  dueAt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
});

const aiCheckpointNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("checkpoint"),
  title: z.string().min(1),
  description: z.string().optional(),
  checkpointType: z.enum(AI_CHECKPOINT_TYPES),
  prompt: z.string().min(1),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  inputFields: z.array(aiPlanInputFieldSchema).optional(),
  targetNodeId: z.string().optional(),
});

const aiConditionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("condition"),
  title: z.string().min(1),
  description: z.string().optional(),
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
});

const aiWaitNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("wait"),
  title: z.string().min(1),
  description: z.string().optional(),
  waitFor: z.string().min(1),
  timeout: z
    .object({
      minutes: z.number().positive(),
      onTimeout: z.enum(AI_WAIT_TIMEOUT_ACTIONS),
    })
    .optional(),
});

const aiPlanEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

const aiPlanCompletionPolicySchema = z.object({
  type: z.enum(AI_PLAN_COMPLETION_POLICY_TYPES),
  nodeIds: z.array(z.string()).optional(),
  description: z.string().optional(),
});

const aiPlanNodeSchema: z.ZodType<AIPlanNode> = z.discriminatedUnion("type", [
  aiTaskNodeSchema,
  aiCheckpointNodeSchema,
  aiConditionNodeSchema,
  aiWaitNodeSchema,
]);

export const aiPlanOutputSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  summary: z.string().optional(),
  nodes: z.array(aiPlanNodeSchema).min(1, "plan must have at least one node"),
  edges: z.array(aiPlanEdgeSchema).optional().default([]),
  completionPolicy: aiPlanCompletionPolicySchema.optional(),
});

export type GenerateTaskPlanGraphToolPayload = AIPlanOutput;
export const generateTaskPlanGraphToolPayloadSchema = aiPlanOutputSchema;

/**
 * Validates that an AIPlanOutput has valid edge references and condition branches.
 * Returns an object with the validated plan and any warnings (discarded edges, invalid branch refs).
 */
export interface AIPlanValidationResult {
  valid: AIPlanOutput;
  warnings: string[];
}

export function validateAIPlanOutput(raw: unknown): AIPlanValidationResult {
  const parsed = aiPlanOutputSchema.safeParse(raw);

  if (!parsed.success) {
    // Log validation errors and return empty valid result so upstream can decide
    const errorMessages = parsed.error.issues.map(
      (i) => `[${i.path.join(".")}] ${i.message}`,
    );
    return {
      valid: { title: "", goal: "", nodes: [], edges: [] },
      warnings: [`Zod validation failed: ${errorMessages.join("; ")}`],
    };
  }

  const aiPlan = parsed.data as AIPlanOutput;
  const nodeIds = new Set(aiPlan.nodes.map((n) => n.id));
  const warnings: string[] = [];

  const validEdges: AIPlanEdge[] = [];
  for (const edge of aiPlan.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      warnings.push(
        `Edge ${edge.from} -> ${edge.to} references missing node ID(s); edge discarded`,
      );
    } else {
      validEdges.push(edge);
    }
  }

  for (const node of aiPlan.nodes) {
    if (node.type === "condition") {
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
    if (node.type === "checkpoint" && node.targetNodeId && !nodeIds.has(node.targetNodeId)) {
      warnings.push(
        `Checkpoint node ${node.id} targetNodeId ${node.targetNodeId} references missing node`,
      );
    }
  }

  return { valid: { ...aiPlan, edges: validEdges }, warnings };
}

// ────────────────────────────────────────────────────
// Conflict / suggestion types
// ────────────────────────────────────────────────────

export type ConflictType =
  | "time_overlap"
  | "overload"
  | "fragmentation"
  | "dependency";

export type ConflictSeverity = "low" | "medium" | "high";

export interface Conflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  taskIds: string[];
  description: string;
  timeRange?: {
    start: Date;
    end: Date;
  };
  metadata?: Record<string, unknown>;
}

export type SuggestionType =
  | "reschedule"
  | "split"
  | "merge"
  | "defer"
  | "reorder";

export interface TaskChange {
  taskId: string;
  scheduledStartAt?: Date;
  scheduledEndAt?: Date;
  priority?: string;
  dueAt?: Date;
}

export interface Suggestion {
  id: string;
  conflictId: string;
  type: SuggestionType;
  description: string;
  reason: string;
  affectedTaskIds: string[];
  changes: TaskChange[];
  estimatedImpact: {
    resolvedConflicts: number;
    movedTasks: number;
    timeShiftMinutes: number;
  };
}

export interface ConflictAnalysisResult {
  conflicts: Conflict[];
  suggestions: Suggestion[];
  summary: {
    totalConflicts: number;
    highSeverityCount: number;
    mediumSeverityCount: number;
    lowSeverityCount: number;
    affectedTaskCount: number;
  };
}

export interface ScheduledTaskInfo {
  taskId: string;
  title: string;
  priority: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  dueAt: Date | null;
  estimatedMinutes: number;
  dependencies: string[];
}

export interface TaskAutomationInput {
  taskId: string;
  title: string;
  description: string;
  priority: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  isRunnable: boolean;
  runnabilityState: string;
  ownerType: string;
  tags?: string[];
}

export type ExecutionMode = "immediate" | "scheduled" | "recurring" | "manual";

export interface ReminderStrategy {
  advanceMinutes: number;
  frequency: "once" | "recurring";
  channels: string[];
}

export interface AutomationSuggestion {
  executionMode: ExecutionMode;
  reminderStrategy: ReminderStrategy;
  preparationSteps: string[];
  contextSources: Array<{ type: string; description: string }>;
  confidence: "low" | "medium" | "high";
}

export interface GenerateTaskPlanRequest {
  taskId?: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: Date | string | null;
  estimatedMinutes?: number;
  planningPrompt?: string;
}

// ────────────────────────────────────────────────────
// Internal stored Plan types (TaskPlanGraph)
// ────────────────────────────────────────────────────

export type TaskPlanStatus = "draft" | "accepted" | "superseded" | "archived";
export type TaskPlanNodeType = "task" | "checkpoint" | "condition" | "wait";
export type TaskPlanNodeStatus =
  | "pending"
  | "in_progress"
  | "waiting_for_child"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "done"
  | "skipped";
export type TaskPlanEdgeType = "sequential" | "depends_on";
export type TaskPlanNodeExecutionMode = "automatic" | "manual" | "hybrid";
export type TaskPlanNodeBlockingReason = "needs_user_input" | "needs_approval" | "external_dependency" | null;

export type TaskPlanNode = {
  id: string;
  type: TaskPlanNodeType;
  title: string;
  objective: string;
  description: string | null;
  status: TaskPlanNodeStatus;
  phase: string | null;
  estimatedMinutes: number | null;
  priority: "Low" | "Medium" | "High" | "Urgent" | null;
  executionMode: TaskPlanNodeExecutionMode;
  requiresHumanInput: boolean;
  requiresHumanApproval: boolean;
  autoRunnable: boolean;
  blockingReason: TaskPlanNodeBlockingReason;
  linkedTaskId: string | null;
  completionSummary: string | null;
  metadata: Record<string, unknown> | null;
  requiredInfo?: string[];
  dependencies?: string[];
  executionClassification?: TaskPlanNodeExecutionClassification;
  nextAction?: string | null;
  readiness?: TaskPlanNodeReadiness;
};

export type TaskPlanNodeExecutionClassification =
  | "automatic_chainable"
  | "automatic_standalone"
  | "human_dependent"
  | "review_gate";

export type TaskPlanNodeReadiness = "ready" | "blocked" | "waiting";

export type TaskPlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: TaskPlanEdgeType;
  metadata: Record<string, unknown> | null;
};

export type TaskPlanGraph = {
  id: string;
  taskId: string;
  status: TaskPlanStatus;
  revision: number;
  source: "ai" | "user" | "mixed";
  generatedBy: string | null;
  prompt: string | null;
  summary: string | null;
  changeSummary: string | null;
  createdAt: string;
  updatedAt: string;
  nodes: TaskPlanNode[];
  edges: TaskPlanEdge[];
};

export interface SavedTaskPlanGraph {
  id: string;
  taskId: string | null;
  workspaceId: string;
  status: TaskPlanStatus;
  prompt: string | null;
  revision: number;
  summary: string | null;
  changeSummary: string | null;
  source: "ai" | "user" | "mixed";
  generatedBy: string | null;
  plan: TaskPlanGraph;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPlanGraphResponse {
  source: "saved" | string;
  planGraph: TaskPlanGraph;
  taskSessionKey?: string | null;
  savedPlan?: {
    id: string;
    status: TaskPlanStatus;
    prompt: string | null;
    revision: number;
    summary: string | null;
    updatedAt: string;
  };
}

export interface ScheduleSlot {
  taskId: string;
  title: string;
  startAt: Date;
  endAt: Date;
}

export interface TimeslotSuggestionInput {
  taskId: string;
  title: string;
  priority: string;
  estimatedMinutes: number;
  dueAt?: Date | null;
  currentSchedule: ScheduleSlot[];
}

export interface TimeslotOptions {
  workdayStartHour?: number;
  workdayEndHour?: number;
  bufferMinutes?: number;
  maxSuggestions?: number;
}

export interface TimeslotSuggestion {
  startAt: Date;
  endAt: Date;
  score: number;
  reasons: string[];
  conflicts: string[];
}

export interface TimeslotSuggestionResult {
  suggestions: TimeslotSuggestion[];
  bestMatch: TimeslotSuggestion | null;
}

export type TaskUpdatePatch = {
  title?: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  scheduleStatus?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: Record<string, unknown> | null;
  runtimeInput?: unknown;
};

export type PlanUpdatePatch = {
  summary?: string;
  operation:
    | "replace_plan"
    | "update_plan_summary"
    | "add_node"
    | "update_node"
    | "delete_node"
    | "reorder_nodes"
    | "update_dependencies"
    | "materialize_child_tasks"
    | "custom";
  planId?: string;
  baseRevisionId?: string;
  nodes?: Array<{
    id?: string;
    title: string;
    description?: string;
    status?: string;
    estimatedDurationMinutes?: number;
    dependsOn?: string[];
    metadata?: Record<string, unknown>;
  }>;
  edges?: Array<{
    from: string;
    to: string;
    type?: string;
  }>;
  nodePatches?: Array<{
    nodeId: string;
    patch: Record<string, unknown>;
  }>;
  deletedNodeIds?: string[];
  reorder?: Array<{
    nodeId: string;
    position: number;
  }>;
  warnings?: string[];
};

export type TaskWorkspaceUpdateProposal = {
  summary: string;
  confidence: "low" | "medium" | "high";
  taskPatch?: TaskUpdatePatch;
  planPatch?: PlanUpdatePatch;
  warnings?: string[];
  requiresConfirmation: boolean;
};

export interface TaskWorkspaceChatRequest {
  taskId: string;
  message: string;
  currentTask: {
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
  currentPlan?: {
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
      dependsOn?: string[];
    }>;
    edges: Array<{
      id: string;
      fromNodeId: string;
      toNodeId: string;
      type: string;
    }>;
  } | null;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  enablePatchTools?: boolean;
}

export interface TaskWorkspaceChatResponse {
  assistantMessage: string;
  proposal?: TaskWorkspaceUpdateProposal;
}

// ────────────────────────────────────────────────────
// Work Block contracts
// ────────────────────────────────────────────────────

export type WorkBlockStatus = "Scheduled" | "Active" | "Completed" | "Cancelled";
export type WorkBlockTrigger = "scheduled" | "manual";

export interface WorkBlock {
  id: string;
  workspaceId: string;
  taskId: string;
  planId: string | null;
  title: string;
  status: WorkBlockStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  startedAt: string | null;
  completedAt: string | null;
  trigger: WorkBlockTrigger;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkBlockInput {
  taskId: string;
  planId?: string | null;
  title: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  trigger?: WorkBlockTrigger;
}

export interface WorkBlockResponse {
  workBlock: WorkBlock;
  canStart: boolean;
  blockingReason: string | null;
  nextStepId: string | null;
}

// ────────────────────────────────────────────────────
// Execution Session contracts
// ────────────────────────────────────────────────────

export type ExecutionSessionStatus = "Active" | "Paused" | "Completed" | "Abandoned";
export type ExecutionSessionPauseReason =
  | "needs_user_input"
  | "needs_approval"
  | "external_dependency"
  | "provider_unavailable"
  | null;

export interface ExecutionSession {
  id: string;
  workspaceId: string;
  taskId: string;
  workBlockId: string | null;
  planId: string;
  status: ExecutionSessionStatus;
  currentNodeId: string | null;
  pauseReason: ExecutionSessionPauseReason;
  completedNodeIds: string[];
  startedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionSessionResponse {
  session: ExecutionSession;
  currentStep: TaskPlanNode | null;
  nextEligibleSteps: TaskPlanNode[];
  reviewPending: boolean;
}

// ────────────────────────────────────────────────────
// Step Review contracts
// ────────────────────────────────────────────────────

export type ReviewOutcome = "accept" | "reject" | "request_changes";

export interface StepReviewInput {
  taskId: string;
  nodeId: string;
  outcome: ReviewOutcome;
  feedback?: string;
}

export interface StepReviewResponse {
  nodeId: string;
  outcome: ReviewOutcome;
  feedback: string | null;
  nextAction: string | null;
}
