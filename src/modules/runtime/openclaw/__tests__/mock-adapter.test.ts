import { describe, expect, it, vi } from "vitest";
import {
  createMockOpenClawAdapter,
  createStatefulMockAdapter,
  type StatefulMockAdapter,
} from "@/modules/runtime/openclaw/mock-adapter";

// ---------------------------------------------------------------------------
// Backward-compatible fixture mock
// ---------------------------------------------------------------------------

describe("createMockOpenClawAdapter (fixture-based)", () => {
  it("returns a valid adapter with default fixture", () => {
    const adapter = createMockOpenClawAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.createRun).toBeTypeOf("function");
    expect(adapter.getRunSnapshot).toBeTypeOf("function");
    expect(adapter.readHistory).toBeTypeOf("function");
    expect(adapter.sendOperatorMessage).toBeTypeOf("function");
    expect(adapter.listApprovals).toBeTypeOf("function");
  });

  it("createRun returns refs from the waiting-approval fixture by default", async () => {
    const adapter = createMockOpenClawAdapter();
    const result = await adapter.createRun({
      prompt: "test prompt",
      runtimeInput: {},
      runtimeSessionKey: "custom_key",
    });

    expect(result.runtimeRunRef).toBe("runtime_waiting_1");
    expect(result.runtimeSessionKey).toBe("custom_key");
    expect(result.runStarted).toBe(true);
  });

  it("loads the run-completed fixture when specified", async () => {
    const adapter = createMockOpenClawAdapter({ fixtureName: "run-completed" });
    const snapshot = await adapter.getRunSnapshot({
      runtimeRunRef: "runtime_completed_1",
    });

    expect(snapshot.status).toBe("Completed");
  });

  it("executeTask returns a result based on fixture", async () => {
    const adapter = createMockOpenClawAdapter({ fixtureName: "run-completed" });
    const result = await adapter.executeTask({
      prompt: "test prompt",
      runtimeInput: {},
      runtimeSessionKey: "et_key",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("Completed");
    expect(result.runtimeSessionKey).toBe("et_key");
    expect(result.attempts).toBe(1);
    expect(result.history).toBeDefined();
  });

  it("getSessionStatus returns session info", async () => {
    const adapter = createMockOpenClawAdapter();
    const status = await adapter.getSessionStatus("some_key");

    expect(status.runtimeSessionKey).toBe("some_key");
    expect(status.exists).toBe(true);
    expect(Array.isArray(status.pendingApprovals)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stateful mock adapter
// ---------------------------------------------------------------------------

describe("createStatefulMockAdapter", () => {
  function createAdapter(opts?: Parameters<typeof createStatefulMockAdapter>[0]) {
    return createStatefulMockAdapter(opts);
  }

  // -- Session & run creation ------------------------------------------------

  describe("createRun", () => {
    it("creates a session and returns valid refs", async () => {
      const adapter = createAdapter();
      const result = await adapter.createRun({
        prompt: "Hello agent",
        runtimeInput: {},
        runtimeSessionKey: "test:session:1",
      });

      expect(result.runtimeRunRef).toMatch(/^run_/);
      expect(result.runtimeSessionRef).toMatch(/^session_/);
      expect(result.runtimeSessionKey).toBe("test:session:1");
      expect(result.runStarted).toBe(true);
    });

    it("generates a session key when none is provided", async () => {
      const adapter = createAdapter();
      const result = await adapter.createRun({
        prompt: "Hello",
        runtimeInput: {},
      });

      expect(result.runtimeSessionKey).toMatch(/^session_/);
      expect(result.runtimeRunRef).toBeTruthy();
    });

    it("reuses existing session on subsequent createRun calls with same key", async () => {
      const adapter = createAdapter();
      const sessionKey = "test:reuse";

      const r1 = await adapter.createRun({
        prompt: "First",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });
      const r2 = await adapter.createRun({
        prompt: "Second",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      // Same session ref
      expect(r1.runtimeSessionRef).toBe(r2.runtimeSessionRef);
      // Different run refs
      expect(r1.runtimeRunRef).not.toBe(r2.runtimeRunRef);
    });
  });

  // -- Run snapshot / lifecycle -----------------------------------------------

  describe("getRunSnapshot", () => {
    it("returns Completed status for auto-complete runs (delay=0)", async () => {
      const adapter = createAdapter({ autoComplete: true, completionDelay: 0 });
      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Quick task",
        runtimeInput: {},
        runtimeSessionKey: "snap:1",
      });

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
        runtimeSessionKey: "snap:1",
      });

      expect(snapshot.status).toBe("Completed");
      expect(snapshot.runtimeRunRef).toBe(runtimeRunRef);
      expect(snapshot.lastMessage).toBeTruthy();
    });

    it("returns Running status when autoComplete is false", async () => {
      const adapter = createAdapter({ autoComplete: false });
      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Long task",
        runtimeInput: {},
        runtimeSessionKey: "snap:2",
      });

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
        runtimeSessionKey: "snap:2",
      });

      expect(snapshot.status).toBe("Running");
    });

    it("returns Failed for a non-existent run", async () => {
      const adapter = createAdapter();
      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: "nonexistent_run",
      });

      expect(snapshot.status).toBe("Failed");
      expect(snapshot.lastMessage).toBe("Run not found");
    });

    it("returns custom simulatedResponse as lastMessage on completion", async () => {
      const adapter = createAdapter({
        simulatedResponse: "Custom result content",
      });
      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Do something",
        runtimeInput: {},
        runtimeSessionKey: "snap:3",
      });

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });

      expect(snapshot.lastMessage).toBe("Custom result content");
    });

    it("returns WaitingForApproval when requireApproval is set", async () => {
      const adapter = createAdapter({ requireApproval: true });
      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Needs approval",
        runtimeInput: {},
        runtimeSessionKey: "snap:4",
      });

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });

      expect(snapshot.status).toBe("WaitingForApproval");
      expect(snapshot.lastMessage).toBe("Waiting for approval to continue.");
    });
  });

  // -- sendOperatorMessage ---------------------------------------------------

  describe("sendOperatorMessage", () => {
    it("adds a new message and run to an existing session", async () => {
      const adapter = createAdapter();
      const sessionKey = "msg:1";

      // Create initial session+run
      await adapter.createRun({
        prompt: "Hello",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      const result = await adapter.sendOperatorMessage({
        runtimeSessionKey: sessionKey,
        message: "Follow-up message",
      });

      expect(result.accepted).toBe(true);
      expect(result.runtimeRunRef).toMatch(/^run_/);
      expect(result.runStarted).toBe(true);

      // Verify session now has two runs
      const session = adapter._internals.getSession(sessionKey);
      expect(session?.runs).toHaveLength(2);
    });

    it("returns accepted=false for a non-existent session", async () => {
      const adapter = createAdapter();
      const result = await adapter.sendOperatorMessage({
        runtimeSessionKey: "nonexistent",
        message: "Hello?",
      });

      expect(result.accepted).toBe(false);
    });
  });

  // -- readHistory -----------------------------------------------------------

  describe("readHistory", () => {
    it("returns accumulated messages from all runs in a session", async () => {
      const adapter = createAdapter({
        simulatedResponse: "Agent reply",
      });
      const sessionKey = "hist:1";

      await adapter.createRun({
        prompt: "First question",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      await adapter.sendOperatorMessage({
        runtimeSessionKey: sessionKey,
        message: "Second question",
      });

      const history = await adapter.readHistory({
        runtimeSessionKey: sessionKey,
      });

      // Two user messages + two assistant messages = 4 total
      expect(history.messages).toHaveLength(4);

      const roles = history.messages.map(
        (m) => (m as Record<string, unknown>).role,
      );
      expect(roles).toEqual(["user", "assistant", "user", "assistant"]);

      // Verify user message content
      const firstMsg = history.messages[0] as Record<string, unknown>;
      const content = firstMsg.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toBe("First question");
    });

    it("returns empty messages for unknown session", async () => {
      const adapter = createAdapter();
      const history = await adapter.readHistory({
        runtimeSessionKey: "unknown",
      });

      expect(history.messages).toEqual([]);
    });
  });

  // -- Approval workflow -----------------------------------------------------

  describe("approval workflow", () => {
    it("creates pending approval when requireApproval is set", async () => {
      const adapter = createAdapter({ requireApproval: true });
      const sessionKey = "approve:1";

      await adapter.createRun({
        prompt: "Dangerous operation",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      const approvals = await adapter.listApprovals({
        runtimeSessionKey: sessionKey,
      });

      expect(approvals).toHaveLength(1);
      expect(approvals[0].approvalId).toMatch(/^approval_/);
      expect(approvals[0].sessionKey).toBe(sessionKey);
      expect(approvals[0].command).toBe("mock_command");
    });

    it("waitForApprovalDecision returns null before decision", async () => {
      const adapter = createAdapter({ requireApproval: true });

      await adapter.createRun({
        prompt: "Task",
        runtimeInput: {},
        runtimeSessionKey: "approve:2",
      });

      const approvals = await adapter.listApprovals({
        runtimeSessionKey: "approve:2",
      });
      const decision = await adapter.waitForApprovalDecision(
        approvals[0].approvalId,
      );

      expect(decision).toBeNull();
    });

    it("resolving approval transitions run to Completed", async () => {
      const adapter = createAdapter({ requireApproval: true });
      const sessionKey = "approve:3";

      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Needs approval",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      // Verify waiting
      let snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("WaitingForApproval");

      // Approve via resumeRun
      const approvals = await adapter.listApprovals({
        runtimeSessionKey: sessionKey,
      });
      await adapter.resumeRun({
        runtimeSessionKey: sessionKey,
        approvalId: approvals[0].approvalId,
        decision: "approve",
      });

      // Run should now be completed
      snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("Completed");
    });

    it("denying approval transitions run to Failed", async () => {
      const adapter = createAdapter({ requireApproval: true });
      const sessionKey = "approve:4";

      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Risky action",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      const approvals = await adapter.listApprovals({
        runtimeSessionKey: sessionKey,
      });
      await adapter.resumeRun({
        runtimeSessionKey: sessionKey,
        approvalId: approvals[0].approvalId,
        decision: "reject",
      });

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("Failed");
      expect(snapshot.lastMessage).toBe("Approval denied.");
    });

    it("listApprovals only returns undecided approvals", async () => {
      const adapter = createAdapter({ requireApproval: true });
      const sessionKey = "approve:5";

      // Create two runs (two approvals)
      await adapter.createRun({
        prompt: "First",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      // First approval gets decided
      let approvals = await adapter.listApprovals({
        runtimeSessionKey: sessionKey,
      });
      expect(approvals).toHaveLength(1);

      adapter._internals.setApprovalDecision(
        approvals[0].approvalId,
        "allow-once",
      );

      // After deciding, no pending approvals remain
      approvals = await adapter.listApprovals({
        runtimeSessionKey: sessionKey,
      });
      expect(approvals).toHaveLength(0);
    });

    it("addApproval via internals adds external approvals", async () => {
      const adapter = createAdapter();
      const sessionKey = "approve:external";

      await adapter.createRun({
        prompt: "Task",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      adapter._internals.addApproval(sessionKey, {
        approvalId: "ext_approval_1",
        command: "rm -rf /",
        ask: "Are you sure?",
        createdAtMs: Date.now(),
      });

      const approvals = await adapter.listApprovals({
        runtimeSessionKey: sessionKey,
      });
      expect(approvals).toHaveLength(1);
      expect(approvals[0].approvalId).toBe("ext_approval_1");
    });
  });

  // -- Multiple runs in same session -----------------------------------------

  describe("multiple runs per session", () => {
    it("tracks separate run states within one session", async () => {
      const adapter = createAdapter({ autoComplete: false });
      const sessionKey = "multi:1";

      const r1 = await adapter.createRun({
        prompt: "Run 1",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });
      const r2 = await adapter.createRun({
        prompt: "Run 2",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      // Both should be Running
      const s1 = await adapter.getRunSnapshot({ runtimeRunRef: r1.runtimeRunRef! });
      const s2 = await adapter.getRunSnapshot({ runtimeRunRef: r2.runtimeRunRef! });
      expect(s1.status).toBe("Running");
      expect(s2.status).toBe("Running");

      // Complete just the first one
      adapter._internals.advanceRun(r1.runtimeRunRef!, "Completed");

      const s1b = await adapter.getRunSnapshot({ runtimeRunRef: r1.runtimeRunRef! });
      const s2b = await adapter.getRunSnapshot({ runtimeRunRef: r2.runtimeRunRef! });
      expect(s1b.status).toBe("Completed");
      expect(s2b.status).toBe("Running");
    });

    it("accumulates messages across multiple runs", async () => {
      const adapter = createAdapter();
      const sessionKey = "multi:2";

      await adapter.createRun({
        prompt: "First task",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });
      await adapter.createRun({
        prompt: "Second task",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      const history = await adapter.readHistory({
        runtimeSessionKey: sessionKey,
      });

      // 2 user messages + 2 assistant messages
      expect(history.messages).toHaveLength(4);
    });
  });

  // -- advanceRun (internals) ------------------------------------------------

  describe("advanceRun", () => {
    it("manually transitions a run from Running to Completed", async () => {
      const adapter = createAdapter({ autoComplete: false });
      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Manual task",
        runtimeInput: {},
        runtimeSessionKey: "advance:1",
      });

      adapter._internals.advanceRun(runtimeRunRef!, "Completed");

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("Completed");
      expect(snapshot.lastMessage).toBeTruthy();
    });

    it("manually transitions a run to Failed", async () => {
      const adapter = createAdapter({ autoComplete: false });
      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Will fail",
        runtimeInput: {},
        runtimeSessionKey: "advance:2",
      });

      adapter._internals.advanceRun(runtimeRunRef!, "Failed");

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("Failed");
      expect(snapshot.lastMessage).toBe("Mock run failed.");
    });

    it("throws when advancing a non-existent run", () => {
      const adapter = createAdapter();
      expect(() => adapter._internals.advanceRun("bad_id", "Completed")).toThrow(
        "Run not found: bad_id",
      );
    });
  });

  // -- Delayed completion (timer-based) --------------------------------------

  describe("completionDelay", () => {
    it("transitions to Completed after delay", async () => {
      vi.useFakeTimers();

      try {
        const adapter = createAdapter({
          completionDelay: 500,
          autoComplete: true,
        });
        const { runtimeRunRef } = await adapter.createRun({
          prompt: "Delayed task",
          runtimeInput: {},
          runtimeSessionKey: "delay:1",
        });

        // Should still be Running immediately
        let snapshot = await adapter.getRunSnapshot({
          runtimeRunRef: runtimeRunRef!,
        });
        expect(snapshot.status).toBe("Running");

        // Advance time
        vi.advanceTimersByTime(500);

        snapshot = await adapter.getRunSnapshot({
          runtimeRunRef: runtimeRunRef!,
        });
        expect(snapshot.status).toBe("Completed");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -- failRate --------------------------------------------------------------

  describe("failRate", () => {
    it("all runs fail when failRate=1", async () => {
      const adapter = createAdapter({ failRate: 1 });
      const sessionKey = "fail:1";

      const { runtimeRunRef } = await adapter.createRun({
        prompt: "This will fail",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("Failed");
    });

    it("all runs complete when failRate=0", async () => {
      const adapter = createAdapter({ failRate: 0 });
      const sessionKey = "fail:2";

      const { runtimeRunRef } = await adapter.createRun({
        prompt: "This will succeed",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("Completed");
    });
  });

  // -- resumeRun with inputText creates follow-up run -------------------------

  describe("resumeRun", () => {
    it("creates a new run when inputText is provided", async () => {
      const adapter = createAdapter();
      const sessionKey = "resume:1";

      await adapter.createRun({
        prompt: "Initial",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      const result = await adapter.resumeRun({
        runtimeSessionKey: sessionKey,
        inputText: "Additional input",
      });

      expect(result).toMatchObject({
        accepted: true,
        runStarted: true,
      });
      expect(
        "runtimeRunRef" in result ? result.runtimeRunRef : undefined,
      ).toMatch(/^run_/);

      // Session should now have 2 runs
      const session = adapter._internals.getSession(sessionKey);
      expect(session?.runs).toHaveLength(2);
    });

    it("returns accepted=false for unknown session", async () => {
      const adapter = createAdapter();
      const result = await adapter.resumeRun({
        runtimeSessionKey: "unknown",
      });

      expect(result).toEqual({ accepted: false });
    });
  });

  // -- executeTask (stateful mock) -------------------------------------------

  describe("executeTask", () => {
    it("creates a run and returns result with history", async () => {
      const adapter = createAdapter({ autoComplete: true, completionDelay: 0 });
      const result = await adapter.executeTask({
        prompt: "Execute this task",
        runtimeInput: {},
        runtimeSessionKey: "exec:1",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("Completed");
      expect(result.runtimeRunRef).toMatch(/^run_/);
      expect(result.runtimeSessionKey).toBe("exec:1");
      expect(result.attempts).toBe(1);
      expect(result.history.messages.length).toBeGreaterThan(0);
    });

    it("handles approval auto-approve", async () => {
      const adapter = createAdapter({ requireApproval: true });
      const result = await adapter.executeTask({
        prompt: "Needs approval",
        runtimeInput: {},
        runtimeSessionKey: "exec:2",
        approvalStrategy: "auto-approve",
      });

      expect(result.status).toBe("Completed");
      expect(result.runtimeRunRef).toBeTruthy();
    });

    it("handles approval auto-reject", async () => {
      const adapter = createAdapter({ requireApproval: true });
      const result = await adapter.executeTask({
        prompt: "Needs approval",
        runtimeInput: {},
        runtimeSessionKey: "exec:3",
        approvalStrategy: "auto-reject",
      });

      expect(result.status).toBe("Failed");
    });

    it("skips approval handling when strategy is skip", async () => {
      const adapter = createAdapter({ requireApproval: true });
      const result = await adapter.executeTask({
        prompt: "Needs approval",
        runtimeInput: {},
        runtimeSessionKey: "exec:4",
        approvalStrategy: "skip",
      });

      expect(result.status).toBe("WaitingForApproval");
      expect(result.success).toBe(false);
    });

    it("generates session key when none provided", async () => {
      const adapter = createAdapter();
      const result = await adapter.executeTask({
        prompt: "No key",
        runtimeInput: {},
      });

      expect(result.runtimeSessionKey).toMatch(/^session_/);
      expect(result.success).toBe(true);
    });

    it("calls onProgress callback", async () => {
      const progressEvents: unknown[] = [];
      const adapter = createAdapter();
      await adapter.executeTask({
        prompt: "Progress test",
        runtimeInput: {},
        runtimeSessionKey: "exec:5",
        onProgress: (event) => progressEvents.push(event),
      });

      expect(progressEvents.length).toBeGreaterThan(0);
    });

    it("returns failure info when run fails", async () => {
      const adapter = createAdapter({ failRate: 1 });
      const result = await adapter.executeTask({
        prompt: "Will fail",
        runtimeInput: {},
        runtimeSessionKey: "exec:6",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("Failed");
      expect(result.error).toBeTruthy();
    });
  });

  // -- getSessionStatus (stateful mock) --------------------------------------

  describe("getSessionStatus", () => {
    it("returns exists=false for unknown session", async () => {
      const adapter = createAdapter();
      const status = await adapter.getSessionStatus("unknown");

      expect(status.runtimeSessionKey).toBe("unknown");
      expect(status.exists).toBe(false);
      expect(status.pendingApprovals).toEqual([]);
    });

    it("returns session info for existing session", async () => {
      const adapter = createAdapter({ autoComplete: true, completionDelay: 0 });
      await adapter.createRun({
        prompt: "Test",
        runtimeInput: {},
        runtimeSessionKey: "status:1",
      });

      const status = await adapter.getSessionStatus("status:1");

      expect(status.exists).toBe(true);
      expect(status.runtimeSessionKey).toBe("status:1");
      expect(status.lastMessage).toBeTruthy();
    });

    it("returns active run info for running session", async () => {
      const adapter = createAdapter({ autoComplete: false });
      await adapter.createRun({
        prompt: "Running task",
        runtimeInput: {},
        runtimeSessionKey: "status:2",
      });

      const status = await adapter.getSessionStatus("status:2");

      expect(status.exists).toBe(true);
      expect(status.activeRunRef).toMatch(/^run_/);
      expect(status.activeRunStatus).toBe("Running");
    });

    it("returns pending approvals", async () => {
      const adapter = createAdapter({ requireApproval: true });
      await adapter.createRun({
        prompt: "Approval task",
        runtimeInput: {},
        runtimeSessionKey: "status:3",
      });

      const status = await adapter.getSessionStatus("status:3");

      expect(status.exists).toBe(true);
      expect(status.pendingApprovals.length).toBe(1);
      expect(status.activeRunStatus).toBe("WaitingForApproval");
    });
  });
});
