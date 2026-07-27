import { describe, expect, it } from "bun:test";
import type { NodeAttempt } from "@chrona/contracts/ai";
import { attemptForRuntimeRun, runningAttemptForRuntimeRun, runtimeRunRefFromAttempt } from "./attempts";
import { shouldReconcileTerminalProviderRun } from "./reconcile-stale-runtime-runs";
import { nodeResultForRuntimeRun } from "./node-result";

const runningAttempt = {
  id: "attempt-1",
  nodeId: "node-1",
  status: "running",
  runtimeSnapshot: { output: { runtimeRunRef: "run-1" } },
} as unknown as NodeAttempt;

const completedAttempt = {
  id: "attempt-2",
  nodeId: "node-2",
  status: "completed",
  runtimeSnapshot: { output: { runtimeRunRef: "run-2" } },
} as unknown as NodeAttempt;

describe("sync runtime result attempts", () => {
  it("extracts runtime run refs only from structured runtime snapshots", () => {
    expect(runtimeRunRefFromAttempt(runningAttempt)).toBe("run-1");
    expect(runtimeRunRefFromAttempt({ runtimeSnapshot: { output: null } } as unknown as NodeAttempt)).toBeNull();
    expect(runtimeRunRefFromAttempt({ runtimeSnapshot: { output: { runtimeRunRef: 123 } } } as unknown as NodeAttempt)).toBeNull();
  });

  it("finds only running attempts when resuming a live runtime run", () => {
    const attempts = [completedAttempt, runningAttempt];

    expect(runningAttemptForRuntimeRun({ attempts, runtimeRunRef: "run-1" })).toBe(runningAttempt);
    expect(runningAttemptForRuntimeRun({ attempts, runtimeRunRef: "run-2" })).toBeUndefined();
    expect(attemptForRuntimeRun({ attempts, runtimeRunRef: "run-2" })).toBe(completedAttempt);
  });
});

describe("nodeResultForRuntimeRun", () => {
  it("maps completed runtime runs to done node results with preserved output", () => {
    expect(nodeResultForRuntimeRun({
      attempt: runningAttempt,
      mainSessionId: "session-1",
      runtimeRunRef: "run-1",
      status: "Completed",
      summary: "  Finished report  ",
      output: { ok: true },
    })).toEqual({
      nodeId: "node-1",
      status: "done",
      summary: "Finished report",
      evidence: { sessionId: "session-1", runId: "run-1" },
      output: { ok: true },
    });
  });

  it("maps cancelled and failed runtime runs to terminal error results", () => {
    expect(nodeResultForRuntimeRun({
      attempt: runningAttempt,
      mainSessionId: "session-1",
      runtimeRunRef: "run-1",
      status: "Cancelled",
      error: "  stopped by user  ",
    })).toMatchObject({ status: "cancelled", reason: "stopped by user" });

    expect(nodeResultForRuntimeRun({
      attempt: runningAttempt,
      mainSessionId: "session-1",
      runtimeRunRef: "run-1",
      status: "Failed",
      error: "  provider crashed  ",
    })).toMatchObject({ status: "failed", error: "provider crashed" });
  });
});

describe("terminal provider Run convergence", () => {
  it("repairs an active canonical Run after its provider record becomes terminal", () => {
    expect(shouldReconcileTerminalProviderRun({
      providerStatus: "cancelled",
      runStatus: "Running",
      runId: "run-1",
      latestRunId: "run-1",
      taskStatus: "Running",
    })).toBe(true);
  });

  it("repairs the legacy cancelled-Run mismatch while the task is still non-terminal", () => {
    expect(shouldReconcileTerminalProviderRun({
      providerStatus: "cancelled",
      runStatus: "Cancelled",
      runId: "run-1",
      latestRunId: "run-1",
      taskStatus: "Running",
    })).toBe(true);
  });

  it("does not replay historical terminal provider records", () => {
    expect(shouldReconcileTerminalProviderRun({
      providerStatus: "cancelled",
      runStatus: "Cancelled",
      runId: "run-old",
      latestRunId: "run-new",
      taskStatus: "Running",
    })).toBe(false);
  });
});
