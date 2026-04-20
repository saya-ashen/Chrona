import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { RunStatus, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createMockOpenClawAdapter } from "@/modules/openclaw/mock-adapter";
import { syncRunFromRuntime } from "@/modules/runtime-sync/sync-run";

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

describe("syncRunFromRuntime", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("maps waiting approvals, transcript messages, and tool calls idempotently", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Adapter Sync Workspace",
        defaultRuntime: "openclaw",
        status: "Active",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Sync waiting approval run",
        status: TaskStatus.Running,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_waiting_1",
        runtimeSessionRef: "agent:main:dashboard:session_waiting_1",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    const adapter = createMockOpenClawAdapter({
      fixtureName: "run-waiting-approval",
    });

    await syncRunFromRuntime({ runId: run.id, adapter });
    await syncRunFromRuntime({ runId: run.id, adapter });

    const storedRun = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    const approvals = await db.approval.findMany({ where: { runId: run.id } });
    const events = await db.event.findMany({ where: { runId: run.id } });
    const entries = await db.conversationEntry.findMany({
      where: { runId: run.id },
      orderBy: { sequence: "asc" },
    });
    const toolCalls = await db.toolCallDetail.findMany({ where: { runId: run.id } });
    const cursor = await db.runtimeCursor.findUnique({ where: { runId: run.id } });
    const projection = await db.taskProjection.findUnique({ where: { taskId: task.id } });

    expect(storedRun.status).toBe(RunStatus.WaitingForApproval);
    expect(approvals).toHaveLength(1);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "approval.requested",
      "tool.called",
      "tool.completed",
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.role)).toEqual(["user", "assistant"]);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.toolName).toBe("read");
    expect(toolCalls[0]?.status).toBe("completed");
    expect(projection?.displayState).toBe("WaitingForApproval");
    expect(projection?.approvalPendingCount).toBe(1);
    expect(JSON.parse(cursor?.nextCursor ?? "{}")).toMatchObject({
      sessionKey: "agent:main:dashboard:session_waiting_1",
      lastMessageSeq: 4,
      lastRunStatus: "WaitingForApproval",
      approvalIds: ["approval_waiting_1"],
    });
  });

  it("records run completion transitions from the completed fixture", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Adapter Sync Workspace",
        defaultRuntime: "openclaw",
        status: "Active",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Sync completed run",
        status: TaskStatus.Running,
        priority: TaskPriority.Medium,
        ownerType: "human",
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_completed_1",
        runtimeSessionRef: "agent:main:dashboard:session_completed_1",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    const adapter = createMockOpenClawAdapter({ fixtureName: "run-completed" });

    await syncRunFromRuntime({ runId: run.id, adapter });

    const storedRun = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    const events = await db.event.findMany({
      where: { runId: run.id },
      orderBy: { ingestSequence: "asc" },
    });

    expect(storedRun.status).toBe(RunStatus.Completed);
    expect(events.map((event) => event.eventType)).toEqual(["run.completed"]);
    expect(projection.persistedStatus).toBe("Completed");
    expect(projection.displayState).toBeNull();
  });

  it("reconciles approvals that were resolved outside the local adapter path", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Adapter Sync Workspace",
        defaultRuntime: "openclaw",
        status: "Active",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Sync externally resolved approval",
        status: TaskStatus.Running,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_waiting_1",
        runtimeSessionRef: "agent:main:dashboard:session_waiting_1",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    await syncRunFromRuntime({
      runId: run.id,
      adapter: createMockOpenClawAdapter({ fixtureName: "run-waiting-approval" }),
    });

    await syncRunFromRuntime({
      runId: run.id,
      adapter: createMockOpenClawAdapter({
        fixture: {
          snapshot: {
            runtimeRunRef: "runtime_waiting_1",
            runtimeSessionRef: "session_waiting_1",
            runtimeSessionKey: "agent:main:dashboard:session_waiting_1",
            rawStatus: "running",
            status: "Running",
          },
          history: {
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "Read package.json and report the package name." }],
                timestamp: 1737264000000,
                __openclaw: { id: "msg_user_1", seq: 1 },
              },
              {
                role: "assistant",
                content: [
                  {
                    type: "toolCall",
                    id: "tool_call_read_1",
                    name: "read",
                    arguments: { path: "package.json" },
                  },
                ],
                timestamp: 1737264001000,
                __openclaw: { id: "msg_assistant_2", seq: 2 },
              },
              {
                role: "toolResult",
                toolCallId: "tool_call_read_1",
                toolName: "read",
                content: [{ type: "text", text: '{"name":"chrona"}' }],
                isError: false,
                timestamp: 1737264002000,
                __openclaw: { id: "msg_tool_3", seq: 3 },
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "Waiting for approval before I continue." }],
                timestamp: 1737264003000,
                __openclaw: { id: "msg_assistant_4", seq: 4 },
              },
            ],
          },
          approvals: [],
          approvalDecisions: {
            approval_waiting_1: "allow-once",
          },
        },
      }),
    });

    const storedApproval = await db.approval.findUniqueOrThrow({
      where: { id: "approval_waiting_1" },
    });
    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    const cursor = await db.runtimeCursor.findUniqueOrThrow({ where: { runId: run.id } });
    const events = await db.event.findMany({
      where: { runId: run.id },
      orderBy: { ingestSequence: "asc" },
    });

    expect(storedApproval.status).toBe("Approved");
    expect(storedApproval.resolvedAt).not.toBeNull();
    expect(storedApproval.resolutionNote).toBe("Resolved from OpenClaw approval decision sync");
    expect(events.map((event) => event.eventType)).toEqual([
      "tool.called",
      "tool.completed",
      "approval.requested",
      "approval.resolved",
    ]);
    expect(projection.persistedStatus).toBe("Running");
    expect(projection.displayState).toBeNull();
    expect(projection.approvalPendingCount).toBe(0);
    expect(JSON.parse(cursor.nextCursor ?? "{}")).toMatchObject({
      approvalIds: [],
      lastRunStatus: "Running",
    });
  });
});
