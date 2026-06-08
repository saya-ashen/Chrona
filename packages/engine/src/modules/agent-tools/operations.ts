import {
  chronaToolInputSchema,
  type ChronaToolName,
  type ChronaToolOperation,
  type ChronaToolResult,
  chronaToolNames,
  isChronaToolMutating,
  parseChronaToolPayload,
} from "@chrona/contracts";
import { PlanCompileError } from "@chrona/contracts/ai";
import { db } from "@/lib/db";
import { getDefaultWorkspace } from "@/modules/workspaces";
import {
  acceptedToolResult,
  duplicateOperationToolResult,
  rejectedToolResult,
  validationErrorToolResult,
} from "./tool-result";
import { affectedFrom, summarizeUnknownState } from "./state-summary";
import { ENGINE_ERROR_CODES, isEngineError } from "../../errors";
import { createLogger } from "@chrona/shared/logger";
import type { AgentToolOperationsDeps } from "./types";
import { requireTaskId } from "./input-guards";
import { startToolAudit, finishToolAudit } from "./audit";
import { executeValidatedTool } from "./dispatch";


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
  "chrona.node.output": "Append or replace user-visible outputs for the current execution node.",
  "chrona.node.complete": "Complete the current task node.",
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
  if (cause instanceof PlanCompileError) return "VALIDATION_ERROR" as const;
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

function rejectionDiagnostics(cause: unknown) {
  if (cause instanceof PlanCompileError) {
    return {
      message: `${cause.message}: ${cause.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
      details: { issues: cause.issues },
      evidence: { validationIssues: cause.issues },
    };
  }
  return {
    message: cause instanceof Error ? cause.message : "Chrona rejected the tool operation.",
    details: undefined,
    evidence: undefined,
  };
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
      const rawSessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
      const sessionId = rawSessionId;
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
        sessionId: sessionId || undefined,
        taskId: typeof raw.taskId === "string" ? raw.taskId : session?.task.id ?? runtimeRun?.taskId,
        workspaceId,
      });
    },

    async execute(operation: ChronaToolOperation): Promise<ChronaToolResult> {
      const id = operationId();
      const { toolName, input } = operation;
      const mutates = isChronaToolMutating(toolName);
      const audit = await startToolAudit({ operationId: id, operation }).catch(() => null);

      if (mutates && !input.idempotencyKey) {
        const result = validationErrorToolResult({
          operationId: id,
          toolName,
          message: "idempotencyKey is required for mutating Chrona tool calls.",
          affected: affectedFrom(input),
          auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? id,
          recovery: { nextTool: toolName, details: { required: "idempotencyKey" } },
          evidence: operationEvidence(input),
        });
        await finishToolAudit(audit, operation, result, "validation_error");
        return result;
      }

      const key = duplicateKey(operation);
      if (mutates && idempotentResults.has(key)) {
        const original = idempotentResults.get(key)!;
        const result = duplicateOperationToolResult({
          operationId: id,
          toolName,
          message: "Duplicate operation replayed without new side effects.",
          affected: original.affected,
          state: original.state,
          auditRef: original.auditRef,
          recovery: original.recovery,
        });
        await finishToolAudit(audit, operation, result, "duplicate");
        return result;
      }

      let payload: unknown;
      try {
        payload = parseChronaToolPayload(toolName, input.payload);
      } catch (cause) {
        const result = validationErrorToolResult({
          operationId: id,
          toolName,
          message: cause instanceof Error ? cause.message : "Tool payload validation failed.",
          affected: affectedFrom(input),
          auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? id,
          evidence: operationEvidence(input),
        });
        await finishToolAudit(audit, operation, result, "validation_error");
        return result;
      }

      try {
        const staleBeforeMutation = mutates
          ? await ensureFreshBeforeMutation(deps, operation)
          : null;
        if (staleBeforeMutation) {
          const result = rejectedToolResult({
            operationId: id,
            toolName,
            reasonCode: "STALE_STATE",
            message: "Expected revision does not match current Chrona state.",
            affected: affectedFrom(input),
            state: staleBeforeMutation.state,
            auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? id,
            recovery: { nextTool: readToolFor(toolName), details: staleBeforeMutation.stale },
            evidence: operationEvidence(input),
          });
          await finishToolAudit(audit, operation, result, "rejected");
          return result;
        }

        const result = await executeValidatedTool(deps, operation, payload, audit);
        const state = summarizeUnknownState(result);
        const stale = mutates ? null : ensureExpectedState(operation, state);
        if (stale) {
          const result = rejectedToolResult({
            operationId: id,
            toolName,
            reasonCode: "STALE_STATE",
            message: "Expected revision does not match current Chrona state.",
            affected: affectedFrom(input),
            state,
            auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? id,
            recovery: { nextTool: readToolFor(toolName), details: stale },
            evidence: operationEvidence(input),
          });
          await finishToolAudit(audit, operation, result, "rejected");
          return result;
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
          auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? id,
          evidence: operationEvidence(input),
        });
        if (mutates) {
          idempotentResults.set(key, accepted);
        }
        await finishToolAudit(audit, operation, accepted, "accepted");
        return accepted;
      } catch (cause) {
        const diagnostics = rejectionDiagnostics(cause);
        const result = rejectedToolResult({
          operationId: id,
          toolName,
          reasonCode: reasonCodeFromError(cause),
          message: diagnostics.message,
          affected: affectedFrom(input),
          auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? id,
          recovery: { nextTool: readToolFor(toolName), details: diagnostics.details },
          evidence: { ...operationEvidence(input), ...diagnostics.evidence },
        });
        await finishToolAudit(audit, operation, result, "rejected");
        return result;
      }
    },
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
