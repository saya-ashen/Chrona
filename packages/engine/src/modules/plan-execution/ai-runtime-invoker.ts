import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { NodeAttempt } from "@chrona/contracts/ai";
import type { ProviderJsonValue, ProviderRunEvent, ProviderRunSnapshot, AgentProviderClient } from "@chrona/providers-foundation";
import { getAiClientForTask, stableJsonHash } from "@/modules/ai";
import {
  persistProviderRuntimeEvent,
  setAfterRawEventPersistedForTest,
  type RuntimeEventPersistenceContext,
} from "./ai-runtime-event-persistence";
import {
  ensureProviderRunRecord,
  readTaskSessionProviderRef,
  requireRuntimeSessionId,
  resolveTaskModel,
  uniqueRuntimeRunRef,
  type EnsuredProviderRunRecord,
} from "./ai-runtime-persistence";
import {
  createExecutionProviderRequest,
  extractAssistantContent,
  type ExecutionProviderRequest,
} from "./ai-runtime-request";
import { runProviderRequest } from "./ai-runtime-provider-stream";
export { runProviderRequest } from "./ai-runtime-provider-stream";
import { mintRunToken } from "./runtime/agent-control-store";
import { ACTIVE_RUN_STATUSES, syncPersistedRunStateInTransaction } from "./persistence/task-execution-store";
import { assertCurrentPlanExecutionOwnership, schedulerWorkSignal, withPlanExecutionDurability } from "./persistence/scheduler-durability";
import { assertRuntimeExecutionScope } from "./persistence/runtime-execution-scope";
type RuntimeProviderClient = AgentProviderClient;

export type AiRuntimeInvocationInput = {
  taskId: string;
  expectedExecutionEpoch: number;
  expectedExecutionSessionId: string;
  taskSessionId: string;
  runtimeName: string;
  runtimeSessionKey: string;
  workBlockId?: string | null;
  nodeContext?: {
    nodeId: string;
    nodeTitle: string;
  };
  nodeAttempt: NodeAttempt;
  clientOperationId: string;
  runtimeInput: Record<string, ProviderJsonValue>;
  instructions: string;
  terminalToolName?: string;
  toolPolicy?: "full" | "read_only";
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
  signal?: AbortSignal;
};

export type AiRuntimeInvocation = {
  runId: string;
  runtimeRunRef: string | null;
  runtimeSessionKey: string;
  conversationEntryIds: string[];
  response: ProviderRunSnapshot;
  providerName: string;
};
export function usesChronaControlPlane(providerName: string) {
  return providerName === "claude_code" || providerName === "codex" || providerName === "omp";
}

export class AiRuntimeInvoker {
  async invoke(input: AiRuntimeInvocationInput): Promise<AiRuntimeInvocation> {
    const { task, run } = await createRuntimeRun(input);
    try {
      return await invokeProviderForRuntime(input, task, run);
    } catch (error) {
      await recordRuntimeInvocationFailure(input, run.id, error);
      throw error;
    }
  }
}

type RuntimeTask = {
  workspaceId: string;
  executionConfig: unknown;
  pinnedModel: string | null;
  pinnedModelSource: string | null;
};

async function createRuntimeRun(input: AiRuntimeInvocationInput): Promise<{ task: RuntimeTask; run: { id: string; workBlockId: string | null; occurrenceId: string | null } }> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { workspaceId: true, executionConfig: true, pinnedModel: true, pinnedModelSource: true },
  });
  const occurrence = await resolveRuntimeOccurrence(input);
  const run = await withPlanExecutionDurability(async (tx) => {
    if (input.nodeAttempt) {
      const activePlanRun = await tx.taskPlanRun.findFirst({
        where: {
          taskId: input.taskId,
          planId: input.nodeAttempt.graphId,
          workBlockId: input.workBlockId ?? null,
          occurrenceId: occurrence?.id ?? null,
          executionEpoch: input.expectedExecutionEpoch,
        },
        select: { id: true },
      });
      const activeExecutionSession = await tx.executionSession.findFirst({
        where: {
          id: input.expectedExecutionSessionId,
          taskId: input.taskId,
          planId: input.nodeAttempt.graphId,
          workBlockId: input.workBlockId ?? null,
          status: "Active",
        },
        select: { id: true, currentNodeAttemptId: true },
      });
      if (!activeExecutionSession) {
        throw new Error("Execution session changed before provider invocation");
      }
      if (!activePlanRun) {
        throw new Error("Plan execution epoch changed before provider invocation");
      }
      const activeAttempt = await tx.taskPlanNodeAttempt.findFirst({
        where: {
          idempotencyKey: input.nodeAttempt.idempotencyKey,
          taskId: input.taskId,
          planId: input.nodeAttempt.graphId,
          planRunId: activePlanRun.id,
          nodeId: input.nodeAttempt.nodeId,
          nodeLayerId: input.nodeAttempt.nodeLayerId,
          attemptNumber: input.nodeAttempt.attemptNumber,
          status: "running",
        },
        select: { id: true, executionEpoch: true },
      });
      if (
        !activeAttempt
        || activeAttempt.executionEpoch > input.expectedExecutionEpoch
        || activeExecutionSession.currentNodeAttemptId !== activeAttempt.id
      ) {
        throw new Error("Cannot create runtime Run outside the active immutable node attempt scope");
      }
      const planClaim = await tx.taskPlanRun.updateMany({
        where: { id: activePlanRun.id, executionEpoch: input.expectedExecutionEpoch },
        data: { executionEpoch: input.expectedExecutionEpoch },
      });
      const attemptClaim = await tx.taskPlanNodeAttempt.updateMany({
        where: { id: activeAttempt.id, executionEpoch: activeAttempt.executionEpoch, status: "running" },
        data: { status: "running" },
      });
      const sessionClaim = await tx.executionSession.updateMany({
        where: { id: activeExecutionSession.id, currentNodeAttemptId: activeAttempt.id, status: "Active" },
        data: { status: "Active" },
      });
      if (planClaim.count !== 1 || attemptClaim.count !== 1 || sessionClaim.count !== 1) {
        throw new Error("Execution scope changed before provider Run creation");
      }
    }
    if (input.nodeAttempt) {
      const existing = await tx.run.findUnique({
        where: { nodeAttemptId: input.nodeAttempt.id },
        select: {
          id: true,
          taskId: true,
          taskSessionId: true,
          workBlockId: true,
          occurrenceId: true,
          runtimeName: true,
          status: true,
        },
      });
      if (existing) {
        if (
          existing.taskId !== input.taskId
          || existing.taskSessionId !== input.taskSessionId
          || existing.workBlockId !== (input.workBlockId ?? null)
          || existing.occurrenceId !== (occurrence?.id ?? null)
          || existing.runtimeName !== input.runtimeName
          || !ACTIVE_RUN_STATUSES.includes(existing.status)
        ) {
          throw new Error("Canonical runtime Run belongs to another or inactive node attempt scope");
        }
        await syncPersistedRunStateInTransaction({ taskId: input.taskId, runId: existing.id, setAsLatest: true }, tx);
        return { id: existing.id, workBlockId: existing.workBlockId, occurrenceId: existing.occurrenceId };
      }
    }
    const created = await tx.run.create({
      data: {
        taskId: input.taskId,
        workBlockId: input.workBlockId ?? null,
        nodeAttemptId: input.nodeAttempt.id,
        occurrenceId: occurrence?.id ?? null,
        taskSessionId: input.taskSessionId,
        runtimeName: input.runtimeName,
        runtimeSessionRef: input.runtimeSessionKey,
        status: RunStatus.Pending,
        triggeredBy: "system",
        startedAt: new Date(),
        syncStatus: "healthy",
      },
      select: { id: true, workBlockId: true, occurrenceId: true },
    });
    await syncPersistedRunStateInTransaction({ taskId: input.taskId, runId: created.id, setAsLatest: true }, tx);
    return created;
  });
  return { task, run };
}

async function resolveRuntimeOccurrence(input: AiRuntimeInvocationInput): Promise<{ id: string } | null> {
  if (input.workBlockId) return db.taskOccurrence.findUnique({ where: { workBlockId: input.workBlockId }, select: { id: true } });
  return db.taskOccurrence.findFirst({
    where: { taskId: input.taskId, status: { in: ["Ready", "Running"] } },
    orderBy: [{ startedAt: "desc" }, { eligibleAt: "asc" }],
    select: { id: true },
  });
}

async function invokeProviderForRuntime(input: AiRuntimeInvocationInput, task: RuntimeTask, run: { id: string; workBlockId: string | null; occurrenceId: string | null }): Promise<AiRuntimeInvocation> {
  const client = await requireRuntimeProviderClient(input.taskId);
  const baseRequest = await createProviderRequest(input, task, client.providerClient);
  const request = {
    ...baseRequest,
    instructions: `${baseRequest.instructions}\nStore every generated deliverable under generated://${run.id}/ and return only URIs inside that Run scope.`,
  };
  const providerRun = await ensureProviderRunRecord({
    taskId: input.taskId,
    expectedExecutionEpoch: input.expectedExecutionEpoch,
    expectedExecutionSessionId: input.expectedExecutionSessionId,
    workspaceId: task.workspaceId,
    workBlockId: run.workBlockId,
    occurrenceId: run.occurrenceId,
    runId: run.id,
    nodeAttempt: input.nodeAttempt,
    aiClientId: client.record.id,
    aiClientConfigDigest: stableJsonHash(client.record.config),
    providerRunIdempotencyKey: input.clientOperationId,
  });
  const options = await providerRequestOptions(input, task, run, providerRun, client.providerClient.provider);
  const response = await runProviderRequest(client.providerClient, request, options);
  return finalizeRuntimeInvocation({
    input,
    runId: run.id,
    providerName: client.providerClient.provider,
    request,
    response,
    providerRunRecordId: providerRun.id,
    scope: options.eventPersistence,
  });
}

async function requireRuntimeProviderClient(taskId: string) {
  const client = await getAiClientForTask({ taskId, purpose: "task.execution" });
  if (!client) throw new Error("AI client is required for task execution");
  if (!client.providerClient) throw new Error(`AI client '${client.record.name}' does not support runtime execution`);
  return client as typeof client & { providerClient: NonNullable<typeof client.providerClient> };
}

async function createProviderRequest(
  input: AiRuntimeInvocationInput,
  task: RuntimeTask,
  providerClient: RuntimeProviderClient,
): Promise<ExecutionProviderRequest> {
  const config = task.executionConfig as Record<string, unknown>;
  const model = await resolveTaskModel({
    taskId: input.taskId,
    executionConfig: config,
    pinnedModel: task.pinnedModel,
    pinnedModelSource: task.pinnedModelSource,
    providerClient,
  });
  return createExecutionProviderRequest({
    provider: providerClient.provider,
    clientOperationId: input.clientOperationId,
    sessionId: input.runtimeSessionKey,
    sessionKey: input.runtimeSessionKey,
    instructions: input.instructions,
    input: input.runtimeInput,
    terminalToolName: input.terminalToolName,
    toolPolicy: input.toolPolicy ?? "full",
    resumeSessionRef: await readTaskSessionProviderRef(input.taskSessionId),
    runtimeConfiguration: runtimeConfiguration(config, model),
  });
}

function runtimeConfiguration(config: Record<string, unknown>, model: string | undefined): ExecutionProviderRequest["runtimeConfiguration"] {
  const strategy = config.contextStrategy;
  const contextStrategy = strategy === "provider_default" || strategy === "auto_compact" || strategy === "bounded_tool_results" || strategy === "artifact_backed" ? strategy : undefined;
  return { ...(model ? { model } : {}), ...(contextStrategy ? { contextStrategy } : {}) };
}

async function providerRequestOptions(
  input: AiRuntimeInvocationInput,
  task: RuntimeTask,
  run: { id: string; workBlockId: string | null; occurrenceId: string | null },
  providerRun: EnsuredProviderRunRecord,
  providerName: string,
) {
  const eventPersistence: RuntimeEventPersistenceContext | undefined = providerRun
    ? {
        workspaceId: task.workspaceId,
        taskId: input.taskId,
        workBlockId: run.workBlockId,
        occurrenceId: run.occurrenceId,
        runId: run.id,
        runtimeName: input.runtimeName,
        taskSessionId: input.taskSessionId,
        executionSessionId: input.expectedExecutionSessionId,
        nodeAttemptId: providerRun.nodeAttemptId,
        providerRunId: providerRun.id,
        planId: input.nodeAttempt.graphId,
        planRunId: providerRun.planRunId,
        executionScope: providerRun.executionScope,
        nodeContext: input.nodeContext,
      }
    : undefined;
  const existingRunId = providerRun.providerRunRef ?? providerRun.nativeRunId;
  const existingSessionId = providerRun.providerSessionRef ?? providerRun.runtimeSessionRef;
  return {
    clientOperationId: input.clientOperationId,
    runId: run.id,
    idempotencyKey: input.clientOperationId,
    providerRunRecordId: providerRun.id,
    providerRunIdentity: providerRun.identity,
    existingRunRef: providerRun?.identity === "existing" && existingRunId && existingSessionId
      ? {
          provider: providerName,
          runId: existingRunId,
          nativeRunId: providerRun.nativeRunId ?? providerRun.providerRunRef,
          sessionId: existingSessionId,
          nativeSessionId: providerRun.providerSessionRef,
          status: "running" as const,
        }
      : undefined,
    onRuntimeEvent: input.onRuntimeEvent,
    terminalToolName: input.terminalToolName,
    controlRunToken: shouldUseControl(input, providerName) ? await mintRuntimeRunToken(input, task, run.id, providerRun?.id) : null,
    onRunStarted: () => withPlanExecutionDurability(async (tx) => {
      if (eventPersistence) await assertRuntimeExecutionScope(tx, eventPersistence);
      await syncPersistedRunStateInTransaction({ taskId: input.taskId, runId: run.id }, tx);
    }),
    eventPersistence,
    signal: schedulerWorkSignal(input.signal),
  };
}
function shouldUseControl(
  input: Pick<AiRuntimeInvocationInput, "nodeContext">,
  providerName: string,
): boolean {
  return Boolean(input.nodeContext) && usesChronaControlPlane(providerName);
}

async function mintRuntimeRunToken(
  input: AiRuntimeInvocationInput,
  task: RuntimeTask,
  runId: string,
  providerRunId?: string,
): Promise<string> {
  return mintRunToken({
    taskId: input.taskId,
    workspaceId: task.workspaceId,
    taskSessionId: input.taskSessionId,
    runId,
    runtimeSessionKey: input.runtimeSessionKey,
    nodeId: input.nodeContext?.nodeId,
    nodeAttemptId: input.nodeAttempt.id,
    providerRunId,
  });
}

type FinalizeRuntimeInvocationInput = {
  input: AiRuntimeInvocationInput;
  runId: string;
  providerName: string;
  request: ExecutionProviderRequest;
  response: ProviderRunSnapshot;
  providerRunRecordId?: string;
  scope?: RuntimeEventPersistenceContext;
};

async function finalizeRuntimeInvocation(value: FinalizeRuntimeInvocationInput): Promise<AiRuntimeInvocation> {
  const runtimeSessionKey = requireRuntimeSessionId(value.response.nativeSessionId ?? value.response.sessionId, "provider snapshot");
  const runtimeRunRef = await uniqueRuntimeRunRef(value.runId, value.response.nativeRunId ?? value.response.runId);
  const conversationEntryIds = await persistFinalRuntimeState({ ...value, runtimeRunRef, runtimeSessionKey });
  return { runId: value.runId, runtimeRunRef, runtimeSessionKey, conversationEntryIds, response: value.response, providerName: value.providerName };
}

const finalizeRuntimeInvocationForTest = finalizeRuntimeInvocation;

async function persistFinalRuntimeState(value: FinalizeRuntimeInvocationInput & {
  runtimeRunRef: string | null;
  runtimeSessionKey: string;
}): Promise<string[]> {
  const persisted = await withPlanExecutionDurability(async (tx) => {
    const scopeOptions = {
      providerRunStatuses: ["running", "waiting_for_approval", "completed", "failed", "cancelled"],
    };
    if (value.scope) await assertRuntimeExecutionScope(tx, value.scope, scopeOptions);
    const updated = await tx.run.updateMany({
      where: { id: value.runId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      data: {
        runtimeRunRef: value.runtimeRunRef,
        runtimeSessionRef: value.runtimeSessionKey,
        status: RunStatus.Running,
        syncStatus: "healthy",
        errorSummary: value.response.error,
      },
    });
    if (updated.count !== 1) return null;
    const messages = [
      { role: "user", content: extractUserText(value.request) },
      ...assistantMessage(value.response),
    ].filter((message) => message.content);
    const entries = await Promise.all(messages.map((message, index) => tx.conversationEntry.create({
      data: { runId: value.runId, role: message.role, content: message.content, sequence: index + 1, runtimeTs: new Date() },
      select: { id: true },
    })));
    if (value.runtimeSessionKey !== value.input.runtimeSessionKey) {
      await tx.taskSession.update({ where: { id: value.input.taskSessionId }, data: { providerSessionRef: value.runtimeSessionKey } });
    }
    if (value.providerRunRecordId) {
      const terminalStatuses = ["completed", "failed", "cancelled"];
      await tx.taskPlanProviderRun.updateMany({
        where: {
          id: value.providerRunRecordId,
          status: { notIn: terminalStatuses },
        },
        data: {
          providerRunRef: value.response.nativeRunId ?? value.response.runId,
          runtimeName: value.input.runtimeName,
          nativeRunId: value.response.nativeRunId ?? null,
          status: value.response.status === "completed" ? "completed" : value.response.error ? "failed" : value.response.status,
          finishedAt: isTerminalProviderSnapshot(value.response) ? new Date() : null,
        },
      });
    }
    await syncPersistedRunStateInTransaction(
      { taskId: value.input.taskId, runId: value.runId, rebuildProjection: false },
      tx,
    );
    return entries.map((entry) => entry.id);
  });
  return persisted ?? [];
}

async function recordRuntimeInvocationFailure(input: AiRuntimeInvocationInput, runId: string, error: unknown): Promise<void> {
  assertCurrentPlanExecutionOwnership();
  const errorSummary = error instanceof Error ? error.message : "Unknown error";
  await withPlanExecutionDurability(async (tx) => {
    const providerRun = await tx.taskPlanProviderRun.findFirst({
      where: { runId, nodeAttemptId: input.nodeAttempt.id },
      select: { id: true },
    });
    if (!providerRun) {
      const existingAction = await tx.taskPlanTerminalAction.findUnique({
        where: { nodeAttemptId: input.nodeAttempt.id },
        select: { kind: true },
      });
      if (existingAction && existingAction.kind !== "fail") {
        throw new Error("Node attempt already has a conflicting terminal action");
      }
      if (!existingAction) {
        const task = await tx.task.findUniqueOrThrow({
          where: { id: input.taskId },
          select: { workspaceId: true },
        });
        await tx.taskPlanTerminalAction.create({
          data: {
            workspaceId: task.workspaceId,
            taskId: input.taskId,
            runId,
            taskSessionId: input.taskSessionId,
            runtimeSessionKey: input.runtimeSessionKey,
            nodeId: input.nodeAttempt.nodeId,
            nodeAttemptId: input.nodeAttempt.id,
            kind: "fail",
            payload: { error: "Provider execution could not start" },
          },
        });
      }
    }
    const result = await tx.run.updateMany({
      where: { id: runId, nodeAttemptId: input.nodeAttempt.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
      data: { status: RunStatus.Running, errorSummary },
    });
    if (result.count !== 1) return false;
    await syncPersistedRunStateInTransaction({ taskId: input.taskId, runId, rebuildProjection: false }, tx);
    return true;
  });
}


function isTerminalProviderSnapshot(response: ProviderRunSnapshot): boolean {
  return response.status === "completed" || response.status === "failed" || response.status === "cancelled" || Boolean(response.error);
}



function assistantMessage(response: ProviderRunSnapshot): Array<{ role: string; content: string }> {
  const content = extractAssistantContent(response);
  return content ? [{ role: "assistant", content }] : [];
}


function extractUserText(request: ExecutionProviderRequest): string {
  try {
    return [request.instructions, JSON.stringify(request.input, null, 2)].filter(Boolean).join("\n\n");
  } catch {
    return [request.instructions, String(request.input)].filter(Boolean).join("\n\n");
  }
}

export { finalizeRuntimeInvocationForTest, persistProviderRuntimeEvent, setAfterRawEventPersistedForTest };
export type { RuntimeEventPersistenceContext };
