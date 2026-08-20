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
import { createLogger } from "@chrona/logging";
import type { AgentToolOperationsDeps, ToolAuditContext } from "./types";
import { requireTaskId } from "./input-guards";
import { startToolAudit, finishToolAudit } from "./audit";
import { executeValidatedTool } from "./dispatch";


const toolDescriptions: Record<ChronaToolName, string> = {
  "chrona.task.read": "Read task lifecycle state.",
  "chrona.task.create": "Create a task through Chrona validation.",
  "chrona.task.update": "Update task fields through Chrona validation.",
  "chrona.goal.results.read": "Search bounded Goal knowledge metadata or read approved asset content by opaque ref.",
  "chrona.plan.read": "Read accepted plan state.",
  "chrona.plan.mutate": "Apply a plan graph mutation.",
  "chrona.schedule.read": "Read task schedule state.",
  "chrona.schedule.propose": "Create a schedule proposal.",
  "chrona.schedule.set": "Set accepted schedule state.",
  "chrona.schedule.clear": "Clear accepted schedule state.",
  "chrona.execution.read": "Read execution state summary.",
  "chrona.execution.dispatch": "Dispatch an execution lifecycle action.",
  "chrona.node.read": "Read current execution node state.",
  "chrona.node.complete": "Complete the current task node.",
  "chrona.node.condition_select": "Select the current condition node branch.",
  "chrona.node.block": "Block the current execution node.",
  "chrona.node.request_input": "Request structured user input for the current execution node.",
  "chrona.node.fail": "Fail the current execution node.",
  "chrona.node.wait_complete": "Complete the current wait node.",
};

const idempotentResults = new Map<string, ChronaToolResult>();
const logger = createLogger("engine.agent-tools");

type PersistedMutationIdentity = {
  workspaceId: string;
  taskScopeKey: string;
  taskSessionScopeKey: string;
  runScopeKey: string;
  nodeScopeKey: string;
  toolName: ChronaToolName;
  idempotencyKey: string;
};

type PersistedMutationFlight = {
  key: string;
  promise: Promise<ChronaToolResult>;
  resolve: (result: ChronaToolResult) => void;
};

const persistedMutationFlights = new Map<string, PersistedMutationFlight>();

function persistedMutationIdentity(
  scope: PersistedCapabilityScope,
  operation: ChronaToolOperation,
): PersistedMutationIdentity {
  return {
    workspaceId: scope.workspaceId,
    taskScopeKey: scope.taskId,
    taskSessionScopeKey: scope.taskSessionId,
    runScopeKey: scope.runId,
    nodeScopeKey: scope.nodeId ?? "",
    toolName: operation.toolName,
    idempotencyKey: operation.input.idempotencyKey!,
  };
}

function persistedMutationFlightKey(identity: PersistedMutationIdentity) {
  return [
    identity.workspaceId,
    identity.taskScopeKey,
    identity.taskSessionScopeKey,
    identity.runScopeKey,
    identity.nodeScopeKey,
    identity.toolName,
    identity.idempotencyKey,
  ].join(":");
}

function createPersistedMutationFlight(key: string): PersistedMutationFlight {
  let resolve!: (result: ChronaToolResult) => void;
  const promise = new Promise<ChronaToolResult>((complete) => {
    resolve = complete;
  });
  return { key, promise, resolve };
}

function settlePersistedMutationFlight(flight: PersistedMutationFlight | null, result: ChronaToolResult) {
  if (!flight) return;
  persistedMutationFlights.delete(flight.key);
  flight.resolve(result);
}

export function resetAgentToolMutationFlightsForTest() {
  persistedMutationFlights.clear();
}
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

type PersistedCapabilityScope = {
  workspaceId: string;
  taskId: string;
  taskSessionId: string;
  runId: string;
  nodeId: string | null;
};

type CapabilityTaskSession = {
  activeRunId: string | null;
  allowedToolNames: string;
  capabilityScope: string;
  createdByFramework: boolean;
  id: string;
  sessionKey: string;
  status: string;
  task: { id: string; workspaceId: string };
};

type CapabilityRun = {
  id: string;
  status: string;
  taskId: string;
  taskSessionId: string | null;
};

type PersistedMutationClaim =
  | { state: "claimed"; id: string; flight: PersistedMutationFlight }
  | { state: "completed"; result: ChronaToolResult }
  | { state: "pending" };

function isActiveRunStatus(status: string) {
  return status === "Pending" || status === "Running" || status === "WaitingForInput" || status === "WaitingForApproval";
}

function allowedToolNames(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((name) => typeof name === "string")
      ? new Set(parsed)
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
function requirePersistedCapabilitySession(
  taskSession: CapabilityTaskSession | null,
  input: ChronaToolOperation["input"],
  toolName: ChronaToolName,
): CapabilityTaskSession {
  if (!taskSession || !taskSession.createdByFramework) {
    throw new Error(`${toolName} requires a Chrona-owned capability session.`);
  }
  if (input.taskId && input.taskId !== taskSession.task.id) {
    throw new Error("Supplied taskId does not match the persisted capability session.");
  }
  if (input.workspaceId && input.workspaceId !== taskSession.task.workspaceId) {
    throw new Error("Supplied workspaceId does not match the persisted capability session.");
  }
  if (taskSession.capabilityScope === "unknown" || !allowedToolNames(taskSession.allowedToolNames).has(toolName)) {
    throw new Error(`${toolName} is not granted by the persisted capability session.`);
  }
  if (taskSession.status === "idle" || !taskSession.activeRunId) {
    throw new Error(`${toolName} requires an active task session and run.`);
  }
  return taskSession;
}

async function findCapabilityTaskSession(sessionId: string, toolName: ChronaToolName): Promise<CapabilityTaskSession | null> {
  const taskSession = await db.taskSession.findUnique({
    where: { id: sessionId },
    include: { task: { select: { id: true, workspaceId: true } } },
  });
  if (taskSession) return taskSession;

  const taskSessions = await db.taskSession.findMany({
    where: { sessionKey: sessionId },
    include: { task: { select: { id: true, workspaceId: true } } },
    take: 2,
  });
  if (taskSessions.length > 1) {
    throw new Error(`${toolName} capability session identifier is ambiguous.`);
  }
  return taskSessions[0] ?? null;
}

async function resolveCapabilityRun(
  taskSession: CapabilityTaskSession,
  toolName: ChronaToolName,
): Promise<CapabilityRun> {
  const run = await db.run.findUnique({
    where: { id: taskSession.activeRunId! },
    select: { id: true, taskId: true, taskSessionId: true, status: true },
  });
  if (!run || run.taskId !== taskSession.task.id || run.taskSessionId !== taskSession.id || !isActiveRunStatus(run.status)) {
    throw new Error(`${toolName} capability session no longer owns an active run.`);
  }
  return run;
}

async function resolveActiveNodeId(
  input: ChronaToolOperation["input"],
  taskSession: CapabilityTaskSession,
  toolName: ChronaToolName,
): Promise<string | null> {
  if (!toolName.startsWith("chrona.node.")) return null;
  const executionSession = await db.executionSession.findFirst({
    where: {
      workspaceId: taskSession.task.workspaceId,
      taskId: taskSession.task.id,
      status: { in: ["Active", "Paused"] },
    },
    orderBy: { updatedAt: "desc" },
    select: { currentNodeId: true },
  });
  const nodeId = executionSession?.currentNodeId;
  if (!nodeId) throw new Error(`${toolName} requires an active execution node.`);
  const payload = input.payload as Record<string, unknown> | undefined;
  const requestedNodeId = typeof payload?.nodeId === "string" ? payload.nodeId : input.expectedState?.nodeId;
  if (requestedNodeId && requestedNodeId !== nodeId) {
    throw new Error("Supplied nodeId does not match the active execution node.");
  }
  return nodeId;
}

async function resolvePersistedCapabilityScope(
  input: ChronaToolOperation["input"],
  toolName: ChronaToolName,
  resolvedTaskSession?: CapabilityTaskSession | null,
): Promise<PersistedCapabilityScope> {
  const suppliedSessionId = input.sessionId?.trim();
  if (!suppliedSessionId) {
    throw new Error(`${toolName} requires a persisted capability session.`);
  }
  const taskSession = requirePersistedCapabilitySession(
    resolvedTaskSession ?? await findCapabilityTaskSession(suppliedSessionId, toolName),
    input,
    toolName,
  );
  const [run, nodeId] = await Promise.all([
    resolveCapabilityRun(taskSession, toolName),
    resolveActiveNodeId(input, taskSession, toolName),
  ]);
  return {
    workspaceId: taskSession.task.workspaceId,
    taskId: taskSession.task.id,
    taskSessionId: taskSession.id,
    runId: run.id,
    nodeId,
  };
}

async function claimPersistedMutation(
  scope: PersistedCapabilityScope,
  operation: ChronaToolOperation,
): Promise<PersistedMutationClaim> {
  const where = persistedMutationIdentity(scope, operation);
  const existing = await db.agentToolMutation.findFirst({
    where,
    select: { result: true },
  });
  if (existing?.result && typeof existing.result === "object") {
    return { state: "completed", result: existing.result as unknown as ChronaToolResult };
  }
  if (existing) return { state: "pending" };

  const key = persistedMutationFlightKey(where);
  const activeFlight = persistedMutationFlights.get(key);
  if (activeFlight) {
    return { state: "completed", result: await activeFlight.promise };
  }

  const flight = createPersistedMutationFlight(key);
  persistedMutationFlights.set(key, flight);
  try {
    const claimed = await db.agentToolMutation.create({
      data: {
        ...where,
        taskId: scope.taskId,
        taskSessionId: scope.taskSessionId,
        runId: scope.runId,
      },
      select: { id: true },
    });
    return { state: "claimed", id: claimed.id, flight };
  } catch (error) {
    persistedMutationFlights.delete(key);
    if (!isUniqueConstraintError(error)) throw error;
    return { state: "pending" };
  }
}
async function completePersistedMutation(id: string, result: ChronaToolResult) {
  await db.agentToolMutation.update({
    where: { id },
    data: { status: result.status, result: result as object },
  });
}

async function completePersistedMutationIfClaimed(
  claim: PersistedMutationClaim | null,
  result: ChronaToolResult,
) {
  if (claim?.state !== "claimed") return;
  try {
    await completePersistedMutation(claim.id, result);
  } finally {
    settlePersistedMutationFlight(claim.flight, result);
  }
}

function replayPersistedMutation(input: {
  operationId: string;
  toolName: ChronaToolName;
  original: ChronaToolResult;
}) {
  return duplicateOperationToolResult({
    operationId: input.operationId,
    toolName: input.toolName,
    message: "Duplicate operation replayed without new side effects.",
    affected: input.original.affected,
    state: input.original.state,
    auditRef: input.original.auditRef,
    recovery: input.original.recovery,
  });
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

function taskIdFromResult(result: unknown) {
  if (!result || typeof result !== "object" || !("task" in result)) return undefined;
  const task = result.task;
  if (!task || typeof task !== "object" || !("id" in task)) return undefined;
  return typeof task.id === "string" ? task.id : undefined;
}

function acceptedStateFor(toolName: ChronaToolName, state: Record<string, unknown>, result: unknown) {
  return toolName === "chrona.goal.results.read" ? { ...state, result } : state;
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
  if (!isEngineError(cause)) return "INTERNAL_ERROR" as const;
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
type PreparedMutation =
  | { key: string; persistedClaim: PersistedMutationClaim | null }
  | { result: ChronaToolResult };

function missingIdempotencyResult(
  operationId: string,
  operation: ChronaToolOperation,
  audit: ToolAuditContext | null,
) {
  const { toolName, input } = operation;
  return validationErrorToolResult({
    operationId,
    toolName,
    message: "idempotencyKey is required for mutating Chrona tool calls.",
    affected: affectedFrom(input),
    auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? operationId,
    recovery: { nextTool: toolName, details: { required: "idempotencyKey" } },
    evidence: operationEvidence(input),
  });
}

function inMemoryReplayResult(
  operationId: string,
  toolName: ChronaToolName,
  key: string,
) {
  const original = idempotentResults.get(key);
  return original ? replayPersistedMutation({ operationId, toolName, original }) : null;
}

function pendingMutationResult(
  operationId: string,
  operation: ChronaToolOperation,
  audit: ToolAuditContext | null,
) {
  const { toolName, input } = operation;
  return rejectedToolResult({
    operationId,
    toolName,
    reasonCode: "CONFLICT",
    message: "An identical mutation is still in progress.",
    affected: affectedFrom(input),
    auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? operationId,
    recovery: { nextTool: readToolFor(toolName) },
  });
}

function unauthorizedMutationResult(
  operationId: string,
  operation: ChronaToolOperation,
  audit: ToolAuditContext | null,
  cause: unknown,
) {
  const { toolName, input } = operation;
  return rejectedToolResult({
    operationId,
    toolName,
    reasonCode: "UNAUTHORIZED",
    message: cause instanceof Error ? cause.message : "Capability verification failed.",
    affected: affectedFrom(input),
    auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? operationId,
    recovery: { nextTool: readToolFor(toolName) },
  });
}
async function claimPersistentMutation(
  operationId: string,
  operation: ChronaToolOperation,
  audit: ToolAuditContext | null,
  key: string,
): Promise<PreparedMutation> {
  const { toolName, input } = operation;
  try {
    const persistedClaim = await claimPersistedMutation(
      await resolvePersistedCapabilityScope(input, toolName),
      operation,
    );
    if (persistedClaim.state === "completed") {
      const result = replayPersistedMutation({ operationId, toolName, original: persistedClaim.result });
      await finishToolAudit(audit, operation, result, "duplicate");
      return { result };
    }
    if (persistedClaim.state === "pending") {
      const result = pendingMutationResult(operationId, operation, audit);
      await finishToolAudit(audit, operation, result, "rejected");
      return { result };
    }
    return { key, persistedClaim };
  } catch (cause) {
    const result = unauthorizedMutationResult(operationId, operation, audit, cause);
    await finishToolAudit(audit, operation, result, "rejected");
    return { result };
  }
}

async function prepareMutation(
  operationId: string,
  operation: ChronaToolOperation,
  audit: ToolAuditContext | null,
): Promise<PreparedMutation> {
  const { toolName, input } = operation;
  const mutates = isChronaToolMutating(toolName);
  if (mutates && !input.idempotencyKey) {
    const result = missingIdempotencyResult(operationId, operation, audit);
    await finishToolAudit(audit, operation, result, "validation_error");
    return { result };
  }

  const key = duplicateKey(operation);
  const replay = mutates ? inMemoryReplayResult(operationId, toolName, key) : null;
  if (replay) {
    await finishToolAudit(audit, operation, replay, "duplicate");
    return { result: replay };
  }
  if (!mutates || !input.sessionId) return { key, persistedClaim: null };
  return claimPersistentMutation(operationId, operation, audit, key);
}

async function rejectToolExecution(input: {
  cause: unknown;
  operationId: string;
  operation: ChronaToolOperation;
  audit: ToolAuditContext | null;
  persistedClaim: PersistedMutationClaim | null;
}) {
  const { toolName } = input.operation;
  const diagnostics = rejectionDiagnostics(input.cause);
  const reasonCode = reasonCodeFromError(input.cause);
  if (reasonCode === "INTERNAL_ERROR") {
    logger.error("agent_tool.internal_error", {
      toolName,
      error: input.cause instanceof Error ? input.cause.message : String(input.cause),
    });
  }
  const rejected = rejectedToolResult({
    operationId: input.operationId,
    toolName,
    reasonCode,
    message: reasonCode === "INTERNAL_ERROR"
      ? "Chrona encountered an internal tool error."
      : diagnostics.message,
    affected: affectedFrom(input.operation.input),
    auditRef: input.audit?.invocationId ?? input.audit?.inputRawEventId ?? input.operationId,
    recovery: reasonCode === "INTERNAL_ERROR"
      ? null
      : { nextTool: readToolFor(toolName), details: diagnostics.details },
    evidence: { ...operationEvidence(input.operation.input), ...diagnostics.evidence },
  });
  await completePersistedMutationIfClaimed(input.persistedClaim, rejected);
  await finishToolAudit(input.audit, input.operation, rejected, "rejected");
  return rejected;
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

    async resolveInputContext(input: unknown, toolName?: ChronaToolName) {
      const raw = asInputRecord(input);
      const rawSessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
      const sessionId = rawSessionId;
      const session = sessionId
        ? await findCapabilityTaskSession(sessionId, toolName ?? "chrona.execution.read")
        : null;
      if (session && toolName) {
        const parsed = chronaToolInputSchema.parse(raw);
        const scope = await resolvePersistedCapabilityScope(parsed, toolName, session);
        return chronaToolInputSchema.parse({
          ...raw,
          workspaceId: scope.workspaceId,
          taskId: scope.taskId,
          sessionId: scope.taskSessionId,
        });
      }
      if (toolName && isChronaToolMutating(toolName)) {
        const parsed = chronaToolInputSchema.parse(raw);
        const scope = await resolvePersistedCapabilityScope(parsed, toolName);
        return chronaToolInputSchema.parse({
          ...raw,
          workspaceId: scope.workspaceId,
          taskId: scope.taskId,
          sessionId: scope.taskSessionId,
        });
      }
      if (!sessionId && raw.taskId) {
        logger.info("context.resolve.explicit_task", {
          toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
          taskId: raw.taskId,
          workspaceId: raw.workspaceId,
        });
        return chronaToolInputSchema.parse(raw);
      }

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

      const mutation = await prepareMutation(id, operation, audit);
      if ("result" in mutation) return mutation.result;
      const { key, persistedClaim } = mutation;

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
        await completePersistedMutationIfClaimed(persistedClaim, result);
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
          await completePersistedMutationIfClaimed(persistedClaim, result);
          await finishToolAudit(audit, operation, result, "rejected");
          return result;
        }

        const result = await executeValidatedTool(deps, operation, payload, audit);
        const state = summarizeUnknownState(result);
        const stale = mutates ? null : ensureExpectedState(operation, state);
        if (stale) {
          const rejected = rejectedToolResult({
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
          await completePersistedMutationIfClaimed(persistedClaim, rejected);
          await finishToolAudit(audit, operation, rejected, "rejected");
          return rejected;
        }

        const accepted = acceptedToolResult({
          operationId: id,
          toolName,
          message: `${toolName} completed through Chrona-owned state.`,
          affected: affectedFrom({
            workspaceId: input.workspaceId,
            taskId: input.taskId ?? taskIdFromResult(result),
          }),
          state: acceptedStateFor(toolName, state, result),
          auditRef: audit?.invocationId ?? audit?.inputRawEventId ?? id,
          evidence: operationEvidence(input),
        });
        if (mutates) {
          idempotentResults.set(key, accepted);
        }
        await completePersistedMutationIfClaimed(persistedClaim, accepted);
        await finishToolAudit(audit, operation, accepted, "accepted");
        return accepted;
      } catch (cause) {
        return rejectToolExecution({
          cause,
          operationId: id,
          operation,
          audit,
          persistedClaim,
        });
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
