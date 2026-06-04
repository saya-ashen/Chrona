import { describe, expect, it } from "bun:test";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
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
        output: { runtimeRunRef: "runtime-first", outputText: "first output" },
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
});
