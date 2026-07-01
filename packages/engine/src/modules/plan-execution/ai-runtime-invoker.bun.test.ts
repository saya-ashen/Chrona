import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  AgentProviderClient,
  ProviderRunEvent,
  ProviderRunRef,
  ProviderRunSnapshot,
} from "@chrona/providers-foundation";
import { db } from "@/lib/db";
import { RunStatus, TaskPlanStatus, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { runProviderRequest } from "./ai-runtime-invoker";

const request = {
  sessionId: "session-1",
  sessionKey: "session-key-1",
  instructions: "do work",
  input: { kind: "task" },
};

function runRef(): ProviderRunRef {
  return {
    provider: "hermes",
    runId: "run-1",
    nativeRunId: "run-1",
    sessionId: "session-1",
    status: "running",
  };
}

function incompleteStream(): AsyncIterable<ProviderRunEvent> {
  return (async function* () {
    yield { type: "text_delta", text: "partial", runId: "run-1" } as ProviderRunEvent;
    // Ends without a terminal run_completed/run_failed event.
  })();
}


async function resetDb() {
  await db.run.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedRunPair() {
  const workspace = await db.workspace.create({
    data: { name: "Runtime ref workspace", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: { workspaceId: workspace.id, title: "Runtime ref task", executionRuntime: "hermes", executionConfig: {}, status: TaskStatus.Running, priority: TaskPriority.Medium },
  });
  const first = await db.run.create({
    data: { taskId: task.id, runtimeName: "hermes", runtimeRunRef: "provider-run-1", runtimeSessionRef: "provider-session-1", status: RunStatus.Running, triggeredBy: "system" },
  });
  const second = await db.run.create({
    data: { taskId: task.id, runtimeName: "hermes", status: RunStatus.Pending, triggeredBy: "system" },
  });
  return { first, second };
}

async function seedProviderRunChain() {
  const workspace = await db.workspace.create({
    data: { name: "Provider audit workspace", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: { workspaceId: workspace.id, title: "Provider audit task", executionRuntime: "hermes", executionConfig: {}, status: TaskStatus.Running, priority: TaskPriority.Medium },
  });
  const plan = await db.taskPlan.create({
    data: { workspaceId: workspace.id, taskId: task.id, planId: "plan-1", revision: 1, status: TaskPlanStatus.Accepted, compiledPlan: {} },
  });
  const planRun = await db.taskPlanRun.create({
    data: { workspaceId: workspace.id, taskId: task.id, planId: plan.planId, planRun: {} },
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
      idempotencyKey: "provider-run-key-1",
      status: "running",
    },
  });
  const run = await db.run.create({
    data: { taskId: task.id, runtimeName: "hermes", status: RunStatus.Pending, triggeredBy: "system" },
  });
  return { workspace, task, plan, planRun, attempt, providerRun, run };
}

beforeEach(async () => {
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

  it("rethrows non-transient stream errors without reconnecting or polling", async () => {
    const getRun = mock(async () => {
      throw new Error("should not be called");
    });
    const streamRun = mock((): AsyncIterable<ProviderRunEvent> =>
      (async function* () {
        yield* [];
        throw new Error("fatal misconfiguration");
      })(),
    );

    const client = {
      provider: "hermes",
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
      startRun: mock(async () => ({
        provider: "hermes",
        runId: "provider-run-1",
        nativeRunId: "provider-run-1",
        sessionId: "provider-session-1",
        status: "running",
      } satisfies ProviderRunRef)),
      streamRun: mock(() =>
        (async function* () {
          yield {
            type: "run_completed",
            run: { runId: "provider-run-1", nativeRunId: "provider-run-1", sessionId: "provider-session-1", status: "completed" },
            outputText: "ok",
          } as ProviderRunEvent;
        })(),
      ),
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, request, { runId: second.id });

    const runs = await db.run.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, runtimeRunRef: true } });
    expect(runs).toEqual([
      { id: first.id, runtimeRunRef: "provider-run-1" },
      { id: second.id, runtimeRunRef: `provider-run-1:${second.id}` },
    ]);
  });

  it("treats run_completed as completed even when embedded run status is still running", async () => {
    const { second } = await seedRunPair();
    const client = {
      provider: "hermes",
      startRun: mock(async () => ({
        provider: "hermes",
        runId: "provider-run-1",
        nativeRunId: "provider-run-1",
        sessionId: "provider-session-1",
        status: "running",
      } satisfies ProviderRunRef)),
      streamRun: mock(() =>
        (async function* () {
          yield {
            type: "run_completed",
            run: { runId: "provider-run-1", nativeRunId: "provider-run-1", sessionId: "provider-session-1", status: "running" },
            outputText: "ok",
          } as ProviderRunEvent;
        })(),
      ),
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request, { runId: second.id });

    expect(snapshot.status).toBe("completed");
    expect(snapshot.outputText).toBe("ok");
  });

  it("closes provider audit rows from terminal run_completed events", async () => {
    const { workspace, task, providerRun, run } = await seedProviderRunChain();
    const client = {
      provider: "hermes",
      startRun: mock(async () => ({
        provider: "hermes",
        runId: "provider-run-1",
        nativeRunId: "provider-run-1",
        sessionId: "provider-session-1",
        status: "running",
      } satisfies ProviderRunRef)),
      streamRun: mock(() =>
        (async function* () {
          yield {
            type: "run_completed",
            run: { runId: "provider-run-1", nativeRunId: "provider-run-1", sessionId: "provider-session-1", status: "running" },
            outputText: "ok",
          } as ProviderRunEvent;
        })(),
      ),
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, request, {
      runId: run.id,
      providerRunRecordId: providerRun.id,
      eventPersistence: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        runtimeName: "hermes",
        providerRunId: providerRun.id,
      },
    });

    const reloaded = await db.taskPlanProviderRun.findUniqueOrThrow({
      where: { id: providerRun.id },
      select: { status: true, finishedAt: true, completedByEventId: true, failedByEventId: true },
    });
    expect(reloaded.status).toBe("completed");
    expect(reloaded.finishedAt).toBeInstanceOf(Date);
    expect(reloaded.completedByEventId).toBeString();
    expect(reloaded.failedByEventId).toBeNull();
  });

  it("cancels the provider run when the execution signal aborts during streaming", async () => {
    const controller = new AbortController();
    const { providerRun, run } = await seedProviderRunChain();
    const cancelRun = mock(async (): Promise<ProviderRunSnapshot> => ({
      provider: "hermes",
      runId: "provider-run-1",
      nativeRunId: "provider-run-1",
      sessionId: "provider-session-1",
      status: "cancelled",
      error: null,
    }));
    const client = {
      provider: "hermes",
      startRun: mock(async () => ({
        provider: "hermes",
        runId: "provider-run-1",
        nativeRunId: "provider-run-1",
        sessionId: "provider-session-1",
        status: "running",
      } satisfies ProviderRunRef)),
      streamRun: mock(() =>
        (async function* () {
          yield { type: "text_delta", text: "started" } as ProviderRunEvent;
          yield {
            type: "run_completed",
            run: { runId: "provider-run-1", nativeRunId: "provider-run-1", sessionId: "provider-session-1", status: "completed" },
            outputText: "late completion",
          } as ProviderRunEvent;
        })(),
      ),
      cancelRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request, {
      runId: run.id,
      providerRunRecordId: providerRun.id,
      signal: controller.signal,
      onRuntimeEvent(event) {
        if (event.type === "text_delta") controller.abort();
      },
    });

    expect(cancelRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "provider-run-1", sessionId: "provider-session-1" }));
    expect(snapshot.status).toBe("cancelled");
    expect(snapshot.outputText).toBeUndefined();

    const reloaded = await db.taskPlanProviderRun.findUniqueOrThrow({
      where: { id: providerRun.id },
      select: { status: true, finishedAt: true },
    });
    expect(reloaded.status).toBe("cancelled");
    expect(reloaded.finishedAt).toBeInstanceOf(Date);
  });
});

describe("runProviderRequest resume threading", () => {
  it("forwards request.resumeSessionRef to the provider startRun for cross-process resume", async () => {
    const startRun = mock(async () => runRef());
    const streamRun = mock(() =>
      (async function* () {
        yield {
          type: "run_completed",
          run: { runId: "run-1", nativeRunId: "run-1", sessionId: "sdk-session-1", status: "completed" },
          outputText: "ok",
        } as ProviderRunEvent;
      })(),
    );

    const client = {
      provider: "claude_code",
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

  it("omits resumeSessionRef when the request has no prior provider session", async () => {
    const startRun = mock(async () => runRef());
    const streamRun = mock(() =>
      (async function* () {
        yield {
          type: "run_completed",
          run: { runId: "run-1", nativeRunId: "run-1", sessionId: "sdk-session-1", status: "completed" },
          outputText: "ok",
        } as ProviderRunEvent;
      })(),
    );

    const client = {
      provider: "claude_code",
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    await runProviderRequest(client, request);

    expect(startRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ resumeSessionRef: expect.anything() }),
    );
  });
});
