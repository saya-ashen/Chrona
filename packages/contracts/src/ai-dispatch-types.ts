import type { CompiledEdge, CompiledNode } from "./plan-runtime";
import { z } from "zod";

export const TASK_DISPATCH_ACTIONS = [
  "run_node",
  "materialize_node",
  "ask_user",
  "revise_plan",
  "summarize_context",
  "mark_task_done",
  "stop",
] as const;

export const taskDispatchActionSchema = z.enum(TASK_DISPATCH_ACTIONS);

const compiledNodeSchema: z.ZodType<CompiledNode> = z
  .object({
    id: z.string().min(1),
    localId: z.string().min(1),
    type: z.enum(["task", "checkpoint", "condition", "wait"]),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
    linkedTaskId: z.string().optional(),
    config: z.record(z.string(), z.unknown()),
    dependencies: z.array(z.string()),
    dependents: z.array(z.string()),
    executor: z.enum(["user", "ai", "system"]).optional(),
    mode: z.enum(["manual", "assist", "auto"]).optional(),
    estimatedMinutes: z.number().positive().optional(),
  })
  .strict();

const compiledEdgeSchema: z.ZodType<CompiledEdge> = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
  })
  .strict();

const compiledNodePatchSchema: z.ZodType<Partial<CompiledNode>> = z
  .object({
    id: z.string().min(1).optional(),
    localId: z.string().min(1).optional(),
    type: z.enum(["task", "checkpoint", "condition", "wait"]).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
    linkedTaskId: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    dependencies: z.array(z.string()).optional(),
    dependents: z.array(z.string()).optional(),
    executor: z.enum(["user", "ai", "system"]).optional(),
    mode: z.enum(["manual", "assist", "auto"]).optional(),
    estimatedMinutes: z.number().positive().optional(),
  })
  .strict();

export const taskPlanPatchSchema = z
  .object({
    basePlanId: z.string().min(1, "basePlanId must be a non-empty string"),
    baseRevision: z.number().int().positive("baseRevision must be a positive integer"),
    reason: z.string().min(1, "reason must be a non-empty string"),
    changeSummary: z.string().min(1, "changeSummary must be a non-empty string"),
    sourceRunId: z.string().optional(),
    sourceNodeId: z.string().optional(),
    nodesToAdd: z.array(compiledNodeSchema).optional(),
    nodesToUpdate: z
      .array(
        z
          .object({
            nodeId: z.string().min(1),
            patch: compiledNodePatchSchema,
          })
          .strict(),
      )
      .optional(),
    nodeIdsToRemove: z.array(z.string().min(1)).optional(),
    edgesToAdd: z.array(compiledEdgeSchema).optional(),
    edgeIdsToRemove: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const taskDispatchDecisionSchema = z
  .object({
    schemaName: z.literal("task_dispatch_decision"),
    schemaVersion: z.literal("1.0.0"),
    action: taskDispatchActionSchema,
    targetNodeId: z.string().min(1).optional(),
    createNewContext: z.boolean().optional(),
    runtimePrompt: z.string().optional(),
    planPatch: taskPlanPatchSchema.optional(),
    contextInstruction: z
      .object({
        summarize: z.boolean(),
        retainKeys: z.array(z.string()),
      })
      .strict()
      .optional(),
    safety: z
      .object({
        requiresHumanApproval: z.boolean(),
        riskLevel: z.enum(["low", "medium", "high"]),
      })
      .strict(),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1, "reason must be a non-empty string"),
    rationale: z.string().optional(),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (hasActionTarget(decision.action) && !decision.targetNodeId) {
      ctx.addIssue({
        code: "custom",
        path: ["targetNodeId"],
        message: "targetNodeId is required for node actions",
      });
    }
    if (requiresPlanPatch(decision.action) && !decision.planPatch) {
      ctx.addIssue({
        code: "custom",
        path: ["planPatch"],
        message: "planPatch is required for revise_plan",
      });
    }
  });

export type TaskDispatchAction = z.infer<typeof taskDispatchActionSchema>;
export type TaskPlanPatch = z.infer<typeof taskPlanPatchSchema>;
export type TaskDispatchDecision = z.infer<typeof taskDispatchDecisionSchema>;

export type DispatchDecisionParseIssue = {
  path: string;
  message: string;
};

export type ParseResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: DispatchDecisionParseIssue[] };

function hasActionTarget(action: TaskDispatchAction) {
  return action === "run_node" || action === "materialize_node";
}

function requiresPlanPatch(action: TaskDispatchAction) {
  return action === "revise_plan";
}

export function parseTaskDispatchDecision(raw: unknown): ParseResult<TaskDispatchDecision> {
  const validation = taskDispatchDecisionSchema.safeParse(raw);
  if (!validation.success) {
    return {
      ok: false,
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "root",
        message: issue.message,
      })),
    };
  }

  return { ok: true, value: validation.data, issues: [] };
}

export interface TaskDispatchPolicy {
  minConfidenceForAutoExecute: number;
  allowedAutoActions: TaskDispatchAction[];
  requireHumanApprovalByDefault: boolean;
}

export function isAutoExecutableDispatchDecision(
  decision: TaskDispatchDecision,
  policy: TaskDispatchPolicy,
): boolean {
  if (decision.confidence < policy.minConfidenceForAutoExecute) {
    return false;
  }
  if (!policy.allowedAutoActions.includes(decision.action)) {
    return false;
  }
  if (decision.safety.riskLevel !== "low") {
    return false;
  }
  if (policy.requireHumanApprovalByDefault || decision.safety.requiresHumanApproval) {
    return false;
  }
  return true;
}
