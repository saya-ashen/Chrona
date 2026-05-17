import {
  chronaToolInputSchema,
  type ChronaToolName,
  type ChronaToolOperation,
  type ChronaToolResult,
  chronaToolNames,
  isChronaToolMutating,
  parseChronaToolPayload,
  type PlanBlueprint,
} from "@chrona/contracts";
import { db } from "@/lib/db";
import { getDefaultWorkspace } from "@/modules/workspaces/get-default-workspace";
import type { createTaskExecutionService } from "./task-execution.service";
import type { createTaskPlanService } from "./task-plan.service";
import type { createTaskScheduleService } from "./task-schedule.service";
import type { createTasksService } from "./tasks.service";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";
import { buildNodeRuntimeInput, buildSemanticRefHistory, refForNode } from "@/modules/plan-execution/node-runtime-refs";
import { NODE_RUNTIME_TERMINAL_TOOLS } from "@/modules/plan-execution/node-runtime-prompts";
import {
  acceptedToolResult,
  duplicateOperationToolResult,
  rejectedToolResult,
  validationErrorToolResult,
} from "./agent-tool-result";
import { affectedFrom, summarizeUnknownState } from "./agent-tool-state-summary";
import { ENGINE_ERROR_CODES, isEngineError } from "../errors";
import { createLogger } from "@chrona/shared/logger";

type AgentToolOperationsDeps = {
  tasks: ReturnType<typeof createTasksService>;
  plan: ReturnType<typeof createTaskPlanService>;
  schedule: ReturnType<typeof createTaskScheduleService>;
  execution: ReturnType<typeof createTaskExecutionService>;
};

const toolDescriptions: Record<ChronaToolName, string> = {
  "chrona.task.read": "Read task lifecycle state.",
  "chrona.task.create": "Create a task through Chrona validation.",
  "chrona.task.update": "Update task fields through Chrona validation.",
  "chrona.plan.read": "Read accepted plan state.",
  "chrona.plan.generate": "Generate a draft plan for the session task.",
  "chrona.plan.mutate": "Apply a plan graph mutation.",
  "chrona.schedule.read": "Read task schedule state.",
  "chrona.schedule.propose": "Create a schedule proposal.",
  "chrona.schedule.set": "Set accepted schedule state.",
  "chrona.schedule.clear": "Clear accepted schedule state.",
  "chrona.execution.read": "Read execution state summary.",
  "chrona.execution.dispatch": "Dispatch an execution lifecycle action.",
  "chrona.node.read": "Read current execution node state.",
  "chrona.node.task_complete": "Complete the current task node.",
  "chrona.node.condition_select": "Select the current condition node branch.",
  "chrona.node.block": "Block the current execution node.",
  "chrona.node.fail": "Fail the current execution node.",
  "chrona.node.wait_complete": "Complete the current wait node.",
};

const idempotentResults = new Map<string, ChronaToolResult>();
const logger = createLogger("engine.agent-tools");

function operationId() {
  return crypto.randomUUID();
}

function duplicateKey(operation: ChronaToolOperation) {
  const { toolName, input } = operation;
  return `${input.workspaceId ?? "workspace"}:${input.taskId ?? "workspace"}:${toolName}:${input.idempotencyKey ?? ""}`;
}

function requireTaskId(input: ChronaToolOperation["input"]) {
  if (!input.taskId) {
    throw new Error("taskId is required");
  }
  return input.taskId;
}

function requireWorkspaceId(input: ChronaToolOperation["input"]) {
  if (!input.workspaceId) {
    throw new Error("workspaceId is required");
  }
  return input.workspaceId;
}

function asInputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function ensureExpectedRevision(operation: ChronaToolOperation, state: Record<string, unknown>) {
  const expected = operation.input.expectedRevision ?? operation.input.expectedState?.planRevision;
  if (expected === undefined) return null;
  const actual = typeof state.planRevision === "number" ? state.planRevision : undefined;
  if (actual === expected) return null;
  return { expectedRevision: expected, actualRevision: actual };
}

function operationEvidence(input: ChronaToolOperation["input"]) {
  return {
    actorType: input.actorType,
    actorId: input.actorId,
    sessionId: input.sessionId,
    providerText: input.evidence?.providerText,
    toolCalls: input.evidence?.toolCalls,
    toolOutputs: input.evidence?.toolOutputs,
    structuredOutput: input.evidence?.structuredOutput,
  };
}

function effectivePlanFrom(value: unknown): EffectivePlanGraph | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const savedPlan = record.savedPlan && typeof record.savedPlan === "object"
    ? record.savedPlan as Record<string, unknown>
    : record.task && typeof record.task === "object"
      ? ((record.task as Record<string, unknown>).savedPlan as Record<string, unknown> | undefined)
      : null;
  const effectivePlan = savedPlan?.effectivePlan;
  if (!effectivePlan || typeof effectivePlan !== "object") return null;
  return effectivePlan as EffectivePlanGraph;
}

function currentNodeFromEffective(plan: EffectivePlanGraph): EffectivePlanNode | null {
  return plan.nodes.find((node) => node.status === "running") ??
    plan.nodes.find((node) =>
      node.status === "waiting_for_user" ||
      node.status === "waiting_for_approval" ||
      node.status === "blocked" ||
      node.status === "failed"
    ) ??
    plan.nodes.find((node) => plan.readyNodeIds.includes(node.id)) ??
    null;
}

function readAiExecutionView(value: unknown) {
  const plan = effectivePlanFrom(value);
  if (!plan) return redactBackendIds(value);
  const history = buildSemanticRefHistory(plan);
  const currentNode = currentNodeFromEffective(plan);
  const task = value && typeof value === "object" && "task" in value && typeof (value as { task?: unknown }).task === "object"
    ? (value as { task: Record<string, unknown> }).task
    : null;
  const savedPlan = value && typeof value === "object" && "savedPlan" in value
    ? (value as { savedPlan?: Record<string, unknown> | null }).savedPlan
    : task?.savedPlan as Record<string, unknown> | null | undefined;

  return {
    task: task
      ? {
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueAt: task.dueAt,
          blockReason: task.blockReason,
        }
      : undefined,
    plan: {
      ref: history.planRef.ref,
      status: savedPlan?.status,
      revision: savedPlan?.revision,
      summary: savedPlan?.summary,
    },
    execution: {
      currentNode: currentNode
        ? buildNodeRuntimeInput({
            plan,
            node: currentNode,
            currentNodeResultActionNames: [...NODE_RUNTIME_TERMINAL_TOOLS[currentNode.type]],
          }).node
        : null,
      readyNodeRefs: plan.readyNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      runningNodeRefs: plan.runningNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      blockedNodeRefs: plan.blockedNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      completedNodeRefs: plan.completedNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
    },
    nodes: plan.nodes.map((node) => {
      const runtime = buildNodeRuntimeInput({
        plan,
        node,
        currentNodeResultActionNames: [...NODE_RUNTIME_TERMINAL_TOOLS[node.type]],
      });
      return {
        ref: runtime.node.ref,
        title: runtime.node.title,
        type: runtime.node.type,
        status: node.status,
        objective: runtime.node.objective,
        expectedOutput: runtime.node.expectedOutput,
        completionCriteria: runtime.node.completionCriteria,
        condition: runtime.node.condition,
        checkpoint: runtime.node.checkpoint,
        wait: runtime.node.wait,
        branchOptions: runtime.branchOptions,
      };
    }),
  };
}

function redactBackendIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBackendIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^(id|.*Id|.*Ids)$/.test(key))
      .map(([key, entry]) => [key, redactBackendIds(entry)]),
  );
}

function ensureExpectedState(operation: ChronaToolOperation, state: Record<string, unknown>) {
  const staleRevision = ensureExpectedRevision(operation, state);
  if (staleRevision) return staleRevision;

  const expected = operation.input.expectedState;
  if (!expected) return null;
  const checks = [
    "taskStatus",
    "scheduleStatus",
    "executionStatus",
    "executionSessionId",
  ] as const;
  for (const key of checks) {
    const expectedValue = expected[key];
    if (expectedValue === undefined) continue;
    if (state[key] !== expectedValue) {
      return { field: key, expected: expectedValue, actual: state[key] };
    }
  }
  return null;
}

function reasonCodeFromError(cause: unknown) {
  if (!isEngineError(cause)) return "INVALID_TRANSITION" as const;
  switch (cause.code) {
    case ENGINE_ERROR_CODES.TASK_NOT_FOUND:
    case ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND:
    case ENGINE_ERROR_CODES.PLAN_NOT_FOUND:
    case ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND:
      return "NOT_FOUND" as const;
    case ENGINE_ERROR_CODES.CONFLICT:
    case ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT:
      return "CONFLICT" as const;
    case ENGINE_ERROR_CODES.VALIDATION_FAILED:
      return "VALIDATION_ERROR" as const;
    case ENGINE_ERROR_CODES.INVALID_TASK_STATE:
    default:
      return "INVALID_TRANSITION" as const;
  }
}

export function createAgentToolOperationsService(deps: AgentToolOperationsDeps) {
  return {
    registry() {
      return {
        tools: chronaToolNames.map((name) => ({
          name,
          mutates: isChronaToolMutating(name),
          description: toolDescriptions[name],
        })),
      };
    },

    async resolveInputContext(input: unknown) {
      const raw = asInputRecord(input);
      const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
      if (!sessionId && raw.taskId) {
        logger.info("context.resolve.explicit_task", {
          toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
          taskId: raw.taskId,
          workspaceId: raw.workspaceId,
        });
        return chronaToolInputSchema.parse(raw);
      }

      const session = sessionId
        ? await db.taskSession.findFirst({
            where: {
              OR: [{ id: sessionId }, { sessionKey: sessionId }],
            },
            include: {
              task: { select: { id: true, workspaceId: true } },
            },
          })
        : null;
      const runtimeRun = !session && sessionId
        ? await db.run.findFirst({
            where: {
              OR: [{ runtimeSessionRef: sessionId }, { runtimeRunRef: sessionId }],
            },
            select: {
              id: true,
              taskId: true,
              taskSessionId: true,
              runtimeName: true,
              runtimeSessionRef: true,
              runtimeRunRef: true,
              status: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
          })
        : null;
      logger.info("context.resolve.session_lookup", {
        sessionId: sessionId || null,
        hasRawTaskId: typeof raw.taskId === "string",
        rawTaskId: typeof raw.taskId === "string" ? raw.taskId : null,
        rawWorkspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : null,
        matchedTaskSession: session
          ? {
              id: session.id,
              sessionKey: session.sessionKey,
              taskId: session.task.id,
              workspaceId: session.task.workspaceId,
            }
          : null,
        matchedRuntimeRun: runtimeRun,
      });
      const workspaceId = typeof raw.workspaceId === "string"
        ? raw.workspaceId
        : session?.task.workspaceId ?? (runtimeRun?.taskId
            ? (await db.task.findUnique({
                where: { id: runtimeRun.taskId },
                select: { workspaceId: true },
              }))?.workspaceId
            : undefined) ?? (await getDefaultWorkspace()).id;

      return chronaToolInputSchema.parse({
        ...raw,
        taskId: typeof raw.taskId === "string" ? raw.taskId : session?.task.id ?? runtimeRun?.taskId,
        workspaceId,
      });
    },

    async execute(operation: ChronaToolOperation): Promise<ChronaToolResult> {
      const id = operationId();
      const { toolName, input } = operation;
      const mutates = isChronaToolMutating(toolName);

      if (mutates && !input.idempotencyKey) {
        return validationErrorToolResult({
          operationId: id,
          toolName,
          message: "idempotencyKey is required for mutating Chrona tool calls.",
          affected: affectedFrom(input),
          auditRef: id,
          recovery: { nextTool: toolName, details: { required: "idempotencyKey" } },
          evidence: operationEvidence(input),
        });
      }

      const key = duplicateKey(operation);
      if (mutates && idempotentResults.has(key)) {
        const original = idempotentResults.get(key)!;
        return duplicateOperationToolResult({
          operationId: id,
          toolName,
          message: "Duplicate operation replayed without new side effects.",
          affected: original.affected,
          state: original.state,
          auditRef: original.auditRef,
          recovery: original.recovery,
        });
      }

      let payload: unknown;
      try {
        payload = parseChronaToolPayload(toolName, input.payload);
      } catch (cause) {
        return validationErrorToolResult({
          operationId: id,
          toolName,
          message: cause instanceof Error ? cause.message : "Tool payload validation failed.",
          affected: affectedFrom(input),
          auditRef: id,
          evidence: operationEvidence(input),
        });
      }

      try {
        const staleBeforeMutation = mutates
          ? await ensureFreshBeforeMutation(deps, operation)
          : null;
        if (staleBeforeMutation) {
          return rejectedToolResult({
            operationId: id,
            toolName,
            reasonCode: "STALE_STATE",
            message: "Expected revision does not match current Chrona state.",
            affected: affectedFrom(input),
            state: staleBeforeMutation.state,
            auditRef: id,
            recovery: { nextTool: readToolFor(toolName), details: staleBeforeMutation.stale },
            evidence: operationEvidence(input),
          });
        }

        const result = await executeValidatedTool(deps, operation, payload);
        const state = summarizeUnknownState(result);
        const stale = mutates ? null : ensureExpectedState(operation, state);
        if (stale) {
          return rejectedToolResult({
            operationId: id,
            toolName,
            reasonCode: "STALE_STATE",
            message: "Expected revision does not match current Chrona state.",
            affected: affectedFrom(input),
            state,
            auditRef: id,
            recovery: { nextTool: readToolFor(toolName), details: stale },
            evidence: operationEvidence(input),
          });
        }

        const accepted = acceptedToolResult({
          operationId: id,
          toolName,
          message: `${toolName} completed through Chrona-owned state.`,
          affected: affectedFrom({
            workspaceId: input.workspaceId,
            taskId: input.taskId ?? (result as { task?: { id?: string } }).task?.id,
          }),
          state,
          auditRef: id,
          evidence: operationEvidence(input),
        });
        if (mutates) {
          idempotentResults.set(key, accepted);
        }
        return accepted;
      } catch (cause) {
        return rejectedToolResult({
          operationId: id,
          toolName,
          reasonCode: reasonCodeFromError(cause),
          message: cause instanceof Error ? cause.message : "Chrona rejected the tool operation.",
          affected: affectedFrom(input),
          auditRef: id,
          recovery: { nextTool: readToolFor(toolName) },
          evidence: operationEvidence(input),
        });
      }
    },
  };
}

async function executeValidatedTool(
  deps: AgentToolOperationsDeps,
  operation: ChronaToolOperation,
  payload: unknown,
) {
  const { input, toolName } = operation;
  switch (toolName) {
    case "chrona.task.read":
      return deps.tasks.getPage({ taskId: requireTaskId(input) });
    case "chrona.task.create":
      return createTaskForTool(deps, input, payload);
    case "chrona.task.update":
      return deps.tasks.update({
        ...(payload as Omit<Parameters<typeof deps.tasks.update>[0], "taskId">),
        taskId: requireTaskId(input),
        workspaceId: requireWorkspaceId(input),
      });
    case "chrona.plan.read":
      return readAiExecutionView(await deps.plan.getState({ taskId: requireTaskId(input) }));
    case "chrona.plan.generate":
      return generatePlanForTool(deps, input, payload);
    case "chrona.plan.mutate":
      return deps.plan.mutate({
        taskId: requireTaskId(input),
        mutation: payload as Parameters<typeof deps.plan.mutate>[0]["mutation"],
      });
    case "chrona.schedule.read":
      return deps.tasks.getPage({ taskId: requireTaskId(input) });
    case "chrona.schedule.propose": {
      const body = payload as {
        source?: string;
        proposedBy?: string;
        summary?: string;
        dueAt?: string | null;
        scheduledStartAt?: string | null;
        scheduledEndAt?: string | null;
      };
      return deps.schedule.propose({
        taskId: requireTaskId(input),
        source: body.source ?? "ai",
        proposedBy: body.proposedBy ?? input.actorId ?? "agent",
        summary: body.summary ?? "Agent schedule proposal",
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        scheduledStartAt: body.scheduledStartAt ? new Date(body.scheduledStartAt) : null,
        scheduledEndAt: body.scheduledEndAt ? new Date(body.scheduledEndAt) : null,
      } as Parameters<typeof deps.schedule.propose>[0]);
    }
    case "chrona.schedule.set": {
      const body = payload as {
        dueAt?: string | null;
        scheduledStartAt: string;
        scheduledEndAt: string;
        scheduleSource?: "human" | "ai" | "system";
      };
      return deps.schedule.apply({
        taskId: requireTaskId(input),
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        scheduledStartAt: new Date(body.scheduledStartAt),
        scheduledEndAt: new Date(body.scheduledEndAt),
        scheduleSource: body.scheduleSource ?? "ai",
      });
    }
    case "chrona.schedule.clear":
      return deps.schedule.clear({ taskId: requireTaskId(input) });
    case "chrona.execution.read":
      return readAiExecutionView(await deps.tasks.getPage({ taskId: requireTaskId(input) }));
    case "chrona.execution.dispatch":
      return deps.execution.dispatch({
        taskId: requireTaskId(input),
        action: payload as Parameters<typeof deps.execution.dispatch>[0]["action"],
      });
    case "chrona.node.read":
      return readAiExecutionView(await deps.tasks.getPage({ taskId: requireTaskId(input) }));
    case "chrona.node.task_complete":
    case "chrona.node.condition_select":
    case "chrona.node.wait_complete": {
      const body = payload as {
        summary?: string;
        outputs?: unknown;
        branchRef?: string;
        decision?: "approved" | "rejected" | "needs_input" | "completed";
        feedback?: string;
        prompt?: string;
        input?: unknown;
      };
      const terminalKind = toolName === "chrona.node.condition_select"
        ? "condition"
        : toolName === "chrona.node.wait_complete"
            ? "wait"
            : "task";
      return deps.execution.submitNodeResult({
        taskId: requireTaskId(input),
        action: {
          action: "complete_manual_node" as const,
          sessionId: input.sessionId,
          summary: body.summary,
          output: body.outputs ?? body.input,
          terminalKind,
          branchRef: body.branchRef,
          decision: body.decision,
          feedback: body.feedback,
          prompt: body.prompt,
        },
      });
    }
    case "chrona.node.block": {
      const body = payload as { reason: string; requiredInput?: string };
      const reason = body.requiredInput
        ? `${body.reason}\nRequired input: ${body.requiredInput}`
        : body.reason;
      return deps.execution.submitNodeResult({
        taskId: requireTaskId(input),
        action: {
          action: "block_current_node" as const,
          sessionId: input.sessionId,
          reason,
        },
      });
    }
    case "chrona.node.fail": {
      const body = payload as { error: string };
      return deps.execution.submitNodeResult({
        taskId: requireTaskId(input),
        action: {
          action: "fail_current_node" as const,
          sessionId: input.sessionId,
          error: body.error,
        },
      });
    }
  }
}

async function createTaskForTool(
  deps: AgentToolOperationsDeps,
  input: ChronaToolOperation["input"],
  payload: unknown,
) {
  const result = await deps.tasks.create({
    ...(payload as Parameters<typeof deps.tasks.create>[0]),
    workspaceId: requireWorkspaceId(input),
  });
  const sessionId = input.sessionId?.trim();
  if (sessionId && "taskId" in result && typeof result.taskId === "string") {
    const existingSession = await db.taskSession.findUnique({ where: { sessionKey: sessionId } });
    if (!existingSession) {
      const task = await db.task.findUnique({
        where: { id: result.taskId },
        select: { title: true, executionRuntime: true },
      });
      await db.taskSession.create({
        data: {
          taskId: result.taskId,
          runtimeName: task?.executionRuntime ?? "unknown",
          sessionKey: sessionId,
          label: `${task?.title ?? "Task"} · Creation session`,
          createdByFramework: true,
        },
      });
    }
  }
  return result;
}

async function generatePlanForTool(
  deps: AgentToolOperationsDeps,
  input: ChronaToolOperation["input"],
  payload: unknown,
) {
  const taskId = requireTaskId(input);
  const workspaceId = requireWorkspaceId(input);
  const savedPlan = await deps.plan.materialize({
    taskId,
    workspaceId,
    blueprint: payload as PlanBlueprint,
    generatedBy: input.actorId ?? "hermes",
  });
  return {
    taskId,
    savedPlan,
  };
}

async function ensureFreshBeforeMutation(
  deps: AgentToolOperationsDeps,
  operation: ChronaToolOperation,
) {
  if (operation.input.expectedRevision === undefined && operation.input.expectedState?.planRevision === undefined) {
    return null;
  }
  if (!operation.input.taskId) {
    return null;
  }
  const state = summarizeUnknownState(await readCurrentStateForMutation(deps, operation));
  const stale = ensureExpectedState(operation, state);
  return stale ? { stale, state } : null;
}

function readCurrentStateForMutation(
  deps: AgentToolOperationsDeps,
  operation: ChronaToolOperation,
) {
  const taskId = requireTaskId(operation.input);
  if (operation.toolName.startsWith("chrona.plan.")) {
    return deps.plan.getState({ taskId });
  }
  return deps.tasks.getPage({ taskId });
}

function readToolFor(toolName: ChronaToolName): ChronaToolName {
  if (toolName.startsWith("chrona.plan.")) return "chrona.plan.read";
  if (toolName.startsWith("chrona.schedule.")) return "chrona.schedule.read";
  if (toolName.startsWith("chrona.execution.") || toolName.startsWith("chrona.node.")) return "chrona.execution.read";
  return "chrona.task.read";
}
