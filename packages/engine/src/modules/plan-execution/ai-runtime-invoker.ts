import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PreparedAiFeatureSpec, NodeAttempt } from "@chrona/contracts/ai";
import type { ProviderRunEvent, ProviderRunSnapshot } from "@chrona/providers-foundation";
import { requireAiClient } from "@/modules/ai";
import { persistProviderRuntimeEvent, type RuntimeEventPersistenceContext } from "./ai-runtime-event-persistence";
import {
  ensureProviderRunRecord,
  persistTaskSessionProviderRef,
  readTaskSessionProviderRef,
  requireRuntimeSessionId,
  resolveTaskModel,
  uniqueRuntimeRunRef,
  updateProviderRunRecord,
} from "./ai-runtime-persistence";
import {
  buildExecutionGatewayRequest,
  extractAssistantContent,
  type ExecutionProviderRequest,
} from "./ai-runtime-request";
import { runProviderRequest } from "./ai-runtime-provider-stream";
export { runProviderRequest } from "./ai-runtime-provider-stream";
import { mintRunToken } from "./runtime/agent-control-store";
import { syncTaskRunState } from "./persistence/task-execution-store";

export type AiRuntimeInvocationInput = {
  taskId: string;
  taskSessionId: string;
  runtimeName: string;
  runtimeSessionKey: string;
  workBlockId?: string | null;
  nodeContext?: {
    nodeId: string;
    nodeTitle: string;
  };
  nodeAttemptId?: string;
  nodeAttempt?: NodeAttempt;
  providerRunIdempotencyKey?: string;
  runtimeInput: Record<string, unknown>;
  instructions: string;
  featureSpec: PreparedAiFeatureSpec;
  triggeredBy: "system" | "user";
  clientId?: string | null;
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

async function createRuntimeRun(input: AiRuntimeInvocationInput): Promise<{ task: RuntimeTask; run: { id: string } }> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { workspaceId: true, executionConfig: true, pinnedModel: true, pinnedModelSource: true },
  });
  const occurrence = await resolveRuntimeOccurrence(input);
  const run = await db.run.create({
    data: {
      taskId: input.taskId,
      workBlockId: input.workBlockId ?? null,
      occurrenceId: occurrence?.id ?? null,
      taskSessionId: input.taskSessionId,
      runtimeName: input.runtimeName,
      runtimeSessionRef: input.runtimeSessionKey,
      status: RunStatus.Pending,
      triggeredBy: input.triggeredBy,
      startedAt: new Date(),
      syncStatus: "healthy",
    },
  });
  await syncTaskRunState({ taskId: input.taskId, taskSessionId: input.taskSessionId, runId: run.id, runStatus: RunStatus.Pending, setAsLatest: true });
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

async function invokeProviderForRuntime(input: AiRuntimeInvocationInput, task: RuntimeTask, run: { id: string }): Promise<AiRuntimeInvocation> {
  const client = await requireRuntimeProviderClient(input.clientId);
  const request = await createProviderRequest(input, task, client.providerClient);
  const providerRun = await ensureProviderRunRecord({
    taskId: input.taskId,
    workspaceId: task.workspaceId,
    nodeAttempt: input.nodeAttempt,
    nodeAttemptId: input.nodeAttemptId,
    providerRunIdempotencyKey: input.providerRunIdempotencyKey,
  });
  const response = await runProviderRequest(client.providerClient, request, await providerRequestOptions(input, task, run.id, providerRun, client.providerClient.provider));
  return finalizeRuntimeInvocation({ input, runId: run.id, providerName: client.providerClient.provider, request, response, providerRunRecordId: providerRun?.id });
}

async function requireRuntimeProviderClient(clientId: string | null | undefined) {
  const client = await requireAiClient(clientId);
  if (!client.providerClient) throw new Error(`AI client '${client.record.name}' does not support runtime execution`);
  return client as typeof client & { providerClient: NonNullable<typeof client.providerClient> };
}

async function createProviderRequest(
  input: AiRuntimeInvocationInput,
  task: RuntimeTask,
  providerClient: NonNullable<Awaited<ReturnType<typeof requireAiClient>>["providerClient"]>,
): Promise<ExecutionProviderRequest> {
  const request = buildExecutionGatewayRequest({
    instructions: input.instructions,
    runtimeInput: input.runtimeInput,
    featureSpec: input.featureSpec,
    sessionKey: input.runtimeSessionKey,
    sessionId: input.runtimeSessionKey,
    executionRuntime: input.runtimeName,
    resumeSessionRef: await readTaskSessionProviderRef(input.taskSessionId),
  });
  const config = task.executionConfig as Record<string, unknown>;
  const model = await resolveTaskModel({ taskId: input.taskId, executionConfig: config, pinnedModel: task.pinnedModel, pinnedModelSource: task.pinnedModelSource, providerClient });
  request.runtimeConfiguration = runtimeConfiguration(config, model);
  return request;
}

function runtimeConfiguration(config: Record<string, unknown>, model: string | undefined): ExecutionProviderRequest["runtimeConfiguration"] {
  const strategy = config.contextStrategy;
  const contextStrategy = strategy === "provider_default" || strategy === "auto_compact" || strategy === "bounded_tool_results" || strategy === "artifact_backed" ? strategy : undefined;
  return { ...(model ? { model } : {}), ...(contextStrategy ? { contextStrategy } : {}) };
}

async function providerRequestOptions(
  input: AiRuntimeInvocationInput,
  task: RuntimeTask,
  runId: string,
  providerRun: { id: string; planRunId: string; nodeAttemptId: string } | null,
  providerName: string,
) {
  return {
    runId,
    idempotencyKey: input.providerRunIdempotencyKey,
    providerRunRecordId: providerRun?.id,
    onRuntimeEvent: input.onRuntimeEvent,
    terminalToolName: input.featureSpec.terminalToolName,
    controlRunToken: shouldUseControl(input.featureSpec.feature, providerName) ? await mintRuntimeRunToken(input, task, runId) : null,
    onRunStarted: (providerRunRef: { runId: string; nativeRunId?: string }) => syncTaskRunState({
      taskId: input.taskId,
      taskSessionId: input.taskSessionId,
      runId,
      runStatus: RunStatus.Running,
      runtimeRunRef: providerRunRef.nativeRunId ?? providerRunRef.runId,
    }),
    eventPersistence: {
      workspaceId: task.workspaceId,
      taskId: input.taskId,
      workBlockId: input.workBlockId,
      runId,
      runtimeName: input.runtimeName,
      taskSessionId: input.taskSessionId,
      nodeAttemptId: input.nodeAttemptId,
      providerRunId: providerRun?.id,
      planId: input.nodeAttempt?.graphId,
      planRunId: providerRun?.planRunId,
      nodeContext: input.nodeContext,
    },
    signal: input.signal,
  };
}

function shouldUseControl(feature: PreparedAiFeatureSpec["feature"], providerName: string): boolean {
  return feature !== "goal.review" && feature !== "task.result_finalization" && (providerName === "claude_code" || providerName === "codex" || providerName === "omp");
}

async function mintRuntimeRunToken(input: AiRuntimeInvocationInput, task: RuntimeTask, runId: string): Promise<string> {
  return mintRunToken({
    taskId: input.taskId,
    workspaceId: task.workspaceId,
    taskSessionId: input.taskSessionId,
    runId,
    runtimeSessionKey: input.runtimeSessionKey,
    nodeId: input.nodeContext?.nodeId,
    nodeAttemptId: input.nodeAttemptId,
  });
}

type FinalizeRuntimeInvocationInput = {
  input: AiRuntimeInvocationInput;
  runId: string;
  providerName: string;
  request: ExecutionProviderRequest;
  response: ProviderRunSnapshot;
  providerRunRecordId?: string;
};

async function finalizeRuntimeInvocation(value: FinalizeRuntimeInvocationInput): Promise<AiRuntimeInvocation> {
  const runtimeSessionKey = requireRuntimeSessionId(value.response.sessionId, "provider snapshot");
  const runtimeRunRef = await uniqueRuntimeRunRef(value.runId, value.response.nativeRunId ?? value.response.runId);
  const conversationEntryIds = await persistRuntimeHistory({ runId: value.runId, request: value.request, response: value.response });
  const runStatus = runStatusFromProviderSnapshot(value.response);
  await persistFinalRuntimeState({ ...value, runtimeRunRef, runtimeSessionKey, runStatus });
  return { runId: value.runId, runtimeRunRef, runtimeSessionKey, conversationEntryIds, response: value.response, providerName: value.providerName };
}

async function persistFinalRuntimeState(value: FinalizeRuntimeInvocationInput & {
  runtimeRunRef: string | null;
  runtimeSessionKey: string;
  runStatus: RunStatus;
}): Promise<void> {
  await db.run.update({ where: { id: value.runId }, data: { runtimeRunRef: value.runtimeRunRef, runtimeSessionRef: value.runtimeSessionKey, status: value.runStatus, syncStatus: "healthy", errorSummary: value.response.error } });
  await syncTaskRunState({ taskId: value.input.taskId, taskSessionId: value.input.taskSessionId, runId: value.runId, runStatus: value.runStatus, runtimeRunRef: value.runtimeRunRef, rebuildProjection: false });
  if (value.runtimeSessionKey !== value.input.runtimeSessionKey) await persistTaskSessionProviderRef(value.input.taskSessionId, value.runtimeSessionKey);
  await updateProviderRunRecord(value.providerRunRecordId, {
    providerRunRef: value.runtimeRunRef,
    runtimeName: value.input.runtimeName,
    nativeRunId: value.response.nativeRunId ?? null,
    status: value.response.error ? "failed" : value.response.status,
    finishedAt: isTerminalProviderSnapshot(value.response) ? new Date() : null,
  });
}

async function recordRuntimeInvocationFailure(input: AiRuntimeInvocationInput, runId: string, error: unknown): Promise<void> {
  const errorSummary = error instanceof Error ? error.message : "Unknown error";
  await db.run.update({ where: { id: runId }, data: { status: RunStatus.Failed, endedAt: new Date(), errorSummary } });
  await syncTaskRunState({ taskId: input.taskId, taskSessionId: input.taskSessionId, runId, runStatus: RunStatus.Failed });
  if (!input.providerRunIdempotencyKey) return;
  const providerRun = await db.taskPlanProviderRun.findUnique({ where: { idempotencyKey: input.providerRunIdempotencyKey }, select: { id: true } });
  await updateProviderRunRecord(providerRun?.id, { status: "failed", finishedAt: new Date() });
}

function runStatusFromProviderSnapshot(response: ProviderRunSnapshot): RunStatus {
  if (response.status === "cancelled") return RunStatus.Cancelled;
  return response.error || response.status === "failed" ? RunStatus.Failed : RunStatus.Running;
}

function isTerminalProviderSnapshot(response: ProviderRunSnapshot): boolean {
  return response.status === "completed" || response.status === "failed" || response.status === "cancelled" || Boolean(response.error);
}

async function persistRuntimeHistory(input: {
  runId: string;
  request: ExecutionProviderRequest;
  response: ProviderRunSnapshot;
}): Promise<string[]> {
  try {
    const messages = [
      { role: "user", content: extractUserText(input.request) },
      ...assistantMessage(input.response),
    ];
    const entries = await Promise.all(messages.map((message, index) => createConversationEntry(input.runId, message, index)));
    return entries.flatMap((entry) => entry ? [entry] : []);
  } catch {
    return [];
  }
}

function assistantMessage(response: ProviderRunSnapshot): Array<{ role: string; content: string }> {
  const content = extractAssistantContent(response);
  return content ? [{ role: "assistant", content }] : [];
}

async function createConversationEntry(runId: string, message: { role: string; content: string }, index: number): Promise<string | null> {
  if (!message.content) return null;
  const created = await db.conversationEntry.create({
    data: { runId, role: message.role, content: message.content, sequence: index + 1, runtimeTs: new Date() },
    select: { id: true },
  });
  return created.id;
}

function extractUserText(request: ExecutionProviderRequest): string {
  try {
    return [request.instructions, JSON.stringify(request.input, null, 2)].filter(Boolean).join("\n\n");
  } catch {
    return [request.instructions, String(request.input)].filter(Boolean).join("\n\n");
  }
}

export { persistProviderRuntimeEvent };
export type { RuntimeEventPersistenceContext };
