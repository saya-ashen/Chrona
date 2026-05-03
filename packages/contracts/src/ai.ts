/**
 * AI feature shared contracts and DTO-like types.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────
// AI Plan Output Schema (what AI models generate)
// ────────────────────────────────────────────────────

export type AIPlanNodeType = "task" | "checkpoint" | "condition" | "wait";

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
  executor?: "user" | "ai" | "system";
  mode?: "manual" | "assist" | "auto";
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
  checkpointType: "confirm" | "choose" | "input" | "edit" | "approve";
  prompt: string;
  required?: boolean;
  options?: string[];
  inputFields?: Array<{
    key: string;
    label: string;
    inputType: "text" | "number" | "date" | "time" | "select" | "multi_select";
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
  evaluationBy?: "system" | "ai" | "user";
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
    onTimeout: "continue" | "pause" | "fail" | "notify_user";
  };
}

export interface AIPlanEdge {
  from: string;
  to: string;
  label?: string;
}

export interface AIPlanCompletionPolicy {
  type: "all_tasks_completed" | "specific_nodes_completed" | "custom";
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
  inputType: z.enum(["text", "number", "date", "time", "select", "multi_select"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

const aiTaskNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("task"),
  title: z.string().min(1),
  description: z.string().optional(),
  executor: z.enum(["user", "ai", "system"]).optional(),
  mode: z.enum(["manual", "assist", "auto"]).optional(),
  expectedOutput: z.string().optional(),
  completionCriteria: z.string().optional(),
  objective: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  estimatedMinutes: z.number().positive().optional(),
  dueAt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  requiresHumanInput: z.boolean().optional(),
  requiresHumanApproval: z.boolean().optional(),
});

const aiCheckpointNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("checkpoint"),
  title: z.string().min(1),
  description: z.string().optional(),
  checkpointType: z.enum(["confirm", "choose", "input", "edit", "approve"]),
  prompt: z.string().min(1),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  inputFields: z.array(aiPlanInputFieldSchema).optional(),
  targetNodeId: z.string().optional(),
  requiresHumanInput: z.boolean().optional(),
  requiresHumanApproval: z.boolean().optional(),
});

const aiConditionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("condition"),
  title: z.string().min(1),
  description: z.string().optional(),
  condition: z.string().min(1),
  evaluationBy: z.enum(["system", "ai", "user"]).optional(),
  branches: z
    .array(
      z.object({
        label: z.string().min(1),
        nextNodeId: z.string().min(1),
      }),
    )
    .min(1, "condition must have at least one branch"),
  defaultNextNodeId: z.string().optional(),
  requiresHumanInput: z.boolean().optional(),
  requiresHumanApproval: z.boolean().optional(),
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
      onTimeout: z.enum(["continue", "pause", "fail", "notify_user"]),
    })
    .optional(),
  requiresHumanInput: z.boolean().optional(),
  requiresHumanApproval: z.boolean().optional(),
});

const aiPlanEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

const aiPlanCompletionPolicySchema = z.object({
  type: z.enum(["all_tasks_completed", "specific_nodes_completed", "custom"]),
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

/**
 * Validates that an AIPlanOutput has valid edge references and condition branches.
 * Returns an object with the validated plan and any warnings (discarded edges, invalid branch refs).
 */
export interface AIPlanValidationResult {
  valid: AIPlanOutput;
  warnings: string[];
}

export function validateAIPlanOutput(raw: unknown): AIPlanValidationResult {
  // Pre-normalize: map bridge-issued fields to Zod-expected fields
  const normalized = normalizeAIPlanInput(raw);
  const parsed = aiPlanOutputSchema.safeParse(normalized);

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

/**
 * Normalizes AI-generated raw input from various bridge formats into
 * the Zod-expected shape before validation.
 */
function normalizeAIPlanInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;

  // Map bridge edge format: { fromNodeId, toNodeId } -> { from, to }
  if (Array.isArray(obj.edges)) {
    obj.edges = (obj.edges as Array<Record<string, unknown>>).map((e) => ({
      from: e.from ?? e.fromNodeId,
      to: e.to ?? e.toNodeId,
      label: e.label,
    }));
  }

  // Map node fields from bridge format
  if (Array.isArray(obj.nodes)) {
    obj.nodes = (obj.nodes as Array<Record<string, unknown>>).map((n) => {
      // Normalize old type names -> new
      if (n.type === "step" || n.type === "deliverable" || n.type === "tool_action") n.type = "task";
      if (n.type === "decision") n.type = "condition";
      if (n.type === "user_input") n.type = "checkpoint";
      // Coerce executor "human" -> "user", "automation" -> "ai"
      if (n.executor === "human" && n.type === "task") n.executor = "user";
      if (n.executor === "automation" && n.type === "task") n.executor = "ai";
      // If bridge sent objective but not expectedOutput, use objective
      if (!n.expectedOutput && n.objective && typeof n.objective === "string") {
        n.expectedOutput = n.objective;
      }
      return n;
    });
  }

  // Remove reasoning from top-level (not in AIPlanOutput schema)
  delete obj.reasoning;

  const normalizedSummary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const firstNodeWithTitle = Array.isArray(obj.nodes)
    ? obj.nodes.find((node): node is Record<string, unknown> => {
        if (!node || typeof node !== "object") return false;
        const title = node.title;
        return typeof title === "string" && title.trim().length > 0;
      })
    : undefined;
  const normalizedFirstNodeTitle =
    typeof firstNodeWithTitle?.title === "string" ? firstNodeWithTitle.title.trim() : "";

  if (typeof obj.title !== "string" || obj.title.trim().length === 0) {
    obj.title = normalizedSummary || normalizedFirstNodeTitle || "Generated task plan";
  }

  if (typeof obj.goal !== "string" || obj.goal.trim().length === 0) {
    obj.goal = normalizedSummary || String(obj.title);
  }

  return obj;
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
};

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
