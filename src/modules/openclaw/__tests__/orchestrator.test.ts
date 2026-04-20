import { describe, expect, it, vi } from "vitest";
import {
  createStatefulMockAdapter,
} from "@/modules/openclaw/mock-adapter";
import {
  OpenClawOrchestrator,
  createOrchestrator,
} from "@/modules/openclaw/orchestrator";
import type { OpenClawOrchestratorEvent } from "@/modules/openclaw/types";

// ---------------------------------------------------------------------------
// Orchestrator with stateful mock adapter
// ---------------------------------------------------------------------------

describe("OpenClawOrchestrator", () => {
  function createTestOrchestrator(
    adapterOpts?: Parameters<typeof createStatefulMockAdapter>[0],
    orchestratorConfig?: ConstructorParameters<typeof OpenClawOrchestrator>[0]["config"],
    onEvent?: (event: OpenClawOrchestratorEvent) => void,
  ) {
    const adapter = createStatefulMockAdapter(adapterOpts);
    const orchestrator = createOrchestrator({
      adapter,
      config: orchestratorConfig,
      onEvent,
    });
    return { adapter, orchestrator };
  }

  // -- executeTask: wait-for-completion --------------------------------------

  describe("executeTask (wait-for-completion)", () => {
    it("completes a simple task with auto-complete adapter", async () => {
      const { orchestrator } = createTestOrchestrator(
        { autoComplete: true, completionDelay: 0 },
        { strategy: "wait-for-completion", pollIntervalMs: 10, timeoutMs: 5_000 },
      );

      const result = await orchestrator.executeTask({
        prompt: "Do something simple",
        runtimeInput: {},
        runtimeSessionKey: "orch:1",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("Completed");
      expect(result.runtimeRunRef).toBeTruthy();
      expect(result.runtimeSessionKey).toBe("orch:1");
      expect(result.attempts).toBe(1);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.history.messages.length).toBeGreaterThan(0);
    });

    it("handles approval automatically with auto-approve strategy", async () => {
      const { orchestrator } = createTestOrchestrator(
        { requireApproval: true, autoComplete: true, completionDelay: 0 },
        { strategy: "wait-for-completion", pollIntervalMs: 10, timeoutMs: 5_000 },
      );

      const result = await orchestrator.executeTask({
        prompt: "Needs approval task",
        runtimeInput: {},
        runtimeSessionKey: "orch:approval:1",
        approvalStrategy: "auto-approve",
      });

      // The mock stateful adapter with requireApproval transitions to WaitingForApproval,
      // then the orchestrator auto-approves it, which transitions to Completed
      expect(result.runtimeRunRef).toBeTruthy();
      expect(result.runtimeSessionKey).toBe("orch:approval:1");
    });

    it("returns failure when run fails (non-transient)", async () => {
      const { orchestrator } = createTestOrchestrator(
        { failRate: 1 },
        { strategy: "wait-for-completion", pollIntervalMs: 10, timeoutMs: 5_000, maxRetries: 0 },
      );

      const result = await orchestrator.executeTask({
        prompt: "Will fail",
        runtimeInput: {},
        runtimeSessionKey: "orch:fail:1",
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("Failed");
    });

    it("emits progress events", async () => {
      const events: OpenClawOrchestratorEvent[] = [];
      const { orchestrator } = createTestOrchestrator(
        { autoComplete: true, completionDelay: 0 },
        { strategy: "wait-for-completion", pollIntervalMs: 10, timeoutMs: 5_000 },
        (event) => events.push(event),
      );

      await orchestrator.executeTask({
        prompt: "Track progress",
        runtimeInput: {},
        runtimeSessionKey: "orch:events:1",
      });

      const startEvents = events.filter((e) => e.type === "run:started");
      expect(startEvents.length).toBe(1);

      const completedEvents = events.filter((e) => e.type === "run:completed");
      expect(completedEvents.length).toBe(1);
    });

    it("calls onProgress callback", async () => {
      const progressCalls: unknown[] = [];
      const { orchestrator } = createTestOrchestrator(
        { autoComplete: true, completionDelay: 0 },
        { strategy: "wait-for-completion", pollIntervalMs: 10, timeoutMs: 5_000 },
      );

      await orchestrator.executeTask({
        prompt: "Progress callback test",
        runtimeInput: {},
        runtimeSessionKey: "orch:progress:1",
        onProgress: (event) => progressCalls.push(event),
      });

      expect(progressCalls.length).toBeGreaterThan(0);
    });

    it("generates a session key when none is provided", async () => {
      const { orchestrator } = createTestOrchestrator(
        { autoComplete: true, completionDelay: 0 },
        { strategy: "wait-for-completion", pollIntervalMs: 10, timeoutMs: 5_000 },
      );

      const result = await orchestrator.executeTask({
        prompt: "No session key",
        runtimeInput: {},
      });

      expect(result.success).toBe(true);
      expect(result.runtimeSessionKey).toBeTruthy();
    });
  });

  // -- executeTask: fire-and-forget ------------------------------------------

  describe("executeTask (fire-and-forget)", () => {
    it("returns immediately without waiting for completion", async () => {
      const { orchestrator } = createTestOrchestrator(
        { autoComplete: false },
        { strategy: "fire-and-forget" },
      );

      const result = await orchestrator.executeTask({
        prompt: "Fire and forget task",
        runtimeInput: {},
        runtimeSessionKey: "orch:faf:1",
      });

      // Should return quickly with Running status (adapter didn't auto-complete)
      expect(result.runtimeRunRef).toBeTruthy();
      expect(result.runtimeSessionKey).toBe("orch:faf:1");
      expect(result.attempts).toBe(1);
      expect(result.history.messages).toEqual([]);
    });
  });

  // -- getSessionStatus ------------------------------------------------------

  describe("getSessionStatus", () => {
    it("returns exists=false for unknown session", async () => {
      const { orchestrator } = createTestOrchestrator();

      const status = await orchestrator.getSessionStatus("unknown:session");

      expect(status.runtimeSessionKey).toBe("unknown:session");
      expect(status.exists).toBe(false);
      expect(status.pendingApprovals).toEqual([]);
    });

    it("returns status for existing session with completed run", async () => {
      const { adapter, orchestrator } = createTestOrchestrator(
        { autoComplete: true, completionDelay: 0 },
      );

      // Create a session via the adapter
      await adapter.createRun({
        prompt: "test",
        runtimeInput: {},
        runtimeSessionKey: "status:1",
      });

      const status = await orchestrator.getSessionStatus("status:1");

      expect(status.runtimeSessionKey).toBe("status:1");
      expect(status.exists).toBe(true);
      expect(status.pendingApprovals).toEqual([]);
    });

    it("returns pending approvals for session with approval request", async () => {
      const { adapter, orchestrator } = createTestOrchestrator(
        { requireApproval: true },
      );

      await adapter.createRun({
        prompt: "approval test",
        runtimeInput: {},
        runtimeSessionKey: "status:2",
      });

      const status = await orchestrator.getSessionStatus("status:2");

      expect(status.exists).toBe(true);
      expect(status.pendingApprovals.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// createOrchestrator factory
// ---------------------------------------------------------------------------

describe("createOrchestrator", () => {
  it("returns an OpenClawOrchestrator instance", () => {
    const adapter = createStatefulMockAdapter();
    const orchestrator = createOrchestrator({ adapter });

    expect(orchestrator).toBeInstanceOf(OpenClawOrchestrator);
    expect(orchestrator.executeTask).toBeTypeOf("function");
    expect(orchestrator.getSessionStatus).toBeTypeOf("function");
  });
});
