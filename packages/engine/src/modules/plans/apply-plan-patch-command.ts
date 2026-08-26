/* eslint-disable complexity, max-lines-per-function, max-lines -- Patch application keeps graph mutation invariants in one auditable command. */
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { stableJsonHash } from "@/modules/ai";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { getCompiledPlanByPlanId } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { createEmptyPlanOutput, createPlanGraphFromCompiledPlan } from "@/modules/plan-execution/persistence/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/persistence/plan-runtime-store";
import {
  analyzeStructuralChangeImpact,
  applyDownstreamInvalidation,
  applyGraphMutation,
} from "@chrona/graph-runtime";
import type {
  EditableNode,
  EditableTaskNode,
  GraphMutationOperation,
  GraphMutationRequest,
  NodeDefinition,
  NodeResult,
  PlanGraph,
  PlanOutputState,
  PlanRun,
} from "@chrona/contracts/ai";
import type { GraphExecutionState, GraphMutationOperation as RuntimeGraphMutationOperation } from "@chrona/graph-runtime";
import { TaskPlanHeadConflictError } from "./task-plan-generation-persistence";

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type PlanPatchInput = {
  taskId: string;
  workBlockId?: string | null;
  expectedHeadStateVersion: number;
  idempotencyKey: string;
  operation: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  nodePatches?: Array<{ id: string } & Record<string, unknown>>;
  deletedNodeIds?: string[];
  summary?: string;
};
type PlanMutationReceipt = {
  taskId: string;
  graphId: string;
  revision: number;
  affectedNodeIds: string[];
  invalidatedNodeIds: string[];
};

type PlanPatchReceipt = {
  task_id: string;
  work_block_id: string | null;
  idempotency_key: string;
  command_fingerprint: string;
  operation: string;
  receipt: {
    task_id: string;
    graph_id: string;
    revision: number;
    affected_node_ids: string[];
    invalidated_node_ids: string[];
  };
};

type PlanPatchReceiptCommand = {
  dedupeKey: string;
  taskId: string;
  workBlockId: string | null;
  idempotencyKey: string;
  operation: string;
  fingerprint: string;
};

function parsePlanPatchReceipt(value: unknown): PlanPatchReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  const result = receipt.receipt;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const parsedResult = result as Record<string, unknown>;
  const affectedNodeIds = parsedResult.affected_node_ids;
  const invalidatedNodeIds = parsedResult.invalidated_node_ids;
  if (
    typeof receipt.task_id !== "string"
    || (typeof receipt.work_block_id !== "string" && receipt.work_block_id !== null)
    || typeof receipt.idempotency_key !== "string"
    || typeof receipt.command_fingerprint !== "string"
    || typeof receipt.operation !== "string"
    || typeof parsedResult.task_id !== "string"
    || typeof parsedResult.graph_id !== "string"
    || typeof parsedResult.revision !== "number"
    || !Number.isInteger(parsedResult.revision)
    || !Array.isArray(affectedNodeIds)
    || !affectedNodeIds.every((item) => typeof item === "string")
    || !Array.isArray(invalidatedNodeIds)
    || !invalidatedNodeIds.every((item) => typeof item === "string")
  ) {
    return null;
  }
  return {
    task_id: receipt.task_id,
    work_block_id: receipt.work_block_id,
    idempotency_key: receipt.idempotency_key,
    command_fingerprint: receipt.command_fingerprint,
    operation: receipt.operation,
    receipt: {
      task_id: parsedResult.task_id,
      graph_id: parsedResult.graph_id,
      revision: parsedResult.revision,
      affected_node_ids: affectedNodeIds,
      invalidated_node_ids: invalidatedNodeIds,
    },
  };
}

function createPlanPatchReceiptCommand(input: PlanPatchInput): PlanPatchReceiptCommand {
  const workBlockId = input.workBlockId ?? null;
  return {
    dedupeKey: `task_plan.patch:${input.idempotencyKey}`,
    taskId: input.taskId,
    workBlockId,
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    fingerprint: stableJsonHash({
      taskId: input.taskId,
      workBlockId,
      operation: input.operation,
      nodes: input.nodes ?? null,
      edges: input.edges ?? null,
      nodePatches: input.nodePatches ?? null,
      deletedNodeIds: input.deletedNodeIds ?? null,
      summary: input.summary ?? null,
      scope: "future_only",
    }),
  };
}

async function readPlanPatchReceipt(
  client: Pick<typeof db, "event">,
  command: PlanPatchReceiptCommand,
): Promise<PlanMutationReceipt | null> {
  const event = await client.event.findUnique({ where: { dedupeKey: command.dedupeKey }, select: { payload: true } });
  if (!event) return null;

  const receipt = parsePlanPatchReceipt(event.payload);
  if (
    !receipt
    || receipt.task_id !== command.taskId
    || receipt.work_block_id !== command.workBlockId
    || receipt.idempotency_key !== command.idempotencyKey
    || receipt.operation !== command.operation
    || receipt.command_fingerprint !== command.fingerprint
    || receipt.receipt.task_id !== command.taskId
  ) {
    throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Idempotency key was already used for a different plan patch command.");
  }
  return {
    taskId: receipt.receipt.task_id,
    graphId: receipt.receipt.graph_id,
    revision: receipt.receipt.revision,
    affectedNodeIds: receipt.receipt.affected_node_ids,
    invalidatedNodeIds: receipt.receipt.invalidated_node_ids,
  };
}

function rawToTaskNode(raw: Record<string, unknown>, id: string): EditableTaskNode {
  return {
    id,
    type: "task",
    title: (typeof raw.title === "string" ? raw.title : id) as string,
    executor: (typeof raw.executionMode === "string" && raw.executionMode === "manual" ? "user" : "ai") as "ai" | "user",
    mode: (typeof raw.executionMode === "string" && raw.executionMode === "manual"
      ? "manual"
      : typeof raw.executionMode === "string" && raw.executionMode === "hybrid"
        ? "assist"
        : "auto") as "auto" | "assist" | "manual",
    userInteraction: raw.userInteraction && typeof raw.userInteraction === "object"
      ? raw.userInteraction as EditableTaskNode["userInteraction"]
      : { level: "not_expected" },
    ...(raw.completionForm && typeof raw.completionForm === "object"
      ? { completionForm: raw.completionForm as EditableTaskNode["completionForm"] }
      : {}),
    ...(typeof raw.estimatedMinutes === "number" ? { estimatedMinutes: raw.estimatedMinutes } : {}),
    ...(typeof raw.objective === "string" ? { expectedOutput: raw.objective } : {}),
  };
}

function editableNodeToDefinition(node: EditableNode): NodeDefinition {
  switch (node.type) {
    case "checkpoint":
      return {
        title: node.title,
        objective: node.prompt,
        semantics: {
          type: "checkpoint",
          metadata: {
            checkpointType: node.checkpointType,
            required: node.required,
            options: node.options,
            inputFields: node.inputFields,
            interaction: node.interaction,
          },
        },
      };
    case "condition":
      return {
        title: node.title,
        objective: node.condition,
        semantics: {
          type: "condition",
          metadata: {
            evaluationBy: node.evaluationBy,
            branches: node.branches,
            defaultNextNodeId: node.defaultNextNodeId,
          },
        },
      };
    case "wait":
      return {
        title: node.title,
        objective: node.waitFor,
        estimatedMinutes: node.estimatedMinutes,
        semantics: {
          type: "wait",
          metadata: {
            timeout: node.timeout,
          },
        },
      };
    case "task":
    default:
      return {
        title: node.title,
        objective: node.expectedOutput ?? node.title,
        estimatedMinutes: node.estimatedMinutes,
        executor: node.executor,
        semantics: {
          type: "task",
          mode: node.mode,
          metadata: {
            completionCriteria: node.completionCriteria,
            completionForm: node.completionForm,
            userInteraction: node.userInteraction,
          },
        },
      };
  }
}

function markCurrentResults(
  results: NodeResult[],
  nodeIds: string[],
  nextStatus: NonNullable<NodeResult["status"]>,
): NodeResult[] {
  const targetIds = new Set(nodeIds);
  return results.map((result) =>
    result.nodeId && targetIds.has(result.nodeId) && result.status === "current"
      ? { ...result, status: nextStatus }
      : result,
  );
}

async function ensureGraphRuntime(input: { taskId: string; workBlockId?: string | null; expectedHeadStateVersion: number }) {
  const task = await db.task.findUnique({ where: { id: input.taskId } });
  if (!task) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  const head = await db.taskPlanGenerationHead.findUnique({
    where: { taskId_workBlockScopeKey: { taskId: input.taskId, workBlockScopeKey: input.workBlockId ?? "" } },
  });
  if (!head?.currentPlanId) {
    throw new EngineError(ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "No current plan head found for this task");
  }
  const saved = await getCompiledPlanByPlanId(input.taskId, head.currentPlanId);
  if (!saved || saved.workBlockId !== (input.workBlockId ?? null)) {
    throw new EngineError(ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "Task plan head is not available in this scope");
  }
  const persistedRow = await db.taskPlanRun.findUnique({
    where: {
      taskId_planId_workBlockScopeKey: {
        taskId: input.taskId,
        planId: saved.compiledPlan.editablePlanId,
        workBlockScopeKey: saved.workBlockId ?? "",
      },
    },
    select: { planRun: true },
  });
  const persisted = persistedRow?.planRun as {
    planRun?: PlanRun;
    mutableGraph?: {
      graph?: PlanGraph;
      attempts?: GraphExecutionState["attempts"];
      results?: GraphExecutionState["results"];
      executionContextSnapshots?: GraphExecutionState["executionContextSnapshots"];
      planOutput?: PlanOutputState;
    };
  } | undefined;
  return {
    task,
    saved,
    persisted,
    headVersion: head.stateVersion,
    graph: structuredClone(persisted?.mutableGraph?.graph ?? createPlanGraphFromCompiledPlan({ taskId: input.taskId, compiledPlan: saved.compiledPlan })),
    attempts: structuredClone(persisted?.mutableGraph?.attempts ?? []),
    results: structuredClone(persisted?.mutableGraph?.results ?? []),
    executionContextSnapshots: structuredClone(persisted?.mutableGraph?.executionContextSnapshots ?? []),
  };
}

export async function applyPlanMutationCommand(input: {
  taskId: string;
  workBlockId?: string | null;
  expectedHeadStateVersion: number;
  idempotencyKey: string;
  mutation: GraphMutationRequest;
  receiptCommand?: PlanPatchReceiptCommand;
}) {
  if (input.receiptCommand) {
    const existingReceipt = await readPlanPatchReceipt(db, input.receiptCommand);
    if (existingReceipt) return existingReceipt;
  }
  const state = await ensureGraphRuntime(input);
  const graph = state.graph as unknown as GraphExecutionState["graph"];
  const operations = input.mutation.operations as unknown as RuntimeGraphMutationOperation[];
  const mutationId = input.idempotencyKey;

  if (input.mutation.expectedGraphId && input.mutation.expectedGraphId !== graph.id) {
    throw new Error(`Graph mismatch: expected ${input.mutation.expectedGraphId}, got ${graph.id}`);
  }
  if (
    input.mutation.expectedRevision !== undefined &&
    input.mutation.expectedRevision !== graph.mutations.length
  ) {
    throw new Error(`Graph revision mismatch: expected ${input.mutation.expectedRevision}, got ${graph.mutations.length}`);
  }

  const impact = analyzeStructuralChangeImpact({ graph, operations });
  const mutationResult = applyGraphMutation({
    graph,
    operations,
    reason: input.mutation.reason,
    createdBy: "user",
    mutationId,
  });
  const invalidationPlan = {
    rootNodeIds: impact.affectedNodeIds,
    invalidatedNodeIds: impact.invalidatedNodeIds,
    reason: input.mutation.reason,
  };
  let runtimeState: GraphExecutionState = {
    graph: mutationResult.graph,
    attempts: state.attempts as unknown as GraphExecutionState["attempts"],
    results: markCurrentResults(state.results, impact.affectedNodeIds, "obsolete") as unknown as GraphExecutionState["results"],
    executionContextSnapshots: state.executionContextSnapshots as unknown as GraphExecutionState["executionContextSnapshots"],
  };
  runtimeState = applyDownstreamInvalidation({
    state: runtimeState,
    plan: invalidationPlan,
    mutationId,
    now: mutationResult.mutation.createdAt,
  });

  const graphWithInvalidation = {
    ...runtimeState.graph,
    mutations: runtimeState.graph.mutations.map((mutation) =>
      mutation.id === mutationId
        ? { ...mutation, invalidatedNodeIds: invalidationPlan.invalidatedNodeIds }
        : mutation,
    ),
  };
  const receipt: PlanMutationReceipt = {
    taskId: input.taskId,
    graphId: graph.id,
    revision: graphWithInvalidation.mutations.length,
    affectedNodeIds: impact.affectedNodeIds,
    invalidatedNodeIds: invalidationPlan.invalidatedNodeIds,
  };
  const scopeKey = state.saved.workBlockId ?? "";

  try {
    return await db.$transaction(async (tx) => {
      if (input.receiptCommand) {
        const existingReceipt = await readPlanPatchReceipt(tx, input.receiptCommand);
        if (existingReceipt) return existingReceipt;
      }

      const headUpdate = await tx.taskPlanGenerationHead.updateMany({
        where: {
          taskId: input.taskId,
          workBlockScopeKey: scopeKey,
          currentPlanId: state.saved.compiledPlan.editablePlanId,
          stateVersion: input.expectedHeadStateVersion,
        },
        data: { stateVersion: { increment: 1 } },
      });
      if (headUpdate.count !== 1) throw new TaskPlanHeadConflictError();

      const persistedPlanRun = {
        planRun: state.persisted?.planRun ?? createPlanRunFromCompiledPlan(state.saved.compiledPlan),
        mutableGraph: {
          graph: graphWithInvalidation,
          attempts: runtimeState.attempts,
          results: runtimeState.results,
          executionContextSnapshots: runtimeState.executionContextSnapshots,
          planOutput: state.persisted?.mutableGraph?.planOutput ?? createEmptyPlanOutput(),
        },
      };
      await tx.taskPlanRun.upsert({
        where: {
          taskId_planId_workBlockScopeKey: {
            taskId: input.taskId,
            planId: state.saved.compiledPlan.editablePlanId,
            workBlockScopeKey: scopeKey,
          },
        },
        update: { planRun: toPrismaJson(persistedPlanRun) },
        create: {
          workspaceId: state.task.workspaceId,
          taskId: input.taskId,
          workBlockId: state.saved.workBlockId,
          workBlockScopeKey: scopeKey,
          planId: state.saved.compiledPlan.editablePlanId,
          planRun: toPrismaJson(persistedPlanRun),
        },
      });
      if (input.receiptCommand) {
        await tx.event.create({
          data: {
            eventType: "task_plan.patch_applied",
            workspaceId: state.task.workspaceId,
            taskId: input.taskId,
            workBlockId: state.saved.workBlockId,
            planId: state.saved.compiledPlan.editablePlanId,
            actorType: "user",
            actorId: null,
            source: "task_plan",
            payload: {
              task_id: input.receiptCommand.taskId,
              work_block_id: input.receiptCommand.workBlockId,
              idempotency_key: input.receiptCommand.idempotencyKey,
              command_fingerprint: input.receiptCommand.fingerprint,
              operation: input.receiptCommand.operation,
              receipt: {
                task_id: receipt.taskId,
                graph_id: receipt.graphId,
                revision: receipt.revision,
                affected_node_ids: receipt.affectedNodeIds,
                invalidated_node_ids: receipt.invalidatedNodeIds,
              },
            } as Prisma.InputJsonValue,
            summary: "Applied task plan patch",
            dedupeKey: input.receiptCommand.dedupeKey,
            ingestSequence: 0,
          },
        });
      }
      return receipt;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (cause) {
    if (input.receiptCommand) {
      const racedReceipt = await readPlanPatchReceipt(db, input.receiptCommand);
      if (racedReceipt) return racedReceipt;
    }
    throw cause;
  }
}

function toGraphMutationOperation(input: {
  operation: PlanPatchInput["operation"];
  taskId: string;
  nodes?: PlanPatchInput["nodes"];
  edges?: PlanPatchInput["edges"];
  nodePatches?: PlanPatchInput["nodePatches"];
  deletedNodeIds?: PlanPatchInput["deletedNodeIds"];
}): GraphMutationOperation[] {
  switch (input.operation) {
    case "add_node":
      return (input.nodes ?? []).map((raw, index) => {
        const nodeId = typeof raw.id === "string" && raw.id.trim() ? raw.id : `node-${Date.now()}-${index}`;
        const editableNode = rawToTaskNode(raw, nodeId);
        return {
          type: "add_node",
          nodeId,
          semanticKey: nodeId,
          definitionLayer: {
            id: `definition_${nodeId}_${Date.now()}`,
            nodeId,
            type: "definition",
            createdAt: new Date().toISOString(),
            createdBy: "user",
            definition: editableNodeToDefinition(editableNode),
          },
        } satisfies GraphMutationOperation;
      });
    case "update_node":
      return (input.nodePatches ?? []).map((patch) => ({
        type: "push_node_layer",
        nodeId: patch.id,
        layer: {
          id: `definition_${patch.id}_${Date.now()}`,
          nodeId: patch.id,
          type: "definition",
          createdAt: new Date().toISOString(),
          createdBy: "user",
          definition: {
            title: typeof patch.title === "string" ? patch.title : patch.id,
            objective: typeof patch.objective === "string" ? patch.objective : patch.id,
            description: typeof patch.description === "string" ? patch.description : undefined,
            estimatedMinutes: typeof patch.estimatedMinutes === "number" ? patch.estimatedMinutes : undefined,
            semantics: {
              type: "task",
            },
          },
        },
      }));
    case "delete_node":
      return (input.deletedNodeIds ?? []).map((nodeId) => ({ type: "delete_node", nodeId }));
    case "update_dependencies":
      return (input.edges ?? []).map((edge, index) => ({
        type: "add_edge",
        edge: {
          id: `edge_${Date.now()}_${index}`,
          fromNodeId: edge.fromNodeId as string,
          toNodeId: edge.toNodeId as string,
          type: "hard_dependency",
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }));
    default:
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        `Unsupported plan operation: ${input.operation}`,
      );
  }
}

export async function applyPlanPatchCommand(input: PlanPatchInput) {
  const receiptCommand = createPlanPatchReceiptCommand(input);
  const existingReceipt = await readPlanPatchReceipt(db, receiptCommand);
  if (existingReceipt) {
    return {
      operation: input.operation,
      ...existingReceipt,
    };
  }

  const operations = toGraphMutationOperation({
    operation: input.operation,
    taskId: input.taskId,
    nodes: input.nodes,
    edges: input.edges,
    nodePatches: input.nodePatches,
    deletedNodeIds: input.deletedNodeIds,
  });

  if (operations.length === 0) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      `Unsupported plan operation: ${input.operation}`,
    );
  }

  const result = await applyPlanMutationCommand({
    taskId: input.taskId,
    workBlockId: input.workBlockId,
    expectedHeadStateVersion: input.expectedHeadStateVersion,
    idempotencyKey: input.idempotencyKey,
    mutation: {
      reason: input.summary ?? `Applied plan operation: ${input.operation}`,
      operations,
      scope: "future_only",
    },
    receiptCommand,
  });

  return {
    operation: input.operation,
    ...result,
  };
}
