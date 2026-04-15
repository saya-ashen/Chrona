/**
 * End-to-end integration test for the complete task lifecycle.
 *
 * Tests the full lifecycle using the stateful mock adapter:
 *   1. Create session (implicit via createRun)
 *   2. Start run → agent processes prompt
 *   3. Monitor run status (Running → Completed)
 *   4. Read chat history
 *   5. Send follow-up message → new run
 *   6. Approval workflow (request → approve → completed)
 *   7. Full conversation thread across multiple runs
 *
 * These tests exercise the OpenClawAdapter contract end-to-end without
 * requiring a database or live runtime. They validate the integration
 * between adapter methods and state transitions.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createStatefulMockAdapter,
  type StatefulMockAdapter,
} from "@/modules/runtime/openclaw/mock-adapter";
import type { OpenClawAdapter } from "@/modules/runtime/openclaw/adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate the session key format used by the real system */
function taskSessionKey(taskId: string, variant = "default") {
  return `agent-dashboard:openclaw:task:${taskId}:${variant}`;
}

// ---------------------------------------------------------------------------
// Complete task lifecycle
// ---------------------------------------------------------------------------

describe("Task Lifecycle Integration", () => {
  describe("happy path: create → run → complete → read history", () => {
    let adapter: StatefulMockAdapter;
    const taskId = "task_lifecycle_001";
    const sessionKey = taskSessionKey(taskId);

    it("Step 1: createRun creates a session and starts a run", async () => {
      adapter = createStatefulMockAdapter({
        simulatedResponse: "I have completed the analysis of your codebase.",
      });

      const result = await adapter.createRun({
        prompt: "Analyze the codebase and summarize findings",
        runtimeInput: { model: "claude-sonnet-4-20250514", maxTokens: 4096 },
        runtimeSessionKey: sessionKey,
      });

      expect(result.runStarted).toBe(true);
      expect(result.runtimeRunRef).toBeTruthy();
      expect(result.runtimeSessionRef).toBeTruthy();
      expect(result.runtimeSessionKey).toBe(sessionKey);
    });

    it("Step 2: getRunSnapshot shows Completed status", async () => {
      const session = adapter._internals.getSession(sessionKey);
      const runRef = session!.runs[0].runId;

      const snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runRef,
        runtimeSessionKey: sessionKey,
      });

      expect(snapshot.status).toBe("Completed");
      expect(snapshot.lastMessage).toBe(
        "I have completed the analysis of your codebase.",
      );
    });

    it("Step 3: readHistory returns user prompt and agent response", async () => {
      const history = await adapter.readHistory({
        runtimeSessionKey: sessionKey,
      });

      expect(history.messages).toHaveLength(2);

      const userMsg = history.messages[0] as Record<string, unknown>;
      const assistantMsg = history.messages[1] as Record<string, unknown>;

      expect(userMsg.role).toBe("user");
      expect(assistantMsg.role).toBe("assistant");

      const userContent = userMsg.content as Array<{ text: string }>;
      expect(userContent[0].text).toBe(
        "Analyze the codebase and summarize findings",
      );

      const assistantContent = assistantMsg.content as Array<{ text: string }>;
      expect(assistantContent[0].text).toBe(
        "I have completed the analysis of your codebase.",
      );
    });

    it("Step 4: send follow-up message creates a new run in the same session", async () => {
      const result = await adapter.sendOperatorMessage({
        runtimeSessionKey: sessionKey,
        message: "Now fix the issues you found",
      });

      expect(result.accepted).toBe(true);
      expect(result.runStarted).toBe(true);
      expect(result.runtimeRunRef).toBeTruthy();

      const session = adapter._internals.getSession(sessionKey);
      expect(session!.runs).toHaveLength(2);
    });

    it("Step 5: history accumulates across both runs", async () => {
      const history = await adapter.readHistory({
        runtimeSessionKey: sessionKey,
      });

      // 2 user messages + 2 assistant messages
      expect(history.messages).toHaveLength(4);

      const roles = history.messages.map(
        (m) => (m as Record<string, unknown>).role,
      );
      expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
    });
  });

  // ---------------------------------------------------------------------------

  describe("approval workflow lifecycle", () => {
    it("full approval flow: run → wait → approve → completed", async () => {
      const adapter = createStatefulMockAdapter({
        requireApproval: true,
        simulatedResponse: "Applied the patch successfully.",
      });
      const sessionKey = taskSessionKey("task_approval_001");

      // 1. Create run
      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Apply the migration patch",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      // 2. Run should be waiting for approval
      let snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
        runtimeSessionKey: sessionKey,
      });
      expect(snapshot.status).toBe("WaitingForApproval");

      // 3. List pending approvals
      const approvals = await adapter.listApprovals({
        runtimeSessionKey: sessionKey,
      });
      expect(approvals).toHaveLength(1);
      expect(approvals[0].command).toBe("mock_command");

      // 4. Decision not yet made
      const pendingDecision = await adapter.waitForApprovalDecision(
        approvals[0].approvalId,
      );
      expect(pendingDecision).toBeNull();

      // 5. Approve
      await adapter.resumeRun({
        runtimeSessionKey: sessionKey,
        approvalId: approvals[0].approvalId,
        decision: "approve",
      });

      // 6. Run should now be completed
      snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
        runtimeSessionKey: sessionKey,
      });
      expect(snapshot.status).toBe("Completed");
      expect(snapshot.lastMessage).toBe("Applied the patch successfully.");

      // 7. No more pending approvals
      const remainingApprovals = await adapter.listApprovals({
        runtimeSessionKey: sessionKey,
      });
      expect(remainingApprovals).toHaveLength(0);
    });

    it("rejection flow: run → wait → reject → failed", async () => {
      const adapter = createStatefulMockAdapter({ requireApproval: true });
      const sessionKey = taskSessionKey("task_reject_001");

      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Delete all logs",
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
  });

  // ---------------------------------------------------------------------------

  describe("manual run advancement (non-auto-complete)", () => {
    it("simulates a long-running agent that completes after external events", async () => {
      const adapter = createStatefulMockAdapter({
        autoComplete: false,
      });
      const sessionKey = taskSessionKey("task_manual_001");

      // Start run
      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Run a long build process",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      // Should be running
      let snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("Running");

      // Simulate the agent finishing
      adapter._internals.advanceRun(runtimeRunRef!, "Completed");

      snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("Completed");
    });

    it("simulates WaitingForInput → resumed with input → Completed", async () => {
      const adapter = createStatefulMockAdapter({
        autoComplete: false,
      });
      const sessionKey = taskSessionKey("task_input_001");

      const { runtimeRunRef } = await adapter.createRun({
        prompt: "Setup project configuration",
        runtimeInput: {},
        runtimeSessionKey: sessionKey,
      });

      // Agent asks for input
      adapter._internals.advanceRun(runtimeRunRef!, "WaitingForInput");

      let snapshot = await adapter.getRunSnapshot({
        runtimeRunRef: runtimeRunRef!,
      });
      expect(snapshot.status).toBe("WaitingForInput");

      // User provides input which creates a new run
      const resumeResult = await adapter.resumeRun({
        runtimeSessionKey: sessionKey,
        inputText: "Use TypeScript with strict mode",
      });

      expect(resumeResult).toMatchObject({ accepted: true, runStarted: true });

      // New run should be created (also Running since autoComplete=false)
      const session = adapter._internals.getSession(sessionKey);
      expect(session!.runs).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------

  describe("delayed completion simulation", () => {
    it("run transitions from Running to Completed after delay", async () => {
      vi.useFakeTimers();

      try {
        const adapter = createStatefulMockAdapter({
          completionDelay: 2000,
          autoComplete: true,
          simulatedResponse: "Build completed successfully.",
        });
        const sessionKey = taskSessionKey("task_delayed_001");

        const { runtimeRunRef } = await adapter.createRun({
          prompt: "Build the project",
          runtimeInput: {},
          runtimeSessionKey: sessionKey,
        });

        // Immediately → Running
        let snapshot = await adapter.getRunSnapshot({
          runtimeRunRef: runtimeRunRef!,
        });
        expect(snapshot.status).toBe("Running");

        // After 1 second → still Running
        vi.advanceTimersByTime(1000);
        snapshot = await adapter.getRunSnapshot({
          runtimeRunRef: runtimeRunRef!,
        });
        expect(snapshot.status).toBe("Running");

        // After 2 seconds total → Completed
        vi.advanceTimersByTime(1000);
        snapshot = await adapter.getRunSnapshot({
          runtimeRunRef: runtimeRunRef!,
        });
        expect(snapshot.status).toBe("Completed");
        expect(snapshot.lastMessage).toBe("Build completed successfully.");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---------------------------------------------------------------------------

  describe("multi-session isolation", () => {
    it("sessions are fully isolated from each other", async () => {
      const adapter = createStatefulMockAdapter({
        simulatedResponse: "Done",
      });
      const session1 = taskSessionKey("task_iso_001");
      const session2 = taskSessionKey("task_iso_002");

      await adapter.createRun({
        prompt: "Task A",
        runtimeInput: {},
        runtimeSessionKey: session1,
      });

      await adapter.createRun({
        prompt: "Task B",
        runtimeInput: {},
        runtimeSessionKey: session2,
      });

      const history1 = await adapter.readHistory({ runtimeSessionKey: session1 });
      const history2 = await adapter.readHistory({ runtimeSessionKey: session2 });

      // Each session has its own messages
      expect(history1.messages).toHaveLength(2); // user + assistant
      expect(history2.messages).toHaveLength(2);

      const msg1 = history1.messages[0] as Record<string, unknown>;
      const msg2 = history2.messages[0] as Record<string, unknown>;
      const text1 = (msg1.content as Array<{ text: string }>)[0].text;
      const text2 = (msg2.content as Array<{ text: string }>)[0].text;
      expect(text1).toBe("Task A");
      expect(text2).toBe("Task B");
    });
  });

  // ---------------------------------------------------------------------------

  describe("complex conversation thread", () => {
    it("simulates a realistic multi-turn agent interaction", async () => {
      const adapter = createStatefulMockAdapter();
      const sessionKey = taskSessionKey("task_conversation_001");

      // Turn 1: User asks
      const run1 = await adapter.createRun({
        prompt: "List all TODO items in the codebase",
        runtimeInput: { model: "claude-sonnet-4-20250514" },
        runtimeSessionKey: sessionKey,
      });
      expect(run1.runStarted).toBe(true);

      // Turn 2: Follow-up
      const run2 = await adapter.sendOperatorMessage({
        runtimeSessionKey: sessionKey,
        message: "Group them by priority",
      });
      expect(run2.accepted).toBe(true);

      // Turn 3: Another follow-up
      const run3 = await adapter.sendOperatorMessage({
        runtimeSessionKey: sessionKey,
        message: "Create Jira tickets for the high-priority ones",
      });
      expect(run3.accepted).toBe(true);

      // Verify full conversation
      const history = await adapter.readHistory({
        runtimeSessionKey: sessionKey,
      });

      // 3 user messages + 3 assistant messages
      expect(history.messages).toHaveLength(6);

      // All messages should have proper structure
      for (const msg of history.messages) {
        const m = msg as Record<string, unknown>;
        expect(m.role).toBeDefined();
        expect(m.content).toBeDefined();
        expect(m.timestamp).toBeTypeOf("number");

        const meta = m.__openclaw as Record<string, unknown>;
        expect(meta.id).toMatch(/^msg_/);
      }

      // Verify 3 runs in session
      const session = adapter._internals.getSession(sessionKey);
      expect(session!.runs).toHaveLength(3);

      // All runs should be completed (autoComplete=true, delay=0)
      for (const run of session!.runs) {
        expect(run.status).toBe("Completed");
      }
    });
  });
});
