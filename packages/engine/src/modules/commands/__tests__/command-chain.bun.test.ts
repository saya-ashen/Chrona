import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MemoryStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { acceptTaskResult } from "@/modules/commands/accept-task-result";
import { createFollowUpTask } from "@/modules/commands/create-follow-up-task";
import { createTask } from "@/modules/commands/create-task";
import { invalidateMemory } from "@/modules/commands/invalidate-memory";
import { markTaskDone } from "@/modules/commands/mark-task-done";
import { reopenTask } from "@/modules/commands/reopen-task";
import { resolveApproval } from "@/modules/commands/resolve-approval";
import { sendOperatorMessage } from "@/modules/commands/send-operator-message";
import { startRun } from "@/modules/commands/start-run";
import { updateTask } from "@/modules/commands/update-task";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("startRun", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("creates the local run before calling the adapter", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Commands",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Start a run",
        runtimeModel: "gpt-5.4",
        prompt: "Stored prompt",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    let createRunCalls = 0;
    const adapter = {
      async createRun(input: {
        prompt: string;
        runtimeInput: Record<string, unknown>;
        runtimeSessionKey?: string;
      }) {
        createRunCalls += 1;
        expect(input.prompt).toBe("Override prompt");
        expect(input.runtimeInput).toEqual({
          approvalPolicy: "never",
          model: "gpt-5.4",
          prompt: "Override prompt",
          sessionStrategy: "per_subtask",
          temperature: 0.2,
          toolMode: "workspace-write",
        });
        expect(input.runtimeSessionKey).toBe(
          `chrona:openclaw:task:${task.id}:default`,
        );

        const pendingRun = await db.run.findFirstOrThrow({
          where: { taskId: task.id },
          orderBy: { createdAt: "desc" },
        });

        expect(pendingRun.status).toBe("Pending");

        return {
          runtimeRunRef: "runtime_123",
          runtimeSessionKey: "agent:main:dashboard:runtime_123",
          runStarted: true,
        };
      },
      async sendOperatorMessage() {
        throw new Error("not used in startRun test");
      },
      async getRunSnapshot() {
        throw new Error("not used in startRun test");
      },
      async readHistory() {
        throw new Error("not used in startRun test");
      },
      async listApprovals() {
        return [];
      },
      async waitForApprovalDecision() {
        return null;
      },
      async resumeRun() {
        throw new Error("not used in startRun test");
      },
    };

    const result = await startRun({
      taskId: task.id,
      prompt: "Override prompt",
      adapter,
    });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { runs: { orderBy: { createdAt: "desc" } }, sessions: true },
    });

    expect(result.runtimeRunRef).toBe("runtime_123");
    expect(createRunCalls).toBe(1);
    expect(storedTask.defaultSessionId).toBeTruthy();
    expect(storedTask.latestRunId).toBe(result.runId);
    expect(storedTask.status).toBe("Running");
    expect(storedTask.prompt).toBe("Stored prompt");
    expect(storedTask.runtimeInput).toEqual({
      approvalPolicy: "never",
      model: "gpt-5.4",
      prompt: "Stored prompt",
      sessionStrategy: "per_subtask",
      temperature: 0.2,
      toolMode: "workspace-write",
    });
    expect(storedTask.runs).toHaveLength(1);
    expect(storedTask.runs[0]?.runtimeName).toBe("openclaw");
    expect(storedTask.runs[0]?.runtimeConfigSnapshot).toEqual({
      approvalPolicy: "never",
      model: "gpt-5.4",
      prompt: "Override prompt",
      sessionStrategy: "per_subtask",
      temperature: 0.2,
      toolMode: "workspace-write",
    });
    expect(storedTask.runs[0]?.runtimeConfigVersion).toBe("openclaw-legacy-v1");
    expect(storedTask.runs[0]?.runtimeRunRef).toBe("runtime_123");
    expect(storedTask.runs[0]?.taskSessionId).toBe(storedTask.defaultSessionId);
    expect(storedTask.runs[0]?.runtimeSessionRef).toBe("agent:main:dashboard:runtime_123");
    expect(storedTask.sessions).toHaveLength(1);
    expect(storedTask.sessions[0]?.sessionKey).toBe(
      `chrona:openclaw:task:${task.id}:default`,
    );
    expect(storedTask.sessions[0]?.status).toBe("running");
  });

  it("uses the stored task prompt when no override prompt is provided", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Stored Runnable Config",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Run from saved config",
        runtimeModel: "gpt-5.4",
        prompt: "Use the saved prompt",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const adapter = {
      async createRun(input: {
        prompt: string;
        runtimeInput: Record<string, unknown>;
        runtimeSessionKey?: string;
      }) {
        expect(input.prompt).toBe("Use the saved prompt");
        expect(input.runtimeInput).toEqual({
          approvalPolicy: "never",
          model: "gpt-5.4",
          prompt: "Use the saved prompt",
          sessionStrategy: "per_subtask",
          temperature: 0.2,
          toolMode: "workspace-write",
        });
        expect(input.runtimeSessionKey).toBe(
          `chrona:openclaw:task:${task.id}:default`,
        );

        return {
          runtimeRunRef: "runtime_saved",
          runtimeSessionKey: "agent:main:dashboard:runtime_saved",
          runStarted: true,
        };
      },
      async sendOperatorMessage() {
        throw new Error("not used in startRun test");
      },
      async getRunSnapshot() {
        throw new Error("not used in startRun test");
      },
      async readHistory() {
        throw new Error("not used in startRun test");
      },
      async listApprovals() {
        return [];
      },
      async waitForApprovalDecision() {
        return null;
      },
      async resumeRun() {
        throw new Error("not used in startRun test");
      },
    };

    const result = await startRun({
      taskId: task.id,
      adapter,
    });

    expect(result.runtimeRunRef).toBe("runtime_saved");
  });

  it("reuses startRun for a second adapter with different required fields", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Research Runtime",
        status: "Active",
        defaultRuntime: "research",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Research a scheduling issue",
        runtimeAdapterKey: "research",
        runtimeInput: {
          prompt: "Investigate why schedule tasks drift",
        },
        runtimeInputVersion: "research-v1",
        prompt: "Investigate why schedule tasks drift",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const adapter = {
      async createRun(input: {
        prompt: string;
        runtimeInput: Record<string, unknown>;
        runtimeSessionKey?: string;
      }) {
        expect(input.prompt).toBe("Investigate why schedule tasks drift");
        expect(input.runtimeInput).toEqual({
          prompt: "Investigate why schedule tasks drift",
          depth: "standard",
          citationStyle: "bullet-links",
          webSearch: true,
        });
        expect(input.runtimeSessionKey).toBe(
          `chrona:research:task:${task.id}:default`,
        );

        return {
          runtimeRunRef: "runtime_research",
          runtimeSessionKey: "agent:main:dashboard:runtime_research",
          runStarted: true,
        };
      },
      async sendOperatorMessage() {
        throw new Error("not used in startRun test");
      },
      async getRunSnapshot() {
        throw new Error("not used in startRun test");
      },
      async readHistory() {
        throw new Error("not used in startRun test");
      },
      async listApprovals() {
        return [];
      },
      async waitForApprovalDecision() {
        return null;
      },
      async resumeRun() {
        throw new Error("not used in startRun test");
      },
    };

    const result = await startRun({
      taskId: task.id,
      adapter,
    });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { runs: { orderBy: { createdAt: "desc" } } },
    });

    expect(result.runtimeRunRef).toBe("runtime_research");
    expect(storedTask.runs[0]?.runtimeName).toBe("research");
    expect(storedTask.runs[0]?.runtimeConfigSnapshot).toEqual({
      prompt: "Investigate why schedule tasks drift",
      depth: "standard",
      citationStyle: "bullet-links",
      webSearch: true,
    });
    expect(storedTask.runs[0]?.runtimeConfigVersion).toBe("research-v1");
  });

  it("reuses the same default task session across multiple runs", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Reusable Session Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Run twice",
        runtimeModel: "gpt-5.4",
        prompt: "Use the same session",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const seenSessionKeys: string[] = [];
    const adapter = {
      async createRun(input: {
        prompt: string;
        runtimeInput: Record<string, unknown>;
        runtimeSessionKey?: string;
      }) {
        seenSessionKeys.push(input.runtimeSessionKey ?? "missing");

        return {
          runtimeRunRef: `runtime_${seenSessionKeys.length}`,
          runtimeSessionKey: input.runtimeSessionKey,
          runStarted: true,
        };
      },
      async sendOperatorMessage() {
        throw new Error("not used in startRun test");
      },
      async getRunSnapshot() {
        throw new Error("not used in startRun test");
      },
      async readHistory() {
        throw new Error("not used in startRun test");
      },
      async listApprovals() {
        return [];
      },
      async waitForApprovalDecision() {
        return null;
      },
      async resumeRun() {
        throw new Error("not used in startRun test");
      },
    };

    await startRun({ taskId: task.id, adapter });
    await startRun({ taskId: task.id, adapter });

    const sessions = await db.taskSession.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
    });

    expect(sessions).toHaveLength(1);
    expect(seenSessionKeys).toEqual([
      `chrona:openclaw:task:${task.id}:default`,
      `chrona:openclaw:task:${task.id}:default`,
    ]);
  });
});

describe("createTask", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a ready human-owned task and rebuilds projection", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Create Commands",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "  Bootstrap task creation  ",
      description: "  Add the first real create flow  ",
      priority: "High",
      runtimeModel: "  gpt-5.4  ",
      prompt: "  Add the first real create flow  ",
    });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: result.taskId },
      include: { projection: true, sessions: true },
    });
    const createdEvent = await db.event.findFirst({
      where: { taskId: result.taskId, eventType: "task.created" },
    });

    expect(result.workspaceId).toBe(workspace.id);
    expect(storedTask.title).toBe("Bootstrap task creation");
    expect(storedTask.description).toBe("Add the first real create flow");
    expect(storedTask.status).toBe("Ready");
    expect(storedTask.runtimeAdapterKey).toBe("openclaw");
    expect(storedTask.runtimeInput).toEqual({
      approvalPolicy: "never",
      model: "gpt-5.4",
      prompt: "Add the first real create flow",
      sessionStrategy: "per_subtask",
      temperature: 0.2,
      toolMode: "workspace-write",
    });
    expect(storedTask.runtimeInputVersion).toBe("openclaw-legacy-v1");
    expect(storedTask.runtimeModel).toBe("gpt-5.4");
    expect(storedTask.prompt).toBe("Add the first real create flow");
    expect(storedTask.runtimeConfig).toBeNull();
    expect(storedTask.ownerType).toBe("human");
    expect(storedTask.priority).toBe("High");
    expect(storedTask.defaultSessionId).toBeTruthy();
    expect(storedTask.sessions).toHaveLength(1);
    expect(storedTask.sessions[0]?.sessionKey).toBe(
      `chrona:openclaw:task:${storedTask.id}:default`,
    );
    expect(storedTask.projection).not.toBeNull();
    expect(createdEvent?.payload).toEqual(
      expect.objectContaining({
        title: "Bootstrap task creation",
        priority: "High",
        status: "Ready",
      }),
    );
  });

  it("rejects invalid adapter config values from the server command", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Invalid Config",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    await expect(
      createTask({
        workspaceId: workspace.id,
        title: "Invalid runtime config",
        runtimeModel: "gpt-5.4",
        prompt: "Run the invalid case",
        runtimeConfig: {
          approvalPolicy: "sometimes",
        },
      }),
    ).rejects.toThrow(/Approval policy must be one of/);
  });
});

describe("updateTask", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("preserves existing runtime input keys when updating the prompt", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Update Commands",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Keep adapter config",
        runtimeAdapterKey: "openclaw",
        runtimeInput: {
          model: "gpt-5.4",
          prompt: "Original prompt",
          temperature: 0.2,
          approvalPolicy: "never",
          toolMode: "workspace-write",
        },
        runtimeInputVersion: "openclaw-legacy-v1",
        runtimeModel: "gpt-5.4",
        prompt: "Original prompt",
        runtimeConfig: { temperature: 0.2 },
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    await updateTask({
      taskId: task.id,
      prompt: "Updated prompt",
    });

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });

    expect(storedTask.runtimeInput).toEqual({
      approvalPolicy: "never",
      model: "gpt-5.4",
      prompt: "Updated prompt",
      sessionStrategy: "per_subtask",
      temperature: 0.2,
      toolMode: "workspace-write",
    });
    expect(storedTask.runtimeInputVersion).toBe("openclaw-legacy-v1");
    expect(storedTask.runtimeConfig).toEqual({
      approvalPolicy: "never",
      temperature: 0.2,
      toolMode: "workspace-write",
    });
  });
});

describe("invalidateMemory", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("marks an active memory inactive and records a canonical update event", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Memory Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Remember projection rules",
        status: "Running",
        priority: "High",
        ownerType: "human",
      },
    });
    const memory = await db.memory.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        content: "Use Task Projection for all list surfaces.",
        scope: "workspace",
        sourceType: "user_input",
        status: "Active",
      },
    });

    const result = await invalidateMemory({ memoryId: memory.id });

    const storedMemory = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    const memoryEvents = await db.event.findMany({
      where: { taskId: task.id, eventType: "memory.updated" },
      orderBy: { ingestSequence: "asc" },
    });

    expect(result.memoryId).toBe(memory.id);
    expect(storedMemory.status).toBe(MemoryStatus.Inactive);
    expect(memoryEvents).toHaveLength(1);
    expect(memoryEvents[0]?.payload).toEqual(
      expect.objectContaining({
        memory_id: memory.id,
        next_status: "Inactive",
        previous_status: "Active",
      }),
    );
  });
});

describe("resolveApproval", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sends edited approval content upstream before marking it resolved locally", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Approval Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Review generated patch",
        status: "WaitingForApproval",
        priority: "High",
        ownerType: "human",
      },
    });
    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_run_1",
        runtimeSessionRef: "session_1",
        status: "WaitingForApproval",
        triggeredBy: "user",
      },
    });
    await db.approval.create({
      data: {
        id: "approval_1",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: "exec",
        title: "Approve patch",
        summary: "Allow the patch to be applied",
        riskLevel: "medium",
        status: "Pending",
        requestedAt: new Date(),
      },
    });

    const adapter = {
      async createRun() {
        throw new Error("not used");
      },
      async sendOperatorMessage() {
        throw new Error("not used");
      },
      async getRunSnapshot() {
        return {
          runtimeRunRef: "runtime_run_1",
          runtimeSessionKey: "session_1",
          status: "Running" as const,
        };
      },
      async readHistory() {
        return { messages: [] };
      },
      async listApprovals() {
        return [];
      },
      async waitForApprovalDecision() {
        return "allow-once" as const;
      },
      async resumeRun(input: { approvalId?: string; decision?: string; inputText?: string }) {
        expect(input.approvalId).toBe("approval_1");
        expect(input.decision).toBe("approve");
        expect(input.inputText).toBe("Use the safer patch");
        return { accepted: true, runtimeRunRef: "runtime_run_1", runtimeSessionKey: "session_1", runStarted: true };
      },
      async executeTask() {
        throw new Error("not used");
      },
      async getSessionStatus() {
        throw new Error("not used");
      },
    };

    await resolveApproval({
      approvalId: "approval_1",
      decision: "EditedAndApproved",
      editedContent: "Use the safer patch",
      resolutionNote: "Adjusted command before approving",
      adapter,
    });

    const storedApproval = await db.approval.findUniqueOrThrow({ where: { id: "approval_1" } });
    const storedRun = await db.run.findUniqueOrThrow({ where: { id: run.id } });

    expect(storedApproval.status).toBe("EditedAndApproved");
    expect(storedApproval.resolutionNote).toBe("Adjusted command before approving");
    expect(storedRun.status).toBe("Running");
  });

  it("keeps a pending approval unchanged if upstream rejection fails", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Approval Failure Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Reject dangerous command",
        status: "WaitingForApproval",
        priority: "Urgent",
        ownerType: "human",
      },
    });
    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_run_2",
        runtimeSessionRef: "session_2",
        status: "WaitingForApproval",
        triggeredBy: "user",
      },
    });
    await db.approval.create({
      data: {
        id: "approval_2",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: "exec",
        title: "Reject patch",
        summary: "Deny the operation",
        riskLevel: "high",
        status: "Pending",
        requestedAt: new Date(),
      },
    });

    const adapter = {
      async createRun() {
        throw new Error("not used");
      },
      async sendOperatorMessage() {
        throw new Error("not used");
      },
      async getRunSnapshot() {
        throw new Error("not used");
      },
      async readHistory() {
        return { messages: [] };
      },
      async listApprovals() {
        return [];
      },
      async waitForApprovalDecision() {
        return null;
      },
      async resumeRun(input: { decision?: string }) {
        expect(input.decision).toBe("reject");
        return { accepted: false };
      },
      async executeTask() {
        throw new Error("not used");
      },
      async getSessionStatus() {
        throw new Error("not used");
      },
    };

    await expect(
      resolveApproval({
        approvalId: "approval_2",
        decision: "Rejected",
        resolutionNote: "Unsafe change",
        adapter,
      }),
    ).rejects.toThrow("Runtime rejected the approval resolution.");

    const storedApproval = await db.approval.findUniqueOrThrow({ where: { id: "approval_2" } });
    const storedRun = await db.run.findUniqueOrThrow({ where: { id: run.id } });

    expect(storedApproval.status).toBe("Pending");
    expect(storedApproval.resolvedAt).toBeNull();
    expect(storedRun.status).toBe("WaitingForApproval");
  });
});

describe("sendOperatorMessage", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sends a non-blocking note to the runtime and syncs it into conversation history", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Operator Notes Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Guide the running agent",
        status: "Running",
        priority: "High",
        ownerType: "human",
      },
    });
    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_note_1",
        runtimeSessionRef: "session_note_1",
        status: "Running",
        triggeredBy: "user",
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    const adapter = {
      async createRun() {
        throw new Error("not used");
      },
      async sendOperatorMessage(input: { runtimeSessionKey: string; message: string }) {
        expect(input).toEqual({
          runtimeSessionKey: "session_note_1",
          message: "Keep the update concise unless risk increases.",
        });

        return {
          accepted: true,
          runtimeRunRef: "runtime_note_1",
          runtimeSessionKey: "session_note_1",
          runStarted: false,
        };
      },
      async getRunSnapshot() {
        return {
          runtimeRunRef: "runtime_note_1",
          runtimeSessionKey: "session_note_1",
          status: "Running" as const,
        };
      },
      async readHistory() {
        return {
          messages: [
            {
              role: "user",
              content: "Keep the update concise unless risk increases.",
              timestamp: "2026-04-08T10:05:00.000Z",
              __openclaw: { seq: 1, id: "msg_operator_note_1" },
            },
          ],
        };
      },
      async listApprovals() {
        return [];
      },
      async waitForApprovalDecision() {
        return null;
      },
      async resumeRun() {
        throw new Error("not used");
      },
    };

    const result = await sendOperatorMessage({
      runId: run.id,
      message: "Keep the update concise unless risk increases.",
      adapter,
    });

    const storedConversation = await db.conversationEntry.findMany({
      where: { runId: run.id },
      orderBy: { sequence: "asc" },
    });
    const noteEvent = await db.event.findFirst({
      where: { runId: run.id, eventType: "operator.note_added" },
      orderBy: { ingestSequence: "desc" },
    });

    expect(result).toMatchObject({
      workspaceId: workspace.id,
      taskId: task.id,
      runId: run.id,
    });
    expect(storedConversation).toHaveLength(1);
    expect(storedConversation[0]).toMatchObject({
      role: "user",
      content: "Keep the update concise unless risk increases.",
      externalRef: "msg_operator_note_1",
    });
    expect(noteEvent?.payload).toEqual(
      expect.objectContaining({
        message: "Keep the update concise unless risk increases.",
        delivery: "sent_to_runtime",
        prior_status: "Running",
      }),
    );
  });

  it("returns a refreshable error when the run no longer exists", async () => {
    await expect(
      sendOperatorMessage({
        runId: "run_missing",
        message: "Still there?",
        adapter: {
          async createRun() {
            throw new Error("not used");
          },
          async sendOperatorMessage() {
            throw new Error("not used");
          },
          async getRunSnapshot() {
            throw new Error("not used");
          },
          async readHistory() {
            throw new Error("not used");
          },
          async listApprovals() {
            return [];
          },
          async waitForApprovalDecision() {
            return null;
          },
          async resumeRun() {
            throw new Error("not used");
          },
        },
      }),
    ).rejects.toThrow("The run no longer exists. Refresh the work page and try again.");
  });
});

describe("closure commands", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("accepts a completed result, marks the task done, creates a follow-up, and reopens it", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Closure Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Close execution loop",
        runtimeModel: "gpt-5.4",
        prompt: "Ship the change",
        status: "Completed",
        priority: "High",
        ownerType: "human",
      },
    });
    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: "Completed",
        triggeredBy: "user",
        startedAt: new Date("2026-04-08T10:00:00.000Z"),
        endedAt: new Date("2026-04-08T10:30:00.000Z"),
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    await acceptTaskResult({ taskId: task.id });
    await markTaskDone({ taskId: task.id });
    const followUp = await createFollowUpTask({
      taskId: task.id,
      title: "Follow up remaining polish",
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await reopenTask({ taskId: task.id });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { projection: true },
    });
    const storedFollowUp = await db.task.findUniqueOrThrow({ where: { id: followUp.followUpTaskId } });
    const events = await db.event.findMany({
      where: { taskId: task.id },
      orderBy: { ingestSequence: "asc" },
    });

    expect(storedTask.status).toBe("Ready");
    expect(storedTask.completedAt).toBeNull();
    expect(storedTask.projection?.persistedStatus).toBe("Ready");
    expect(storedFollowUp.parentTaskId).toBe(task.id);
    expect(storedFollowUp.scheduleStatus).toBe("Unscheduled");
    expect(events.map((event) => event.eventType)).toEqual([
      "task.result_accepted",
      "task.done",
      "task.follow_up_created",
      "task.reopened",
    ]);
  });
});
