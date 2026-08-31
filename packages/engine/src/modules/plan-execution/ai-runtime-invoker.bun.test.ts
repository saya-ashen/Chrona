import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  AgentProviderClient,
  ProviderRunEvent,
  ProviderRunRef,
  ProviderRunSnapshot,
} from "@chrona/providers-foundation";
import type { NodeAttempt } from "@chrona/contracts/ai";
import {
  db,
  RunStatus,
  TaskPlanStatus,
  TaskPriority,
  TaskStatus,
  type TaskPlanNodeAttempt,
} from "@chrona/db";
import {
  finalizeRuntimeInvocationForTest,
  persistProviderRuntimeEvent,
  runProviderRequest,
  setAfterRawEventPersistedForTest,
} from "./ai-runtime-invoker";
import {
  continuityInstructions,
  resolveRuntimeContextContinuity,
  withContextContinuity,
} from "./runtime/runtime-context-continuity";
import { ensureProviderRunRecord } from "./ai-runtime-persistence";
import type { ExecutionProviderRequest } from "./ai-runtime-request";

const request: ExecutionProviderRequest = {
  provider: "hermes",
  clientOperationId: "ai-runtime-invoker-test-operation",
  sessionId: "session-1",
  sessionKey: "session-key-1",
  instructions: "do work",
  input: { kind: "task" },
  toolPolicy: "full",
};

function runRef(overrides: Partial<ProviderRunRef> = {}): ProviderRunRef {
  return {
    provider: "hermes",
    runId: "run-1",
    nativeRunId: "run-1",
    sessionId: "session-1",
    status: "running",
    ...overrides,
  };
}

let eventSequence = 0;

function providerEvent(
  event: Record<string, unknown>,
  fallbackRun = runRef(),
): ProviderRunEvent {
  const terminalRun = event.run;
  const identity =
    terminalRun && typeof terminalRun === "object"
      ? { ...fallbackRun, ...terminalRun, provider: fallbackRun.provider }
      : fallbackRun;
  const normalizedTerminalRun =
    terminalRun && typeof terminalRun === "object"
      ? {
          ...terminalRun,
          provider: identity.provider,
          runId: identity.runId,
          sessionId: identity.sessionId,
        }
      : terminalRun;
  return {
    ...event,
    provider: identity.provider,
    runId: identity.runId,
    sessionId: identity.sessionId,
    sequence: ++eventSequence,
    ...(normalizedTerminalRun === undefined
      ? {}
      : { run: normalizedTerminalRun }),
  } as ProviderRunEvent;
}
function incompleteStream(run = runRef()): AsyncIterable<ProviderRunEvent> {
  return (async function* () {
    yield providerEvent({ type: "text_delta", text: "partial" }, run);
    // Ends without a terminal run_completed/run_failed event.
  })();
}

function providerCapabilities() {
  return {
    supportsSessions: true,
    supportsStreaming: true,
    supportsRunLookup: true,
    supportsCancellation: true,
    supportsToolCalls: true,
    supportsPreviousResponse: false,
    actionInvocation: "unsupported" as const,
    startIdempotency: "unsupported" as const,
    lookupByClientOperationId: false,
    recovery: {
      sessionResume: true,
      historyReplay: true,
      activeRunLookup: true,
      streamReconnect: true,
      providerResumeRef: true,
      runEventReplay: true,
      mode: "authoritative_run_lookup" as const,
    },
  };
}

async function resetDb() {
  await db.artifact.deleteMany();
  await db.approval.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.run.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedRunPair() {
  const workspace = await db.workspace.create({
    data: {
      name: "Runtime ref workspace",
      status: "Active",
    },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Runtime ref task",
      executionConfig: {},
      status: TaskStatus.Running,
      priority: TaskPriority.Medium,
    },
  });
  const first = await db.run.create({
    data: {
      taskId: task.id,
      runtimeName: "hermes",
      runtimeRunRef: "provider-run-1",
      runtimeSessionRef: "provider-session-1",
      status: RunStatus.Running,
      triggeredBy: "system",
    },
  });
  const second = await db.run.create({
    data: {
      taskId: task.id,
      runtimeName: "hermes",
      status: RunStatus.Pending,
      triggeredBy: "system",
    },
  });
  return { first, second };
}

async function seedProviderRunChain() {
  const workspace = await db.workspace.create({
    data: {
      name: "Provider audit workspace",
      status: "Active",
    },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Provider audit task",
      executionConfig: {},
      status: TaskStatus.Running,
      priority: TaskPriority.Medium,
    },
  });
  const plan = await db.taskPlan.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: "plan-1",
      revision: 1,
      status: TaskPlanStatus.Accepted,
      compiledPlan: {},
    },
  });
  const planRun = await db.taskPlanRun.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: plan.planId,
      planRun: {},
    },
  });
  const attempt = await db.taskPlanNodeAttempt.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: plan.planId,
      planRunId: planRun.id,
      nodeId: "node-1",
      nodeLayerId: "layer-1",
      idempotencyKey: "attempt-key-1",
      attemptNumber: 1,
      status: "running",
      executionEpoch: 0,
    },
  });
  const providerRun = await db.taskPlanProviderRun.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: plan.planId,
      planRunId: planRun.id,
      nodeAttemptId: attempt.id,
      aiClientId: "ai-client-test",
      aiClientConfigDigest: "config-digest",
      providerName: "hermes",
      runtimeName: "hermes",
      idempotencyKey: "provider-run-key-1",
      status: "running",
    },
  });
  const taskSession = await db.taskSession.create({
    data: {
      taskId: task.id,
      runtimeName: "hermes",
      providerClientId: "ai-client-test",
      providerName: "hermes",
      providerConfigFingerprint: "config-digest",
      sessionKey: "provider-audit-session",
    },
  });
  await db.executionSession.create({
    data: {
      id: `execution-session-${task.id}`,
      workspaceId: workspace.id,
      taskId: task.id,
      planId: plan.planId,
      workBlockId: null,
      activeScopeKey: "active",
      status: "Active",
      currentNodeId: attempt.nodeId,
      currentNodeAttemptId: attempt.id,
      completedNodeIds: "[]",
    },
  });
  const run = await db.run.create({
    data: {
      taskId: task.id,
      nodeAttemptId: attempt.id,
      taskSessionId: taskSession.id,
      runtimeName: "hermes",
      providerClientId: "ai-client-test",
      providerName: "hermes",
      providerConfigFingerprint: "config-digest",
      status: RunStatus.Pending,
      triggeredBy: "system",
    },
  });
  await db.taskPlanProviderRun.update({
    where: { id: providerRun.id },
    data: { runId: run.id },
  });
  eventSequence = 0;
  return {
    workspace,
    task,
    plan,
    planRun,
    attempt,
    providerRun,
    run,
    taskSession,
  };
}

function asRuntimeAttempt(attempt: TaskPlanNodeAttempt): NodeAttempt {
  return {
    id: attempt.id,
    taskId: attempt.taskId,
    graphId: attempt.planId,
    nodeId: attempt.nodeId,
    nodeLayerId: attempt.nodeLayerId,
    executionContextSnapshotId: attempt.executionContextSnapshotId!,
    status: "running" as const,
    idempotencyKey: attempt.idempotencyKey,
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt.toISOString(),
  };
}

beforeEach(async () => {
  setAfterRawEventPersistedForTest();
  await resetDb();
});

afterAll(async () => {
  await resetDb();
});
describe("runProviderRequest stream-interruption fallback", () => {
  it("keeps the run Running when the stream ends with no terminal event and the provider still reports it running", async () => {
    const startRun = mock(async () => runRef());
    const streamRun = mock(() => incompleteStream());
    const getRun = mock(
      async (): Promise<ProviderRunSnapshot> => ({
        provider: "hermes",
        runId: "run-1",
        sessionId: "session-1",
        status: "running",
        error: null,
      }),
    );

    const client = {
      provider: "hermes",
      getCapabilities: mock(() => ({
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: true,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: false,
        actionInvocation: "unsupported" as const,
        startIdempotency: "unsupported" as const,
        lookupByClientOperationId: false,
        recovery: {
          sessionResume: true,
          historyReplay: true,
          activeRunLookup: true,
          streamReconnect: true,
          providerResumeRef: true,
          runEventReplay: true,
          mode: "authoritative_run_lookup" as const,
        },
      })),
      startRun,
      streamRun,
      getRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    // startRun once (no duplicate run spawned), streamRun twice (initial + one
    // reconnect), then getRun reconciles the authoritative state.
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(streamRun).toHaveBeenCalledTimes(2);
    expect(getRun).toHaveBeenCalledTimes(1);
    expect(snapshot.status).toBe("running");
    expect(snapshot.error).toBeNull();
  });

  it("[RUN-021] rejects a malformed provider stream event before completion", async () => {
    const malformedStream =
      async function* (): AsyncIterable<ProviderRunEvent> {
        yield {
          provider: "hermes",
          runId: "run-1",
          sessionId: "session-1",
          sequence: 1,
          type: "malformed",
        } as unknown as ProviderRunEvent;
      };
    const client = {
      provider: "hermes",
      getCapabilities: mock(providerCapabilities),
      startRun: mock(async () => runRef()),
      streamRun: mock(() => malformedStream()),
    } as unknown as AgentProviderClient;

    await expect(runProviderRequest(client, request)).rejects.toThrow(
      "Provider stream event failed schema validation",
    );
  });

  it("finalizes from the provider snapshot when the run completed while the stream was severed", async () => {
    const streamRun = mock(() => incompleteStream());
    const getRun = mock(
      async (): Promise<ProviderRunSnapshot> => ({
        provider: "hermes",
        runId: "run-1",
        sessionId: "session-1",
        status: "completed",
        outputText: "final answer",
        error: null,
      }),
    );

    const client = {
      provider: "hermes",
      getCapabilities: mock(() => ({
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: true,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: false,
        actionInvocation: "unsupported" as const,
        startIdempotency: "unsupported" as const,
        lookupByClientOperationId: false,
        recovery: {
          sessionResume: true,
          historyReplay: true,
          activeRunLookup: true,
          streamReconnect: true,
          providerResumeRef: true,
          runEventReplay: true,
          mode: "authoritative_run_lookup" as const,
        },
      })),
      startRun: mock(async () => runRef()),
      streamRun,
      getRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    expect(getRun).toHaveBeenCalledTimes(1);
    expect(snapshot.status).toBe("completed");
    expect(snapshot.outputText).toBe("final answer");
  });

  it("leaves the run Running for later recovery when getRun is unavailable", async () => {
    const getRun = mock(async (): Promise<ProviderRunSnapshot> => {
      throw new Error("provider unreachable");
    });

    const client = {
      provider: "hermes",
      getCapabilities: mock(() => ({
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: true,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: false,
        actionInvocation: "unsupported" as const,
        startIdempotency: "unsupported" as const,
        lookupByClientOperationId: false,
        recovery: {
          sessionResume: true,
          historyReplay: true,
          activeRunLookup: true,
          streamReconnect: true,
          providerResumeRef: true,
          runEventReplay: true,
          mode: "authoritative_run_lookup" as const,
        },
      })),
      startRun: mock(async () => runRef()),
      streamRun: mock(() => incompleteStream()),
      getRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    expect(getRun).toHaveBeenCalledTimes(1);
    expect(snapshot.status).toBe("running");
    expect(snapshot.error).toBeNull();
    expect(snapshot.runId).toBe("run-1");
  });

  it("does not poll active run snapshots for session-history recovery providers", async () => {
    const getRun = mock(async (): Promise<ProviderRunSnapshot> => {
      throw new Error("should not be called");
    });

    const client = {
      provider: "codex",
      getCapabilities: mock(() => ({
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: false,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: false,
        actionInvocation: "unsupported" as const,
        startIdempotency: "unsupported" as const,
        lookupByClientOperationId: false,
        recovery: {
          sessionResume: true,
          historyReplay: true,
          activeRunLookup: false,
          streamReconnect: false,
          mode: "session_history",
          providerResumeRef: true,
          runEventReplay: false,
        },
      })),
      startRun: mock(async () => ({ ...runRef(), provider: "codex" })),
      streamRun: mock(() => incompleteStream(runRef({ provider: "codex" }))),
      getRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    expect(getRun).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      provider: "codex",
      status: "failed",
      rawStatus: "interrupted",
      error: expect.stringContaining("session_history"),
    });
  });

  it("rethrows non-transient stream errors without reconnecting or polling", async () => {
    const getRun = mock(async () => {
      throw new Error("should not be called");
    });
    const streamRun = mock(
      (): AsyncIterable<ProviderRunEvent> =>
        (async function* () {
          yield* [];
          throw new Error("fatal misconfiguration");
        })(),
    );

    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => runRef()),
      streamRun,
      getRun,
    } as unknown as AgentProviderClient;

    await expect(runProviderRequest(client, request)).rejects.toThrow(
      "fatal misconfiguration",
    );
    expect(streamRun).toHaveBeenCalledTimes(1);
    expect(getRun).not.toHaveBeenCalled();
  });
});

describe("runProviderRequest runtime ref persistence", () => {
  it("stores a local run-scoped ref when a resumed provider session reuses nativeRunId", async () => {
    const { first, second } = await seedRunPair();
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(
        async () =>
          ({
            provider: "hermes",
            runId: "provider-run-1",
            nativeRunId: "provider-run-1",
            sessionId: "provider-session-1",
            status: "running",
          }) satisfies ProviderRunRef,
      ),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "run_completed",
            run: {
              provider: "hermes",
              runId: "provider-run-1",
              nativeRunId: "provider-run-1",
              sessionId: "provider-session-1",
              status: "completed",
            },
            outputText: "ok",
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, request, { runId: second.id });

    const runs = await db.run.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, runtimeRunRef: true },
    });
    expect(runs).toEqual([
      { id: first.id, runtimeRunRef: "provider-run-1" },
      { id: second.id, runtimeRunRef: `provider-run-1:${second.id}` },
    ]);
  });

  it("keeps the logical stream identity stable while returning the provider-native session ref", async () => {
    const logicalSessionId = "chrona:task:task-1:execute:plan-1";
    const nativeSessionId = "/tmp/omp-session.jsonl";
    const providerRun = runRef({
      provider: "omp",
      sessionId: logicalSessionId,
      nativeSessionId,
    });
    const client = {
      provider: "omp",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => providerRun),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent(
            { type: "run_started", run: providerRun },
            providerRun,
          );
          yield providerEvent(
            {
              type: "run_completed",
              run: { ...providerRun, status: "completed" },
              outputText: "ok",
            },
            providerRun,
          );
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, {
      ...request,
      sessionId: logicalSessionId,
    });

    expect(snapshot).toMatchObject({
      sessionId: logicalSessionId,
      nativeSessionId,
      status: "completed",
    });
  });

  it("publishes Running only after the provider accepts the run", async () => {
    const { second } = await seedRunPair();
    const onRunStarted = mock(async () => {});
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(
        async () =>
          ({
            provider: "hermes",
            runId: "provider-run-started",
            nativeRunId: "provider-run-started",
            sessionId: "provider-session-started",
            status: "running",
          }) satisfies ProviderRunRef,
      ),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "run_completed",
            run: {
              provider: "hermes",
              runId: "provider-run-started",
              nativeRunId: "provider-run-started",
              sessionId: "provider-session-started",
              status: "completed",
            },
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, request, {
      runId: second.id,
      onRunStarted,
    });

    expect(onRunStarted).toHaveBeenCalledTimes(1);
    expect(onRunStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "provider-run-started",
        sessionId: "provider-session-started",
        status: "running",
      }),
    );
    expect(
      await db.run.findUniqueOrThrow({ where: { id: second.id } }),
    ).toMatchObject({
      status: RunStatus.Running,
      runtimeSessionRef: "provider-session-started",
    });
  });

  it("treats run_completed as completed even when embedded run status is still running", async () => {
    const { second } = await seedRunPair();
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(
        async () =>
          ({
            provider: "hermes",
            runId: "provider-run-1",
            nativeRunId: "provider-run-1",
            sessionId: "provider-session-1",
            status: "running",
          }) satisfies ProviderRunRef,
      ),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "run_completed",
            run: {
              provider: "hermes",
              runId: "provider-run-1",
              nativeRunId: "provider-run-1",
              sessionId: "provider-session-1",
              status: "running",
            },
            outputText: "ok",
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request, {
      runId: second.id,
    });

    expect(snapshot.status).toBe("completed");
    expect(snapshot.outputText).toBe("ok");
  });

  it("closes provider audit rows from terminal run_completed events", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(
        async () =>
          ({
            provider: "hermes",
            runId: "provider-run-1",
            nativeRunId: "provider-run-1",
            sessionId: "provider-session-1",
            status: "running",
          }) satisfies ProviderRunRef,
      ),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "run_completed",
            run: {
              provider: "hermes",
              runId: "provider-run-1",
              nativeRunId: "provider-run-1",
              sessionId: "provider-session-1",
              status: "running",
            },
            outputText: "ok",
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, request, {
      runId: run.id,
      providerRunRecordId: providerRun.id,
      eventPersistence: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: null,
        occurrenceId: null,
        runId: run.id,
        runtimeName: "hermes",
        taskSessionId: taskSession.id,
        executionSessionId: `execution-session-${task.id}`,
        nodeAttemptId: providerRun.nodeAttemptId,
        providerRunId: providerRun.id,
        planId: plan.planId,
        planRunId: providerRun.planRunId,
        executionScope: planRun.executionScopeId,
      },
    });

    const reloaded = await db.taskPlanProviderRun.findUniqueOrThrow({
      where: { id: providerRun.id },
      select: {
        status: true,
        finishedAt: true,
        completedByEventId: true,
        failedByEventId: true,
      },
    });
    expect(reloaded.status).toBe("completed");
    expect(reloaded.finishedAt).toBeInstanceOf(Date);
    expect(reloaded.completedByEventId).toBeString();
    expect(reloaded.failedByEventId).toBeNull();
  });

  it("does not synthesize terminal tool metadata from the configured terminal tool", async () => {
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => runRef()),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "run_completed",
            run: {
              provider: "hermes",
              runId: "run-1",
              nativeRunId: "run-1",
              sessionId: "session-1",
              status: "completed",
            },
            outputText: "done",
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request, {
      terminalToolName: "chrona_node_complete",
    });

    expect(snapshot.raw).toBeUndefined();
  });

  it("keeps the last provider tool_call as terminal tool metadata", async () => {
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => runRef()),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "tool_call",
            tool: "chrona_node_complete",
            callId: "complete-1",
            input: { summary: "done" },
            status: "completed",
          });
          yield providerEvent({
            type: "run_completed",
            run: {
              provider: "hermes",
              runId: "run-1",
              nativeRunId: "run-1",
              sessionId: "session-1",
              status: "completed",
            },
            outputText: "done",
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    expect(snapshot.raw).toEqual({
      terminalToolName: "chrona_node_complete",
    });
  });

  it("preserves terminal tool input carried by the provider terminal event", async () => {
    const client = {
      provider: "claude_code",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => runRef({ provider: "claude_code" })),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "run_completed",
            provider: "claude_code",
            runId: "run-1",
            sessionId: "session-1",
            run: {
              provider: "claude_code",
              runId: "run-1",
              nativeRunId: "native-run-1",
              sessionId: "session-1",
              status: "completed",
            },
            outputText: "done",
            terminalToolCall: {
              name: "chrona_node_complete",
              callId: "complete-1",
              input: { summary: "done" },
            },
          }, runRef({ provider: "claude_code" }));
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    expect(snapshot.raw).toEqual({
      terminalTool: {
        name: "chrona_node_complete",
        callId: "complete-1",
        input: { summary: "done" },
      },
    });
  });

  it("recovers a provider stream failure from the durable terminal action", async () => {
    const { workspace, task, plan, planRun, attempt, providerRun, run, taskSession } =
      await seedProviderRunChain();
    await db.taskPlanTerminalAction.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        taskSessionId: taskSession.id,
        runtimeSessionKey: taskSession.sessionKey,
        nodeId: attempt.nodeId,
        nodeAttemptId: attempt.id,
        kind: "complete",
        payload: { summary: "Durably recorded completion" },
      },
    });
    const started = runRef({
      provider: "codex",
      runId: "codex-recorded-terminal-run",
      sessionId: "codex-recorded-terminal-session",
    });
    const client = {
      provider: "codex",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => started),
      streamRun: mock(() =>
        (async function* () {
          for (const event of [] as ProviderRunEvent[]) yield event;
          throw Object.assign(new Error("ACP stream aborted"), {
            code: "aborted",
            retryable: true,
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, {
      ...request,
      provider: "codex",
      sessionId: started.sessionId,
      sessionKey: started.sessionId,
      terminalToolName: "chrona_node_complete",
    }, {
      runId: run.id,
      providerRunRecordId: providerRun.id,
      terminalToolName: "chrona_node_complete",
      eventPersistence: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: null,
        occurrenceId: null,
        runId: run.id,
        runtimeName: "codex",
        taskSessionId: taskSession.id,
        executionSessionId: `execution-session-${task.id}`,
        nodeAttemptId: providerRun.nodeAttemptId,
        providerRunId: providerRun.id,
        planId: plan.planId,
        planRunId: providerRun.planRunId,
        executionScope: planRun.executionScopeId,
      },
    });

    expect(snapshot).toMatchObject({
      provider: "codex",
      status: "completed",
      outputText: "Durably recorded completion",
      raw: {
        terminalActionRecorded: true,
        terminalTool: {
          name: "chrona_node_complete",
          input: { summary: "Durably recorded completion" },
        },
      },
    });
    expect(client.streamRun).toHaveBeenCalledTimes(1);
  });

  it("returns cancelled snapshot and closes provider audit rows from run_cancelled events", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(
        async () =>
          ({
            provider: "hermes",
            runId: "provider-run-1",
            nativeRunId: "provider-run-1",
            sessionId: "provider-session-1",
            status: "running",
          }) satisfies ProviderRunRef,
      ),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "run_cancelled",
            run: {
              provider: "hermes",
              runId: "provider-run-1",
              nativeRunId: "provider-run-1",
              sessionId: "provider-session-1",
              status: "cancelled",
            },
            raw: { reason: "interrupted" },
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request, {
      runId: run.id,
      providerRunRecordId: providerRun.id,
      eventPersistence: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: null,
        occurrenceId: null,
        runId: run.id,
        runtimeName: "hermes",
        taskSessionId: taskSession.id,
        executionSessionId: `execution-session-${task.id}`,
        nodeAttemptId: providerRun.nodeAttemptId,
        providerRunId: providerRun.id,
        planId: plan.planId,
        planRunId: providerRun.planRunId,
        executionScope: planRun.executionScopeId,
      },
    });

    expect(snapshot.status).toBe("cancelled");
    const reloaded = await db.taskPlanProviderRun.findUniqueOrThrow({
      where: { id: providerRun.id },
      select: {
        status: true,
        finishedAt: true,
        completedByEventId: true,
        failedByEventId: true,
      },
    });
    expect(reloaded.status).toBe("cancelled");
    expect(reloaded.finishedAt).toBeInstanceOf(Date);
    expect(reloaded.completedByEventId).toBeNull();
    expect(reloaded.failedByEventId).toBeNull();
  });

  it("preserves a late native session ref when a terminal action aborts the provider turn", async () => {
    const controller = new AbortController();
    const nativeSessionId = "/tmp/omp-terminal-session.jsonl";
    const initialRun = runRef({
      provider: "omp",
      runId: "omp-terminal-run",
      nativeRunId: "omp-terminal-run",
      sessionId: "logical-session",
      nativeSessionId: undefined,
    });
    const cancelRun = mock(async () => {
      throw new Error("OMP run already finished");
    });
    const client = {
      provider: "omp",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => initialRun),
      streamRun: mock(() =>
        (async function* () {
          controller.abort("Chrona terminal action recorded");
          yield providerEvent(
            {
              type: "run_cancelled",
              run: {
                ...initialRun,
                nativeSessionId,
                status: "cancelled",
              },
            },
            initialRun,
          );
        })(),
      ),
      cancelRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, {
      ...request,
      provider: "omp",
      sessionId: "logical-session",
      sessionKey: "logical-session",
    }, { signal: controller.signal });

    expect(snapshot).toMatchObject({
      status: "cancelled",
      sessionId: "logical-session",
      nativeSessionId,
    });
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it("streams a queued terminal event when terminal abort wins the start-to-stream race", async () => {
    const controller = new AbortController();
    const nativeSessionId = "/tmp/omp-pre-stream-terminal-session.jsonl";
    const initialRun = runRef({
      provider: "omp",
      runId: "omp-pre-stream-terminal-run",
      nativeRunId: "omp-pre-stream-terminal-run",
      sessionId: "logical-session",
      nativeSessionId: undefined,
    });
    const cancelRun = mock(async () => {
      throw new Error("terminal run must be drained instead of cancelled again");
    });
    const client = {
      provider: "omp",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => {
        controller.abort("Chrona terminal action recorded");
        return initialRun;
      }),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent(
            {
              type: "run_cancelled",
              run: {
                ...initialRun,
                nativeSessionId,
                status: "cancelled",
              },
            },
            initialRun,
          );
        })(),
      ),
      cancelRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, {
      ...request,
      provider: "omp",
      sessionId: "logical-session",
      sessionKey: "logical-session",
    }, { signal: controller.signal });

    expect(snapshot.nativeSessionId).toBe(nativeSessionId);
    expect(cancelRun).not.toHaveBeenCalled();
    expect(client.streamRun).toHaveBeenCalledTimes(1);
  });

  it("completes from a recorded terminal tool when provider streaming aborts", async () => {
    const controller = new AbortController();
    const initialRun = runRef({
      provider: "codex",
      runId: "codex-terminal-run",
      nativeRunId: "codex-terminal-run",
      sessionId: "logical-session",
    });
    const client = {
      provider: "codex",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => initialRun),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "tool_call",
            tool: "chrona_node_complete",
            callId: "complete-codex",
            input: { summary: "Codex complete" },
            status: "completed",
          }, initialRun);
          controller.abort("Chrona terminal action recorded");
          throw Object.assign(new Error("ACP stream aborted"), {
            code: "aborted",
            retryable: true,
          });
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, {
      ...request,
      provider: "codex",
      sessionId: "logical-session",
      sessionKey: "logical-session",
      terminalToolName: "chrona_node_complete",
    }, {
      signal: controller.signal,
      terminalToolName: "chrona_node_complete",
    });

    expect(snapshot).toMatchObject({
      provider: "codex",
      status: "completed",
      outputText: "Codex complete",
      raw: {
        terminalActionRecorded: true,
        terminalTool: {
          name: "chrona_node_complete",
          input: { summary: "Codex complete" },
        },
      },
    });
  });

  it("completes when a terminal-action-aborted provider stream ends without a terminal event", async () => {
    const controller = new AbortController();
    const initialRun = runRef({
      provider: "codex",
      runId: "codex-terminal-ended-run",
      nativeRunId: "codex-terminal-ended-run",
      sessionId: "logical-session",
    });
    const client = {
      provider: "codex",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(async () => initialRun),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent({
            type: "tool_call",
            tool: "chrona_node_complete",
            callId: "complete-codex-ended",
            input: { summary: "Codex ended complete" },
            status: "pending",
          }, initialRun);
          setTimeout(
            () => controller.abort("Chrona terminal action recorded"),
            10,
          );
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, {
      ...request,
      provider: "codex",
      sessionId: "logical-session",
      sessionKey: "logical-session",
      terminalToolName: "chrona_node_complete",
    }, {
      signal: controller.signal,
      terminalToolName: "chrona_node_complete",
    });

    expect(snapshot).toMatchObject({
      status: "completed",
      outputText: "Codex ended complete",
      raw: {
        terminalActionRecorded: true,
        terminalTool: { name: "chrona_node_complete" },
      },
    });
  });

  it("cancels the provider run when the execution signal aborts during streaming", async () => {
    const controller = new AbortController();
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const cancelRun = mock(
      async (): Promise<ProviderRunSnapshot> => ({
        provider: "hermes",
        runId: "provider-run-1",
        nativeRunId: "provider-run-1",
        sessionId: "provider-session-1",
        status: "cancelled",
        error: null,
      }),
    );
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun: mock(
        async () =>
          ({
            provider: "hermes",
            runId: "provider-run-1",
            nativeRunId: "provider-run-1",
            sessionId: "provider-session-1",
            status: "running",
          }) satisfies ProviderRunRef,
      ),
      streamRun: mock(() =>
        (async function* () {
          yield providerEvent(
            { type: "text_delta", text: "started" },
            runRef({
              runId: "provider-run-1",
              nativeRunId: "provider-run-1",
              sessionId: "provider-session-1",
            }),
          );
          yield providerEvent({
            type: "run_completed",
            run: {
              provider: "hermes",
              runId: "provider-run-1",
              nativeRunId: "provider-run-1",
              sessionId: "provider-session-1",
              status: "completed",
            },
            outputText: "late completion",
          });
        })(),
      ),
      cancelRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request, {
      runId: run.id,
      providerRunRecordId: providerRun.id,
      signal: controller.signal,
      eventPersistence: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: run.workBlockId,
        occurrenceId: run.occurrenceId,
        runId: run.id,
        runtimeName: "hermes",
        taskSessionId: taskSession.id,
        executionSessionId: `execution-session-${task.id}`,
        nodeAttemptId: providerRun.nodeAttemptId,
        providerRunId: providerRun.id,
        planId: plan.planId,
        planRunId: planRun.id,
        executionScope: planRun.executionScopeId,
      },
      onRuntimeEvent(event) {
        if (event.type === "text_delta") controller.abort();
      },
    });

    expect(cancelRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "provider-run-1",
        sessionId: "provider-session-1",
      }),
    );
    expect(snapshot.status).toBe("cancelled");
    expect(snapshot.outputText).toBeUndefined();

    const reloaded = await db.taskPlanProviderRun.findUniqueOrThrow({
      where: { id: providerRun.id },
      select: { status: true, finishedAt: true },
    });
    expect(reloaded.status).toBe("completed");
    expect(reloaded.finishedAt).toBeInstanceOf(Date);
  });
});
describe("runProviderRequest provider attach-first", () => {
  it("streams an existing persisted ref without calling startRun", async () => {
    const existing = runRef({
      runId: "existing-run",
      nativeRunId: "native-existing-run",
      sessionId: "existing-session",
    });
    const startRun = mock(async () => runRef({ runId: "should-not-start" }));
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent(
          {
            type: "run_completed",
            run: { ...existing, status: "completed" },
            outputText: "attached",
          },
          existing,
        );
      })(),
    );
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request, {
      providerRunIdentity: "existing",
      existingRunRef: existing,
    });

    expect(startRun).not.toHaveBeenCalled();
    expect(streamRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "existing-run",
        sessionId: "existing-session",
      }),
    );
    expect(snapshot).toMatchObject({
      status: "completed",
      outputText: "attached",
    });
  });

  it("looks up an existing record without a persisted ref and attaches", async () => {
    const lookedUp = runRef({
      runId: "lookup-run",
      nativeRunId: "native-lookup-run",
      sessionId: "lookup-session",
    });
    const startRun = mock(async () => runRef({ runId: "should-not-start" }));
    const findRunByClientOperationId = mock(async () => lookedUp);
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent(
          {
            type: "run_completed",
            run: { ...lookedUp, status: "completed" },
            outputText: "lookup attached",
          },
          lookedUp,
        );
      })(),
    );
    const client = {
      provider: "hermes",
      getCapabilities: () => ({
        ...providerCapabilities(),
        startIdempotency: "client_operation_id" as const,
        lookupByClientOperationId: true,
      }),
      startRun,
      findRunByClientOperationId,
      streamRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request, {
      providerRunIdentity: "existing",
      clientOperationId: "operation-lookup",
    });

    expect(startRun).not.toHaveBeenCalled();
    expect(findRunByClientOperationId).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: "operation-lookup" }),
    );
    expect(streamRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "lookup-run",
        sessionId: "lookup-session",
      }),
    );
    expect(snapshot.outputText).toBe("lookup attached");
  });

  it("fails closed when lookup is unavailable and does not start", async () => {
    const startRun = mock(async () => runRef({ runId: "should-not-start" }));
    const client = {
      provider: "hermes",
      getCapabilities: () => ({
        ...providerCapabilities(),
        startIdempotency: "unsupported" as const,
        lookupByClientOperationId: false,
      }),
      startRun,
      streamRun: mock(() => incompleteStream()),
    } as unknown as AgentProviderClient;

    await expect(
      runProviderRequest(client, request, { providerRunIdentity: "existing" }),
    ).rejects.toThrow(/cannot repair an existing provider run/);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("starts only new records", async () => {
    const startRun = mock(async () =>
      runRef({
        runId: "new-run",
        nativeRunId: "native-new-run",
        sessionId: "new-session",
      }),
    );
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent({
          type: "run_completed",
          run: {
            provider: "hermes",
            runId: "new-run",
            nativeRunId: "native-new-run",
            sessionId: "new-session",
            status: "completed",
          },
          outputText: "new",
        });
      })(),
    );
    const client = {
      provider: "hermes",
      getCapabilities: () => providerCapabilities(),
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, request, {
      providerRunIdentity: "created",
    });
    await runProviderRequest(client, request, {
      providerRunIdentity: "existing",
      existingRunRef: runRef({
        runId: "new-run",
        nativeRunId: "native-new-run",
        sessionId: "new-session",
      }),
    });

    expect(startRun).toHaveBeenCalledTimes(1);
  });
});
describe("ensureProviderRunRecord attach-first identity", () => {
  it("returns existing persisted provider identity for an immutable attempt replay after a later command epoch", async () => {
    const { workspace, task, planRun, attempt, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const replayEpoch = planRun.executionEpoch + 2;
    await db.taskPlanRun.update({
      where: { id: planRun.id },
      data: { executionEpoch: replayEpoch },
    });
    const originalRun = await db.run.update({
      where: { id: run.id },
      data: {
        runtimeRunRef: "provider-run-replay",
        runtimeSessionRef: "provider-session-replay",
        status: RunStatus.Running,
      },
    });
    await db.taskSession.update({
      where: { id: taskSession.id },
      data: { providerSessionRef: "native-session-replay" },
    });
    await db.taskPlanProviderRun.update({
      where: { id: providerRun.id },
      data: {
        providerRunRef: "provider-run-replay",
        nativeRunId: "native-run-replay",
        aiClientId: "ai-client-test",
        aiClientConfigDigest: "config-digest",
        providerName: "hermes",
      },
    });

    const ensured = await ensureProviderRunRecord({
      workspaceId: workspace.id,
      taskId: task.id,
      expectedExecutionEpoch: replayEpoch,
      expectedExecutionSessionId: `execution-session-${task.id}`,
      workBlockId: null,
      occurrenceId: null,
      runId: run.id,
      nodeAttempt: {
        id: attempt.id,
        taskId: task.id,
        graphId: attempt.planId,
        nodeId: attempt.nodeId,
        nodeLayerId: attempt.nodeLayerId,
        executionContextSnapshotId: attempt.executionContextSnapshotId!,
        status: "running",
        idempotencyKey: attempt.idempotencyKey,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt.toISOString(),
      },
      providerRunIdempotencyKey: providerRun.idempotencyKey,
      aiClientId: "ai-client-test",
      aiClientConfigDigest: "config-digest",
      providerName: "hermes",
    });

    expect(ensured).toMatchObject({
      id: providerRun.id,
      identity: "existing",
      providerRunRef: "provider-run-replay",
      nativeRunId: "native-run-replay",
      runtimeRunRef: "provider-run-replay",
      runtimeSessionRef: "provider-session-replay",
      providerSessionRef: "native-session-replay",
    });
    expect(
      await db.taskPlanProviderRun.count({
        where: { idempotencyKey: providerRun.idempotencyKey },
      }),
    ).toBe(1);
    expect(originalRun.runtimeRunRef).toBe("provider-run-replay");
  });
});

describe("runtime context continuity", () => {
  it("[RUN-003] marks an unexpected missing provider session as explicit result-ref recovery", async () => {
    const { task, taskSession } = await seedProviderRunChain();
    const provider = {
      providerClientId: "ai-client-test",
      providerName: "hermes",
      providerConfigFingerprint: "config-digest",
    };
    await db.taskSession.update({
      where: { id: taskSession.id },
      data: provider,
    });

    await expect(resolveRuntimeContextContinuity(taskSession.id, provider)).resolves.toEqual({
      mode: "fresh",
      recovery: "provider_context",
    });

    await db.run.create({
      data: {
        taskId: task.id,
        taskSessionId: taskSession.id,
        runtimeName: "hermes",
        status: RunStatus.Completed,
        triggeredBy: "system",
      },
    });
    const recovery = await resolveRuntimeContextContinuity(taskSession.id, provider);
    expect(recovery).toEqual({
      mode: "recovery",
      reason: "provider_session_unavailable",
      recovery: "chrona_result_refs",
    });
    expect(continuityInstructions(recovery)).toContain("chrona_node_read");
    expect(
      withContextContinuity(
        { context: { relevantPreviousResults: [] } },
        recovery,
      ),
    ).toMatchObject({
      context: {
        run: {
          contextContinuity: {
            mode: "recovery",
            reason: "provider_session_unavailable",
            recovery: "chrona_result_refs",
          },
        },
      },
    });

    await db.taskSession.update({
      where: { id: taskSession.id },
      data: { providerSessionRef: "/tmp/omp-resumable.jsonl" },
    });
    await expect(resolveRuntimeContextContinuity(taskSession.id, provider)).resolves.toEqual({
      mode: "resumed",
      recovery: "provider_context",
      providerSessionRef: "/tmp/omp-resumable.jsonl",
    });
    await expect(resolveRuntimeContextContinuity(taskSession.id, {
      ...provider,
      providerClientId: "different-client",
    })).resolves.toEqual({
      mode: "recovery",
      reason: "provider_identity_changed",
      recovery: "chrona_result_refs",
    });
  });
});

describe("runProviderRequest resume threading", () => {
  it("forwards request.resumeSessionRef to the provider startRun for cross-process resume", async () => {
    const startRun = mock(async () =>
      runRef({ provider: "claude_code", sessionId: "sdk-session-1" }),
    );
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent(
          {
            type: "run_completed",
            run: {
              provider: "claude_code",
              runId: "run-1",
              nativeRunId: "run-1",
              sessionId: "sdk-session-1",
              status: "completed",
            },
            outputText: "ok",
          },
          runRef({ provider: "claude_code", sessionId: "sdk-session-1" }),
        );
      })(),
    );

    const client = {
      provider: "claude_code",
      getCapabilities: () => providerCapabilities(),
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, {
      ...request,
      resumeSessionRef: "sdk-session-prior",
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSessionRef: "sdk-session-prior" }),
    );
    expect(snapshot.sessionId).toBe("sdk-session-1");
  });

  it("does not forward synthetic Claude Code run ids as cross-process resume refs", async () => {
    const startRun = mock(async () =>
      runRef({ provider: "claude_code", sessionId: "sdk-session-1" }),
    );
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent(
          {
            type: "run_completed",
            run: {
              provider: "claude_code",
              runId: "run-1",
              nativeRunId: "run-1",
              sessionId: "sdk-session-1",
              status: "completed",
            },
            outputText: "ok",
          },
          runRef({ provider: "claude_code", sessionId: "sdk-session-1" }),
        );
      })(),
    );

    const client = {
      provider: "claude_code",
      getCapabilities: () => providerCapabilities(),
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, {
      ...request,
      resumeSessionRef: "claude-sdk-3583bad8-4764-417b-9998-973c5b6bde60",
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ resumeSessionRef: expect.anything() }),
    );
  });

  it("omits resumeSessionRef when the request has no prior provider session", async () => {
    const startRun = mock(async () =>
      runRef({ provider: "claude_code", sessionId: "sdk-session-1" }),
    );
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent(
          {
            type: "run_completed",
            run: {
              provider: "claude_code",
              runId: "run-1",
              nativeRunId: "run-1",
              sessionId: "sdk-session-1",
              status: "completed",
            },
            outputText: "ok",
          },
          runRef({ provider: "claude_code", sessionId: "sdk-session-1" }),
        );
      })(),
    );

    const client = {
      provider: "claude_code",
      getCapabilities: () => providerCapabilities(),
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, request);

    expect(startRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ resumeSessionRef: expect.anything() }),
    );
  });
});

describe("runProviderRequest runtime model threading", () => {
  it("forwards the task-pinned model to provider startRun", async () => {
    const startRun = mock(async () =>
      runRef({ provider: "omp", sessionId: "sdk-session-1" }),
    );
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent(
          {
            type: "run_completed",
            run: {
              provider: "omp",
              runId: "run-1",
              nativeRunId: "run-1",
              sessionId: "sdk-session-1",
              status: "completed",
            },
            outputText: "ok",
          },
          runRef({ provider: "omp", sessionId: "sdk-session-1" }),
        );
      })(),
    );
    const client = {
      provider: "omp",
      getCapabilities: () => providerCapabilities(),
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, {
      ...request,
      runtimeConfiguration: {
        model: "OmniRoute/gpt-5.6-sol",
        contextStrategy: "auto_compact",
      },
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeConfiguration: {
          model: "OmniRoute/gpt-5.6-sol",
          contextStrategy: "auto_compact",
        },
      }),
    );
  });
});

describe("runProviderRequest Chrona control handoff", () => {
  it("passes run-token control config to the OMP provider", async () => {
    const previousBaseUrl = process.env.CHRONA_BASE_URL;
    process.env.CHRONA_BASE_URL = "http://127.0.0.1:3101/api";
    const startRun = mock(async () =>
      runRef({ provider: "omp", sessionId: "sdk-session-1" }),
    );
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent(
          {
            type: "run_completed",
            run: {
              provider: "omp",
              runId: "run-1",
              nativeRunId: "run-1",
              sessionId: "sdk-session-1",
              status: "completed",
            },
            outputText: "ok",
          },
          runRef({ provider: "omp", sessionId: "sdk-session-1" }),
        );
      })(),
    );

    const client = {
      provider: "omp",
      getCapabilities: () => providerCapabilities(),
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    try {
      await runProviderRequest(client, request, {
        controlRunToken: "run-token-1",
      });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.CHRONA_BASE_URL;
      else process.env.CHRONA_BASE_URL = previousBaseUrl;
    }

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        control: {
          baseUrl: "http://127.0.0.1:3101/api",
          runToken: "run-token-1",
        },
      }),
    );
  });

  it("uses localhost API fallback when CHRONA_BASE_URL is unset", async () => {
    const previousBaseUrl = process.env.CHRONA_BASE_URL;
    const previousPort = process.env.PORT;
    delete process.env.CHRONA_BASE_URL;
    process.env.PORT = "3199";
    const startRun = mock(async () =>
      runRef({ provider: "omp", sessionId: "sdk-session-1" }),
    );
    const streamRun = mock(() =>
      (async function* () {
        yield providerEvent(
          {
            type: "run_completed",
            run: {
              provider: "omp",
              runId: "run-1",
              nativeRunId: "run-1",
              sessionId: "sdk-session-1",
              status: "completed",
            },
            outputText: "ok",
          },
          runRef({ provider: "omp", sessionId: "sdk-session-1" }),
        );
      })(),
    );

    const client = {
      provider: "omp",
      getCapabilities: () => providerCapabilities(),
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    try {
      await runProviderRequest(client, request, {
        controlRunToken: "run-token-1",
      });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.CHRONA_BASE_URL;
      else process.env.CHRONA_BASE_URL = previousBaseUrl;
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
    }

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        control: {
          baseUrl: "http://127.0.0.1:3199/api",
          runToken: "run-token-1",
        },
      }),
    );
  });
});

describe("provider attempt epoch fencing", () => {
  it("does not reclassify a prepared pre-restart attempt into the new epoch", async () => {
    const { workspace, task, planRun } = await seedProviderRunChain();
    await db.taskPlanRun.update({
      where: { id: planRun.id },
      data: { executionEpoch: 1 },
    });
    const staleAttempt: NodeAttempt = {
      id: "stale-prepared-attempt",
      taskId: task.id,
      graphId: "plan-1",
      nodeId: "stale-node",
      nodeLayerId: "stale-layer",
      executionContextSnapshotId: "stale-snapshot",
      status: "running",
      idempotencyKey: "stale-prepared-attempt-key",
      attemptNumber: 1,
      startedAt: "2026-05-22T00:00:00.000Z",
    };

    await expect(
      ensureProviderRunRecord({
        workspaceId: workspace.id,
        taskId: task.id,
        expectedExecutionEpoch: 1,
        expectedExecutionSessionId: "stale-execution-session",
        workBlockId: null,
        occurrenceId: null,
        runId: "stale-runtime-run",
        nodeAttempt: staleAttempt,
        providerRunIdempotencyKey: "stale-prepared-provider-key",
        aiClientId: "ai-client-test",
        aiClientConfigDigest: "config-digest",
        providerName: "hermes",
      }),
    ).rejects.toThrow(/Execution session changed/);

    expect(
      await db.taskPlanNodeAttempt.count({
        where: { idempotencyKey: staleAttempt.idempotencyKey },
      }),
    ).toBe(0);
    expect(
      await db.taskPlanProviderRun.count({
        where: { idempotencyKey: "stale-prepared-provider-key" },
      }),
    ).toBe(0);
  });
});

describe("provider runtime event persistence integrity", () => {
  it("retries one logical provider event idempotently and advances its task pointer by ingest order", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const context = {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: null,
      occurrenceId: null,
      runId: run.id,
      runtimeName: "hermes",
      taskSessionId: taskSession.id,
      executionSessionId: `execution-session-${task.id}`,
      nodeAttemptId: providerRun.nodeAttemptId,
      providerRunId: providerRun.id,
      planId: plan.planId,
      planRunId: planRun.id,
      executionScope: planRun.executionScopeId,
    };
    const newer = providerEvent({
      type: "text_delta",
      text: "newer",
      sequence: 2,
    });
    const older = providerEvent({
      type: "text_delta",
      text: "older",
      sequence: 1,
    });

    await persistProviderRuntimeEvent({
      context,
      event: newer,
      fallbackIndex: 2,
    });
    await persistProviderRuntimeEvent({
      context,
      event: newer,
      fallbackIndex: 2,
    });
    await persistProviderRuntimeEvent({
      context,
      event: older,
      fallbackIndex: 1,
    });

    expect(
      await db.rawEventLog.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(2);
    expect(
      await db.event.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(2);
    const canonical = await db.event.findFirstOrThrow({
      where: { providerRunId: providerRun.id },
      orderBy: { ingestSequence: "desc" },
    });
    const reloaded = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { latestEventId: true, latestEventSequence: true },
    });
    expect(reloaded).toEqual({
      latestEventId: canonical.id,
      latestEventSequence: canonical.ingestSequence,
    });
    const raw = await db.rawEventLog.findFirstOrThrow({
      where: { providerRunId: providerRun.id },
    });
    expect(raw).toMatchObject({
      occurrenceId: null,
      workBlockId: null,
      planRunId: planRun.id,
      taskSessionId: taskSession.id,
    });
    expect(canonical).toMatchObject({
      occurrenceId: null,
      taskSessionId: taskSession.id,
      planRunId: planRun.id,
    });
    expect(canonical.payload).toMatchObject({
      executionScope: planRun.executionScopeId,
    });
  });

  it("persists the first provider-native session ref observed after run start", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const nativeSessionId = "/tmp/omp-observed-session.jsonl";
    const context = {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: null,
      occurrenceId: null,
      runId: run.id,
      runtimeName: "hermes",
      providerClientId: "ai-client-test",
      providerConfigFingerprint: "config-digest",
      taskSessionId: taskSession.id,
      executionSessionId: `execution-session-${task.id}`,
      nodeAttemptId: providerRun.nodeAttemptId,
      providerRunId: providerRun.id,
      planId: plan.planId,
      planRunId: planRun.id,
      executionScope: planRun.executionScopeId,
    };

    await persistProviderRuntimeEvent({
      context,
      event: providerEvent({
        type: "run_started",
        run: {
          provider: "omp",
          runId: "omp-run",
          nativeRunId: "omp-run",
          sessionId: "logical-session",
          nativeSessionId,
          status: "running",
        },
      }),
      fallbackIndex: 1,
    });

    expect(await db.taskSession.findUniqueOrThrow({
      where: { id: taskSession.id },
      select: { providerSessionRef: true },
    })).toEqual({ providerSessionRef: nativeSessionId });
    expect(await db.run.findUniqueOrThrow({
      where: { id: run.id },
      select: { runtimeSessionRef: true },
    })).toEqual({ runtimeSessionRef: nativeSessionId });
  });

  it("rejects a late provider event after task-session provider provenance changes", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    await db.taskSession.update({
      where: { id: taskSession.id },
      data: {
        providerClientId: "replacement-client",
        providerName: "omp",
        providerConfigFingerprint: "replacement-digest",
        providerSessionRef: null,
      },
    });

    await expect(persistProviderRuntimeEvent({
      context: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: null,
        occurrenceId: null,
        runId: run.id,
        runtimeName: "hermes",
        providerClientId: "ai-client-test",
        providerConfigFingerprint: "config-digest",
        taskSessionId: taskSession.id,
        executionSessionId: `execution-session-${task.id}`,
        nodeAttemptId: providerRun.nodeAttemptId,
        providerRunId: providerRun.id,
        planId: plan.planId,
        planRunId: planRun.id,
        executionScope: planRun.executionScopeId,
      },
      event: providerEvent({ type: "text_delta", text: "late" }),
      fallbackIndex: 1,
    })).rejects.toThrow("scope no longer matches");
  });

  it("rejects provider events after their execution session is abandoned", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    await db.executionSession.update({
      where: { id: `execution-session-${task.id}` },
      data: { status: "Abandoned", activeScopeKey: null },
    });
    const context = {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: null,
      occurrenceId: null,
      runId: run.id,
      runtimeName: "hermes",
      taskSessionId: taskSession.id,
      executionSessionId: `execution-session-${task.id}`,
      nodeAttemptId: providerRun.nodeAttemptId,
      providerRunId: providerRun.id,
      planId: plan.planId,
      planRunId: planRun.id,
      executionScope: planRun.executionScopeId,
    };

    await expect(
      persistProviderRuntimeEvent({
        context,
        event: providerEvent({ type: "text_delta", text: "late" }),
        fallbackIndex: 1,
      }),
    ).rejects.toThrow(/scope no longer matches active execution/);
    expect(
      await db.rawEventLog.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(0);
  });

  it("surfaces persistence failures and permits a clean idempotent retry without partial records", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const context = {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: null,
      occurrenceId: null,
      runId: run.id,
      runtimeName: "hermes",
      taskSessionId: taskSession.id,
      executionSessionId: `execution-session-${task.id}`,
      nodeAttemptId: providerRun.nodeAttemptId,
      providerRunId: providerRun.id,
      planId: plan.planId,
      planRunId: planRun.id,
      executionScope: planRun.executionScopeId,
    };
    setAfterRawEventPersistedForTest(() => {
      throw new Error("injected post-raw failure");
    });
    const event = {
      ...providerEvent({ type: "text_delta", text: "retry" }),
      sequence: 7,
    } as ProviderRunEvent;

    await expect(
      persistProviderRuntimeEvent({ context, event, fallbackIndex: 7 }),
    ).rejects.toThrow("injected post-raw failure");
    expect(
      await db.rawEventLog.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(0);
    expect(
      await db.event.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(0);

    setAfterRawEventPersistedForTest();
    await expect(
      persistProviderRuntimeEvent({ context, event, fallbackIndex: 7 }),
    ).resolves.toBeUndefined();
    expect(
      await db.rawEventLog.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(1);
    expect(
      await db.event.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(1);
  });

  it("keeps the first provider terminal candidate authoritative for its audit row", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const context = {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: null,
      occurrenceId: null,
      runId: run.id,
      runtimeName: "hermes",
      taskSessionId: taskSession.id,
      executionSessionId: `execution-session-${task.id}`,
      nodeAttemptId: providerRun.nodeAttemptId,
      providerRunId: providerRun.id,
      planId: plan.planId,
      planRunId: planRun.id,
      executionScope: planRun.executionScopeId,
    };
    const approval = await db.taskPlanProviderApproval.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: plan.planId,
        planRunId: planRun.id,
        nodeAttemptId: providerRun.nodeAttemptId,
        providerRunId: providerRun.id,
        approvalRef: "candidate-terminal-approval",
        provider: "hermes",
        kind: "command",
        title: "Approve",
        summary: "Await Chrona resolution",
        riskLevel: "medium",
        choices: [],
        status: "pending",
        requestedAt: new Date("2026-08-02T00:00:00.000Z"),
      },
    });
    const completed = {
      ...providerEvent({
        type: "run_completed",
        run: { ...runRef(), status: "completed" },
        outputText: "done",
      }),
      sequence: 10,
    } as ProviderRunEvent;
    const conflictingFailure = {
      ...providerEvent({
        type: "run_failed",
        run: { ...runRef(), status: "failed" },
        error: "late failure",
      }),
      sequence: 11,
    } as ProviderRunEvent;

    await persistProviderRuntimeEvent({
      context,
      event: completed,
      fallbackIndex: 10,
    });
    await expect(
      persistProviderRuntimeEvent({
        context,
        event: conflictingFailure,
        fallbackIndex: 11,
      }),
    ).rejects.toThrow("scope no longer matches active execution");

    expect(
      await db.taskPlanProviderRun.findUniqueOrThrow({
        where: { id: providerRun.id },
      }),
    ).toMatchObject({
      status: "completed",
      completedByEventId: expect.any(String),
      failedByEventId: null,
    });
    expect(
      await db.taskPlanProviderApproval.findUniqueOrThrow({
        where: { id: approval.id },
      }),
    ).toMatchObject({
      status: "superseded",
      resolvedAt: expect.any(Date),
      resolvedBy: "provider",
    });
  });

  it("advances task pointers for a later provider run even when its provider sequence resets", async () => {
    const first = await seedProviderRunChain();
    const secondAttempt = await db.taskPlanNodeAttempt.create({
      data: {
        workspaceId: first.workspace.id,
        taskId: first.task.id,
        planId: first.plan.planId,
        planRunId: first.planRun.id,
        nodeId: "node-2",
        nodeLayerId: "layer-2",
        idempotencyKey: "attempt-key-2",
        attemptNumber: 2,
        status: "running",
        executionEpoch: 0,
      },
    });
    const secondProviderRun = await db.taskPlanProviderRun.create({
      data: {
        workspaceId: first.workspace.id,
        taskId: first.task.id,
        planId: first.plan.planId,
        planRunId: first.planRun.id,
        nodeAttemptId: secondAttempt.id,
        idempotencyKey: "provider-run-key-2",
        status: "running",
      },
    });
    const secondRun = await db.run.create({
      data: {
        taskId: first.task.id,
        nodeAttemptId: secondAttempt.id,
        taskSessionId: first.taskSession.id,
        runtimeName: "hermes",
        status: RunStatus.Pending,
        triggeredBy: "system",
      },
    });
    await db.taskPlanProviderRun.update({
      where: { id: secondProviderRun.id },
      data: { runId: secondRun.id },
    });
    const firstContext = {
      workspaceId: first.workspace.id,
      taskId: first.task.id,
      workBlockId: null,
      occurrenceId: null,
      runId: first.run.id,
      runtimeName: "hermes",
      taskSessionId: first.taskSession.id,
      executionSessionId: `execution-session-${first.task.id}`,
      nodeAttemptId: first.providerRun.nodeAttemptId,
      providerRunId: first.providerRun.id,
      planId: first.plan.planId,
      planRunId: first.planRun.id,
      executionScope: first.planRun.executionScopeId,
    };
    const secondContext = {
      ...firstContext,
      runId: secondRun.id,
      providerRunId: secondProviderRun.id,
      nodeAttemptId: secondAttempt.id,
    };

    await persistProviderRuntimeEvent({
      context: firstContext,
      event: {
        ...providerEvent({ type: "text_delta", text: "first" }),
        sequence: 9,
      } as ProviderRunEvent,
      fallbackIndex: 9,
    });
    await db.executionSession.update({
      where: { id: `execution-session-${first.task.id}` },
      data: {
        currentNodeId: secondAttempt.nodeId,
        currentNodeAttemptId: secondAttempt.id,
      },
    });
    await persistProviderRuntimeEvent({
      context: secondContext,
      event: {
        ...providerEvent({ type: "text_delta", text: "second" }),
        sequence: 1,
      } as ProviderRunEvent,
      fallbackIndex: 1,
    });

    const latest = await db.task.findUniqueOrThrow({
      where: { id: first.task.id },
      select: { latestEventId: true },
    });
    const secondEvent = await db.event.findFirstOrThrow({
      where: { providerRunId: secondProviderRun.id },
    });
    expect(latest.latestEventId).toBe(secondEvent.id);
  });

  it("persists a provider terminal candidate without terminalizing the canonical Run", async () => {
    const {
      workspace,
      task,
      plan,
      planRun,
      providerRun,
      run,
      taskSession,
      attempt,
    } = await seedProviderRunChain();
    const executionSessionId = `execution-session-${task.id}`;

    await finalizeRuntimeInvocationForTest({
      input: {
        taskId: task.id,
        expectedExecutionEpoch: planRun.executionEpoch,
        expectedExecutionSessionId: executionSessionId,
        taskSessionId: taskSession.id,
        runtimeSessionKey: "provider-session",
        nodeAttempt: asRuntimeAttempt(attempt),
        clientOperationId: "terminal-candidate-only",
        runtimeInput: { kind: "task" },
        instructions: "candidate response",
      },
      runId: run.id,
      providerName: "hermes",
      request,
      response: {
        provider: "hermes",
        runId: "provider-terminal-candidate",
        nativeRunId: "provider-terminal-candidate",
        sessionId: "provider-session",
        status: "completed",
        outputText: "candidate only",
        error: null,
      },
      providerRunRecordId: providerRun.id,
      scope: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: run.workBlockId,
        occurrenceId: run.occurrenceId,
        runId: run.id,
        runtimeName: "hermes",
        taskSessionId: taskSession.id,
        executionSessionId,
        nodeAttemptId: providerRun.nodeAttemptId,
        providerRunId: providerRun.id,
        planId: plan.planId,
        planRunId: planRun.id,
        executionScope: planRun.executionScopeId,
      },
    });

    expect(
      await db.run.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({
      status: RunStatus.Running,
      runtimeRunRef: "provider-terminal-candidate",
      endedAt: null,
    });
    expect(
      await db.taskPlanProviderRun.findUniqueOrThrow({
        where: { id: providerRun.id },
      }),
    ).toMatchObject({
      status: "completed",
      providerRunRef: "provider-terminal-candidate",
    });
  });

  it("does not write conversation history when a late terminal snapshot loses the active-run guard", async () => {
    const { task, run, attempt } = await seedProviderRunChain();
    await db.run.update({
      where: { id: run.id },
      data: { status: RunStatus.Cancelled },
    });

    const invocation = await finalizeRuntimeInvocationForTest({
      input: {
        taskId: task.id,
        expectedExecutionEpoch: -1,
        expectedExecutionSessionId: "unused-execution-session",
        taskSessionId: "unused-session",
        runtimeSessionKey: "provider-session",
        nodeAttempt: asRuntimeAttempt(attempt),
        clientOperationId: "late-terminal",
        runtimeInput: { kind: "task" },
        instructions: "late response",
      },
      runId: run.id,
      providerName: "hermes",
      request,
      response: {
        provider: "hermes",
        runId: "late-provider-run",
        nativeRunId: "late-provider-run",
        sessionId: "provider-session",
        status: "completed",
        outputText: "must not persist",
        error: null,
      },
    });

    expect(invocation.conversationEntryIds).toEqual([]);
    expect(await db.conversationEntry.count({ where: { runId: run.id } })).toBe(
      0,
    );
  });

  it("rejects a late terminal snapshot after its execution session is abandoned", async () => {
    const {
      workspace,
      task,
      plan,
      planRun,
      providerRun,
      run,
      taskSession,
      attempt,
    } = await seedProviderRunChain();
    const executionSessionId = `execution-session-${task.id}`;
    await db.executionSession.update({
      where: { id: executionSessionId },
      data: { status: "Abandoned", activeScopeKey: null },
    });

    await expect(
      finalizeRuntimeInvocationForTest({
        input: {
          taskId: task.id,
          expectedExecutionEpoch: planRun.executionEpoch,
          expectedExecutionSessionId: executionSessionId,
          taskSessionId: taskSession.id,
          runtimeSessionKey: "provider-session",
          nodeAttempt: asRuntimeAttempt(attempt),
          clientOperationId: "late-abandoned-terminal",
          runtimeInput: { kind: "task" },
          instructions: "late response",
        },
        runId: run.id,
        providerName: "hermes",
        request,
        response: {
          provider: "hermes",
          runId: "late-abandoned-provider-run",
          nativeRunId: "late-abandoned-provider-run",
          sessionId: "provider-session",
          status: "completed",
          outputText: "must not persist",
          error: null,
        },
        providerRunRecordId: providerRun.id,
        scope: {
          workspaceId: workspace.id,
          taskId: task.id,
          workBlockId: run.workBlockId,
          occurrenceId: run.occurrenceId,
          runId: run.id,
          runtimeName: "hermes",
          taskSessionId: taskSession.id,
          executionSessionId,
          nodeAttemptId: providerRun.nodeAttemptId,
          providerRunId: providerRun.id,
          planId: plan.planId,
          planRunId: planRun.id,
          executionScope: planRun.executionScopeId,
        },
      }),
    ).rejects.toThrow(
      "Provider runtime scope no longer matches active execution",
    );

    expect(await db.conversationEntry.count({ where: { runId: run.id } })).toBe(
      0,
    );
  });

  it("rejects an event whose occurrence scope no longer matches without accepting partial records", async () => {
    const { workspace, task, plan, planRun, providerRun, run, taskSession } =
      await seedProviderRunChain();
    const otherOccurrence = await db.taskOccurrence.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        occurrenceKey: "other-occurrence",
        source: {},
        status: "Ready",
        eligibleAt: new Date(),
      },
    });

    await expect(
      persistProviderRuntimeEvent({
        context: {
          workspaceId: workspace.id,
          taskId: task.id,
          workBlockId: null,
          occurrenceId: otherOccurrence.id,
          runId: run.id,
          runtimeName: "hermes",
          taskSessionId: taskSession.id,
          executionSessionId: `execution-session-${task.id}`,
          nodeAttemptId: providerRun.nodeAttemptId,
          providerRunId: providerRun.id,
          planId: plan.planId,
          planRunId: planRun.id,
          executionScope: planRun.executionScopeId,
        },
        event: providerEvent({ type: "text_delta", text: "cross-occurrence" }),
        fallbackIndex: 1,
      }),
    ).rejects.toThrow("scope no longer matches");

    expect(
      await db.rawEventLog.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(0);
    expect(
      await db.event.count({ where: { providerRunId: providerRun.id } }),
    ).toBe(0);
  });
});
