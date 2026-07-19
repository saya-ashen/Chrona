import { describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
} from "../plan-runner.task-executor.fixtures";
import { executeCommand } from "./execute-command";

describe("kernel executeCommand (single-writer)", () => {
  setupPlanRunnerTaskExecutorTest();

  it("starts the first ready node and reports running", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-first-task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel start");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_start");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await executeCommand({
      taskId: task.id,
      command: { type: "start", trigger: "manual" },
    });

    expect(result.status).toBe("running");
    expect(result.currentNodeId).toBe("first_task");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((a) => [a.nodeId, a.status])).toEqual([
      ["first_task", "running"],
    ]);
  });

  it("does not start a second provider attempt when start is retried while running", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-first-task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel duplicate start");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_duplicate");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const first = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });
    const second = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });

    expect(first.status).toBe("running");
    expect(second.status).toBe("running");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((a) => [a.nodeId, a.status])).toEqual([
      ["first_task", "running"],
    ]);
  });


  it("serially advances to the next ready node when the first completes in-process", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task finished",
        evidence: { sessionId: "main-session", runId: "run-first" },
        output: {
          root: "root",
          elements: {
            root: { type: "RichMarkdown", props: { content: "first output" } },
          },
        },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second task started",
        evidence: { sessionId: "main-session", runId: "run-second" },
        output: { runtimeRunRef: "runtime-second" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel serial");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_serial");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });

    expect(result.status).toBe("running");
    expect(result.currentNodeId).toBe("second_task");
    expect(executeTaskNodeCapabilityMock.mock.calls.map((c) => c[0].node.id)).toEqual([
      "first_task",
      "second_task",
    ]);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((a) => [a.nodeId, a.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "running"],
    ]);
  });

  it("keeps normal start as continuation after graph progress", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task finished",
        evidence: { sessionId: "main-session", runId: "run-first" },
        output: { root: "root", elements: { root: { type: "RichMarkdown", props: { content: "first output" } } } },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second task started",
        evidence: { sessionId: "main-session", runId: "run-second" },
        output: { runtimeRunRef: "runtime-second" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel continuation start");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_continue");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });
    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });

    expect(executeTaskNodeCapabilityMock.mock.calls.map((c) => c[0].node.id)).toEqual([
      "first_task",
      "second_task",
    ]);
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((a) => [a.nodeId, a.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "running"],
    ]);
  });

  it("ignores late node results without creating an empty active session", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task finished",
        evidence: { sessionId: "main-session", runId: "run-first" },
      })
      .mockResolvedValueOnce({
        status: "done",
        summary: "Second task finished",
        evidence: { sessionId: "main-session", runId: "run-second" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel ignores late result");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_late_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const completed = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });
    expect(completed.status).toBe("completed");
    const sessionsBefore = await db.executionSession.count({ where: { taskId: task.id } });

    const late = await executeCommand({
      taskId: task.id,
      command: {
        type: "submit_node_result",
        nodeId: "second_task",
        result: { kind: "done", summary: "Late duplicate" },
      },
    });

    expect(late.status).toBe("completed");
    expect(late.message).toBe("Execution already completed; node result ignored.");
    expect(await db.executionSession.count({ where: { taskId: task.id } })).toBe(sessionsBefore);
    expect(await db.executionSession.count({ where: { taskId: task.id, status: "Active" } })).toBe(0);
  });

  it("restarts an accepted plan from the first node with fresh runtime state", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task finished",
        evidence: { sessionId: "main-session", runId: "run-first" },
        output: { root: "root", elements: { root: { type: "RichMarkdown", props: { content: "first output" } } } },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second task started",
        evidence: { sessionId: "main-session", runId: "run-second" },
        output: { runtimeRunRef: "runtime-second" },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "First task restarted",
        evidence: { sessionId: "main-session-restart", runId: "run-first-restart" },
        output: { runtimeRunRef: "runtime-first-restart" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel restart from beginning");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_restart");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });
    const beforeRestartSession = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id, status: "Active" },
    });
    const beforeRestart = await getPlanRun(task.id, compiledPlan.editablePlanId);

    const restarted = await executeCommand({ taskId: task.id, command: { type: "restart_from_beginning", trigger: "manual" } });

    expect(restarted.status).toBe("running");
    expect(restarted.currentNodeId).toBe("first_task");
    expect(executeTaskNodeCapabilityMock.mock.calls.map((c) => c[0].node.id)).toEqual([
      "first_task",
      "second_task",
      "first_task",
    ]);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((a) => [a.nodeId, a.status])).toEqual([
      ["first_task", "running"],
    ]);
    expect(persisted?.executionEpoch).toBeGreaterThan(beforeRestart?.executionEpoch ?? 0);

    const abandonedSession = await db.executionSession.findUniqueOrThrow({
      where: { id: beforeRestartSession.id },
      select: { status: true },
    });
    expect(abandonedSession).toEqual({ status: "Abandoned" });
  });

  it("atomically reactivates task and projection when restarting a completed graph", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task finished",
        evidence: { sessionId: "main-session", runId: "run-first" },
      })
      .mockResolvedValueOnce({
        status: "done",
        summary: "Second task finished",
        evidence: { sessionId: "main-session", runId: "run-second" },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "First task restarted",
        evidence: { sessionId: "main-session-restart", runId: "run-first-restart" },
        output: { runtimeRunRef: "runtime-first-restart" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel completed restart");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_completed_restart");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const completed = await executeCommand({
      taskId: task.id,
      command: { type: "start", trigger: "manual" },
    });
    expect(completed.status).toBe("completed");
    await expect(db.task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject({
      status: "Completed",
      completedAt: expect.any(Date),
    });

    const restarted = await executeCommand({
      taskId: task.id,
      command: { type: "restart_from_beginning", trigger: "manual" },
    });

    expect(restarted.status).toBe("running");
    expect(restarted.currentNodeId).toBe("first_task");
    await expect(db.task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject({
      status: "Running",
      completedAt: null,
    });
    await expect(db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } })).resolves.toMatchObject({
      persistedStatus: "Running",
      displayState: "ExecutionActive",
      currentNodeId: "first_task",
    });
    expect(await db.executionSession.count({ where: { taskId: task.id, status: "Active" } })).toBe(1);
  });
});
