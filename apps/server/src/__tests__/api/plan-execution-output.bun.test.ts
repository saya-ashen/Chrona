/**
 * Integration tests for executePlanNode: verifies that the runtime output is
 * persisted as conversationEntry records after createRun() succeeds.
 *
 * This test reproduces the root cause: the OpenClaw runtime client stores
 * output in an in-memory sessions Map, and if those conversation entries
 * are not persisted before the adapter instance is garbage-collected, the
 * output is lost.  We simulate a real adapter by storing messages in a
 * session-like structure and returning them through readHistory.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { db } from "@chrona/db";
import { MemoryScope, MemorySourceType, MemoryStatus, RunStatus } from "@chrona/db/generated/prisma/client";
import { resetTestDb, seedWorkspace, seedTask } from "../bun-test-helpers";
import { overrideRuntimeExecutionAdapter, executePlanNode } from "@chrona/engine";



// ---------------------------------------------------------------------------
// Smart mock adapter: stores messages in an in-memory Map and returns them
// via readHistory, exactly like the real OpenClaw bridge client does.
// ---------------------------------------------------------------------------
function createMockAdapter(outputContent: string) {
  const messages: Array<{ role: string; content: string }> = [];

  return {
    async createRun(input: { prompt: string; runtimeInput: Record<string, unknown>; runtimeSessionKey?: string }) {
      // Simulate what the real gateway does: store user prompt + AI response
      messages.push({ role: "user", content: input.prompt });
      messages.push({ role: "assistant", content: outputContent });

      return {
        runtimeRunRef: `mock-run-ref-${Date.now()}`,
        runtimeSessionKey: input.runtimeSessionKey ?? "mock-session-key",
        runtimeSessionRef: "mock:session:ref",
        runStarted: true,
      };
    },
    async readHistory(_input: { runtimeSessionKey: string }) {
      return { messages: [...messages] };
    },
    async sendOperatorMessage() {
      throw new Error("not used");
    },
    async getRunSnapshot() {
      throw new Error("not used");
    },
    async listApprovals() {
      return [];
    },
    async waitForApprovalDecision() {
      return null;
    },
    async resumeRun() {
      return { accepted: true };
    },
    async executeTask() {
      throw new Error("not used");
    },
    async getSessionStatus() {
      throw new Error("not used");
    },
  } as const;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function seedFullSetup(outputContent: string) {
  const { workspaceId } = await seedWorkspace("PlanExecTest");
  const { taskId } = await seedTask(workspaceId, {
    title: "Integration test – verify output persistence",
    status: "Ready",
  });

  // Create main session
  const session = await db.taskSession.create({
    data: {
      taskId,
      sessionKey: `agent:openclaw:task-${taskId}`,
      runtimeName: "openclaw",
      label: "Main session",
      status: "idle",
    },
  });

  // Build an accepted plan with one simple auto node
  const now = new Date().toISOString();
  const planContent = {
    type: "task_plan_graph_v1",
    status: "accepted",
    revision: 1,
    source: "ai",
    generatedBy: "test-fixture",
    prompt: "Test plan",
    summary: "Run a simple task and verify output is saved",
    changeSummary: null,
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "node-1",
        type: "step",
        title: "Echo step",
        objective: "Produce a hello-world message",
        description: null,
        status: "in_progress",
        phase: "execution",
        estimatedMinutes: 5,
        priority: "Medium",
        executionMode: "automatic",
        requiresHumanInput: false,
        requiresHumanApproval: false,
        autoRunnable: true,
        blockingReason: null,
        linkedTaskId: null,
        completionSummary: null,
        metadata: null,
      },
    ],
    edges: [],
  };

  const memory = await db.memory.create({
    data: {
      workspaceId,
      taskId,
      content: JSON.stringify(planContent),
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: 1,
    },
  });

  // Register mock adapter
  overrideRuntimeExecutionAdapter("openclaw", async () => createMockAdapter(outputContent) as any);

  return {
    workspaceId,
    taskId,
    planId: memory.id,
    sessionId: session.id,
    sessionKey: session.sessionKey,
    planGraph: { ...planContent, id: memory.id, taskId } as any,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("executePlanNode output persistence", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("persists assistant output as conversationEntry records in main_session execution", async () => {
    const outputContent = "Hello from the mock runtime! The task has been completed successfully.";
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup(outputContent);

    const result = await executePlanNode({
      taskId,
      planId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0],
      plan: planGraph as any,
      sessionDecision: { kind: "main_session", reason: "auto node" },
      trigger: "auto",
      runtimeName: "openclaw",
    });

    expect(result.status).toBe("done");

    // Verify conversationEntry records were created in the DB
    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
      orderBy: { sequence: "asc" },
    });

    expect(entries.length).toBe(2);

    // First entry: the user prompt (instructions)
    expect(entries[0].role).toBe("user");
    expect(entries[0].content).toContain("Echo step");
    expect(entries[0].content).toContain("Produce a hello-world message");

    // Second entry: the AI response (actual output)
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].content).toBe(outputContent);

    // Verify the run status was set to Completed (output was produced)
    const run = await db.run.findUniqueOrThrow({ where: { id: result.evidence!.runId! } });
    expect(run.status).toBe(RunStatus.Completed);
    expect(run.runtimeRunRef).not.toBeNull();
  });

  it("sets run status to Failed when the adapter produces no output", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup("");

    // Override with an adapter that returns empty messages
    overrideRuntimeExecutionAdapter("openclaw", async () => createMockAdapter("") as any);

    const result = await executePlanNode({
      taskId,
      planId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0],
      plan: planGraph as any,
      sessionDecision: { kind: "main_session", reason: "auto node" },
      trigger: "auto",
      runtimeName: "openclaw",
    });

    expect(result.status).toBe("done");

    // The user prompt (instructions) is saved, but the assistant message
    // has empty content and is filtered out — so only 1 entry.
    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].role).toBe("user");

    // Run should be marked as Failed because there's no assistant output
    const run = await db.run.findUniqueOrThrow({ where: { id: result.evidence!.runId! } });
    expect(run.status).toBe(RunStatus.Failed);
  });

  it("sets run status to Failed when the adapter refuses to start", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup("irrelevant");

    // Adapter that returns runStarted: false
    overrideRuntimeExecutionAdapter("openclaw", async () => ({
      async createRun() {
        return { runtimeRunRef: null, runtimeSessionKey: sessionKey, runStarted: false };
      },
      async readHistory() {
        return { messages: [] };
      },
      async sendOperatorMessage() { throw new Error("not used"); },
      async getRunSnapshot() { throw new Error("not used"); },
      async listApprovals() { return []; },
      async waitForApprovalDecision() { return null; },
      async resumeRun() { return { accepted: true }; },
      async executeTask() { throw new Error("not used"); },
      async getSessionStatus() { throw new Error("not used"); },
    }) as any);

    const result = await executePlanNode({
      taskId,
      planId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0],
      plan: planGraph as any,
      sessionDecision: { kind: "main_session", reason: "auto node" },
      trigger: "auto",
      runtimeName: "openclaw",
    });

    expect(result.status).toBe("failed");
    expect((result as { error: string }).error).toContain("refused to start");
  });

  it("handles multiple messages correctly (multi-turn simulation)", async () => {
    const { taskId, planId, sessionId, sessionKey, planGraph } = await seedFullSetup("initial");

    // Simulate a multi-turn conversation (e.g., tool calls)
    overrideRuntimeExecutionAdapter("openclaw", async () => {
      const messages: Array<{ role: string; content: string }> = [];

      return {
        async createRun(input: { prompt: string }) {
          messages.push({ role: "user", content: input.prompt });
          messages.push({ role: "assistant", content: "Thinking about this..." });
          messages.push({ role: "assistant", content: "Step 1 done." });
          messages.push({ role: "assistant", content: "Final answer: task complete." });
          return {
            runtimeRunRef: `mock-run-multi`,
            runtimeSessionKey: sessionKey,
            runStarted: true,
          };
        },
        async readHistory() {
          return { messages: [...messages] };
        },
        async sendOperatorMessage() { throw new Error("not used"); },
        async getRunSnapshot() { throw new Error("not used"); },
        async listApprovals() { return []; },
        async waitForApprovalDecision() { return null; },
        async resumeRun() { return { accepted: true }; },
        async executeTask() { throw new Error("not used"); },
        async getSessionStatus() { throw new Error("not used"); },
      } as any;
    });

    const result = await executePlanNode({
      taskId,
      planId,
      mainSession: { id: sessionId, taskId, sessionKey },
      node: planGraph.nodes[0],
      plan: planGraph as any,
      sessionDecision: { kind: "main_session", reason: "auto node" },
      trigger: "auto",
      runtimeName: "openclaw",
    });

    expect(result.status).toBe("done");

    const entries = await db.conversationEntry.findMany({
      where: { runId: result.evidence?.runId },
      orderBy: { sequence: "asc" },
    });

    // 1 user + 3 assistant messages
    expect(entries.length).toBe(4);
    expect(entries[0].role).toBe("user");
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].content).toBe("Thinking about this...");
    expect(entries[2].content).toBe("Step 1 done.");
    expect(entries[3].content).toBe("Final answer: task complete.");
  });
});
