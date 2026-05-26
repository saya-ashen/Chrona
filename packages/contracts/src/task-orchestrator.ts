import { z } from "zod";

export const taskExecutionStateSchema = z.enum([
  "not_started",
  "scheduled",
  "queued",
  "running",
  "waiting_for_user",
  "waiting_for_approval",
  "blocked",
  "failed",
  "degraded",
  "cancelled",
  "completed",
]);

export const taskNodeStateSchema = z.enum([
  "pending",
  "ready",
  "running",
  "waiting_for_user",
  "waiting_for_approval",
  "blocked",
  "failed",
  "skipped",
  "invalidated",
  "cancelled",
  "completed",
]);

export const taskPrimaryActionTypeSchema = z.enum([
  "start",
  "pause",
  "resume",
  "retry_sync",
  "provide_input",
  "approve",
  "cancel",
  "replan",
  "none",
]);

export const taskRecoveryActionTypeSchema = z.enum([
  "retry_sync",
  "cancel_execution",
  "replan_from_node",
  "repair_inconsistency",
]);

export const taskActionSchema = z.object({
  type: z.union([taskPrimaryActionTypeSchema, taskRecoveryActionTypeSchema]),
  enabled: z.boolean(),
  label: z.string().min(1),
  targetNodeId: z.string().min(1).nullable().optional(),
});

export const taskProgressSchema = z.object({
  completed: z.number().int().min(0),
  total: z.number().int().min(0),
  percent: z.number().int().min(0).max(100),
});

export const taskExecutionSummarySchema = z.object({
  taskId: z.string().min(1),
  executionState: taskExecutionStateSchema,
  stateLabel: z.string().min(1),
  stateReason: z.string().min(1).nullable(),
  graphVersion: z.number().int().min(0),
  currentNodeId: z.string().min(1).nullable(),
  primaryAction: taskActionSchema,
  progress: taskProgressSchema,
  readiness: z.object({
    runnable: z.boolean(),
    reason: z.string().min(1).nullable(),
  }),
  degraded: z.object({ reason: z.string().min(1), retryAt: z.string().datetime().nullable() }).nullable(),
  blocking: z.object({ reason: z.string().min(1), nodeId: z.string().min(1).nullable() }).nullable(),
  waiting: z.object({ reason: z.string().min(1), nodeId: z.string().min(1).nullable() }).nullable(),
  recoveryActions: z.array(taskActionSchema).default([]),
});

export const graphNodeStateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: taskNodeStateSchema,
  reachable: z.boolean(),
  current: z.boolean(),
  requiresAction: z.boolean(),
  result: z.unknown().nullable(),
  stateReason: z.string().min(1).nullable(),
  invalidatedByMutationId: z.string().min(1).nullable(),
});

export const graphMutationOperationSchema = z.enum([
  "add_future_node",
  "update_future_node",
  "remove_future_node",
  "add_edge",
  "remove_edge",
  "replace_subgraph",
  "invalidate_downstream",
  "replan_from_node",
]);

export const graphMutationStatusSchema = z.enum(["pending", "applied", "rejected", "cancelled"]);

export const graphMutationRequestSchema = z.object({
  taskId: z.string().min(1),
  baseGraphVersion: z.number().int().min(0),
  operation: graphMutationOperationSchema,
  targetNodeId: z.string().min(1).nullable(),
  payload: z.unknown(),
  reason: z.string().min(1).nullable(),
});

export const graphMutationResponseSchema = z.object({
  mutationId: z.string().min(1),
  status: graphMutationStatusSchema,
  graphVersion: z.number().int().min(0),
  affectedNodeIds: z.array(z.string().min(1)),
  invalidatedNodeIds: z.array(z.string().min(1)),
  executionState: taskExecutionStateSchema,
  currentNodeId: z.string().min(1).nullable(),
  reason: z.string().min(1).nullable(),
});

export const reconciliationIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  nodeId: z.string().min(1).nullable(),
});

export const reconciliationResultSchema = z.object({
  taskId: z.string().min(1),
  graphVersion: z.number().int().min(0),
  executionState: taskExecutionStateSchema,
  currentNodeId: z.string().min(1).nullable(),
  primaryAction: taskActionSchema,
  progress: taskProgressSchema,
  issues: z.array(reconciliationIssueSchema),
  repairActions: z.array(taskActionSchema),
  createdAt: z.string().datetime(),
});

export type TaskExecutionState = z.infer<typeof taskExecutionStateSchema>;
export type TaskNodeState = z.infer<typeof taskNodeStateSchema>;
export type TaskAction = z.infer<typeof taskActionSchema>;
export type TaskExecutionSummary = z.infer<typeof taskExecutionSummarySchema>;
export type GraphNodeState = z.infer<typeof graphNodeStateSchema>;
export type GraphMutationOperation = z.infer<typeof graphMutationOperationSchema>;
export type GraphMutationRequest = z.infer<typeof graphMutationRequestSchema>;
export type GraphMutationResponse = z.infer<typeof graphMutationResponseSchema>;
export type ReconciliationResult = z.infer<typeof reconciliationResultSchema>;
