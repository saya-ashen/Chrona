import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";
import { db } from "@/lib/db";
import { claimPlanRunCommand, getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import { ensureNativePlanRun, persistRuntimeState } from "../persistence/plan-runtime-store";
import {
  executeTaskNodeCapabilityMock,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
} from "../plan-runner.task-executor.fixtures";
import { executeCommand } from "./execute-command";
import { setupExecutionCommand } from "./execute-command-setup";

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

  it("terminalizes the exact canonical Run when provider start fails before a provider identity exists", async () => {
    let canonicalRunId = "";
    executeTaskNodeCapabilityMock.mockImplementation(async (input) => {
      const run = await db.run.create({
        data: {
          taskId: input.taskId,
          nodeAttemptId: input.attempt.id,
          taskSessionId: input.mainSession.id,
          runtimeName: "hermes",
          status: "Running",
          triggeredBy: "system",
        },
      });
      canonicalRunId = run.id;
      return { status: "failed", error: "Provider execution could not start" };
    });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel provider pre-start failure");
    const compiledPlan = makeTwoTaskPlan("graph_provider_pre_start_failure");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await executeCommand({
      taskId: task.id,
      command: { type: "start", trigger: "manual" },
      context: { idempotencyKey: "provider-pre-start-failure" },
    });

    expect(result.status).toBe("failed");
    expect(await db.run.findUniqueOrThrow({ where: { id: canonicalRunId } })).toMatchObject({
      status: "Failed",
      nodeAttemptId: expect.any(String),
    });
    expect(await db.taskPlanProviderRun.count({ where: { runId: canonicalRunId } })).toBe(0);
  });

  it("passes the Task's frozen Goal snapshot into node execution", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-goal-context" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel Goal context");
    await db.task.update({
      where: { id: task.id },
      data: {
        title: "Find funded AI Agent PhD positions",
        description: "Use my frozen Goal context and return a concise shortlist.",
        goalContext: {
          goal: {
            title: "Apply for an AI Agent PhD",
            additionalContext: "Bioinformatics graduate student; AI, Agent, LLM.",
            operationalBrief: {
              outcome: "Apply for an AI Agent PhD",
              currentFocus: "Find positions",
              strategy: "",
              constraints: ["Fully funded"],
            },
            capturedAt: "2026-07-25T12:25:05.730Z",
          },
          acceptedResults: [],
          internalTaskId: "must-not-be-forwarded",
        },
      },
    });
    const compiledPlan = makeTwoTaskPlan("graph_kernel_goal_context");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await executeCommand({
      taskId: task.id,
      command: { type: "start", trigger: "manual" },
    });

    const call = executeTaskNodeCapabilityMock.mock.calls[0]?.[0];
    expect(call?.planContext).toMatchObject({
      taskTitle: "Find funded AI Agent PhD positions",
      taskDescription: "Use my frozen Goal context and return a concise shortlist.",
    });
    expect(call?.planContext?.goalContext).toEqual({
      goal: {
        title: "Apply for an AI Agent PhD",
        additionalContext: "Bioinformatics graduate student; AI, Agent, LLM.",
        operationalBrief: {
          outcome: "Apply for an AI Agent PhD",
          currentFocus: "Find positions",
          strategy: "",
          constraints: ["Fully funded"],
        },
        capturedAt: "2026-07-25T12:25:05.730Z",
      },
      acceptedResults: [],
    });
    expect(JSON.stringify(call?.planContext)).not.toContain("must-not-be-forwarded");
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
    const planRunAfterFirst = await db.taskPlanRun.findFirstOrThrow({
      where: { taskId: task.id, planId: compiledPlan.editablePlanId },
      select: { id: true, executionEpoch: true },
    });
    const receiptCountAfterFirst = await db.taskPlanCommandReceipt.count({ where: { planRunId: planRunAfterFirst.id } });
    const second = await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });
    const planRunAfterSecond = await db.taskPlanRun.findUniqueOrThrow({
      where: { id: planRunAfterFirst.id },
      select: { executionEpoch: true },
    });

    expect(first.status).toBe("running");
    expect(second.status).toBe("running");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    expect(planRunAfterSecond.executionEpoch).toBe(planRunAfterFirst.executionEpoch);
    expect(await db.taskPlanCommandReceipt.count({ where: { planRunId: planRunAfterFirst.id } })).toBe(receiptCountAfterFirst);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((a) => [a.nodeId, a.status])).toEqual([
      ["first_task", "running"],
    ]);
  });

  it("does not advance the execution epoch when retry targets an active provider run", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-active-retry" },
      output: { runtimeRunRef: "runtime-active-retry" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel active retry");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_active_retry");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await executeCommand({ taskId: task.id, command: { type: "start", trigger: "manual" } });

    const planRun = await db.taskPlanRun.findFirstOrThrow({
      where: { taskId: task.id, planId: compiledPlan.editablePlanId },
    });
    const attempt = await db.taskPlanNodeAttempt.findFirstOrThrow({
      where: { planRunId: planRun.id, nodeId: "first_task", status: "running" },
    });
    await db.taskPlanProviderRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: compiledPlan.editablePlanId,
        planRunId: planRun.id,
        nodeAttemptId: attempt.id,
        idempotencyKey: "active-retry-provider-run",
        status: "running",
      },
    });

    await executeCommand({
      taskId: task.id,
      command: { type: "retry_node", nodeId: "first_task", reason: "duplicate retry" },
      context: { workBlockId: null, idempotencyKey: "active-retry-command" },
    });

    const reloaded = await db.taskPlanRun.findUniqueOrThrow({ where: { id: planRun.id } });
    expect(reloaded.executionEpoch).toBe(planRun.executionEpoch);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("claims concurrent commands before provider, event, artifact, and cancellation effects", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-first-task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel command claim effects");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_command_claim_effects");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await ensureNativePlanRun(task.id);
    const virginClaim = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(await db.taskPlanCommandReceipt.count({ where: { planRunId: virginClaim?.id } })).toBe(0);

    const [firstClaim, duplicateClaim] = await Promise.all([
      executeCommand({
        taskId: task.id,
        command: { type: "start", trigger: "manual" },
        context: { idempotencyKey: "virgin-claim-once" },
      }),
      executeCommand({
        taskId: task.id,
        command: { type: "start", trigger: "manual" },
        context: { idempotencyKey: "virgin-claim-once" },
      }),
    ]);
    expect(firstClaim.status).toBe("running");
    expect(duplicateClaim.status).toBe("running");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    const mainTaskSession = await db.taskSession.findFirstOrThrow({ where: { taskId: task.id } });
    const activeRun = await db.run.create({
      data: { taskId: task.id, taskSessionId: mainTaskSession.id, runtimeName: "hermes", status: "Running", triggeredBy: "system" },
    });

    await Promise.all([
      executeCommand({
        taskId: task.id,
        command: { type: "restart_from_beginning", trigger: "manual" },
        context: { idempotencyKey: "restart-once" },
      }),
      executeCommand({
        taskId: task.id,
        command: { type: "restart_from_beginning", trigger: "manual" },
        context: { idempotencyKey: "restart-once" },
      }),
    ]);

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(2);
    expect(await db.event.count({
      where: { taskId: task.id, eventType: "plan_execution.execution_started" },
    })).toBe(2);
    expect(await db.run.findUniqueOrThrow({ where: { id: activeRun.id } })).toMatchObject({
      status: "Cancelled",
    });
    const activeAttempt = await db.taskPlanNodeAttempt.findFirstOrThrow({
      where: { taskId: task.id, planId: compiledPlan.editablePlanId, status: "running" },
      orderBy: { startedAt: "desc" },
    });
    const activeExecutionSession = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id, status: "Active" },
      orderBy: { updatedAt: "desc" },
    });
    const submissionRun = await db.run.create({
      data: { taskId: task.id, taskSessionId: mainTaskSession.id, nodeAttemptId: activeAttempt.id, runtimeName: "hermes", runtimeRunRef: "runtime-first-task", status: "Running", triggeredBy: "system" },
    });
    const providerRun = await db.taskPlanProviderRun.create({
      data: { workspaceId: workspace.id, taskId: task.id, planId: compiledPlan.editablePlanId, planRunId: activeAttempt.planRunId, nodeAttemptId: activeAttempt.id, runId: submissionRun.id, idempotencyKey: "deliverable-once-provider", status: "running" },
    });

    const scope = submissionRun.id;
    const directory = join(getChronaGeneratedFilesDir(), scope);
    const uri = `generated://${scope}/result.md` as `generated://${string}`;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "result.md"), "# Claimed result\n");
    try {
      const submit = () => executeCommand({
        taskId: task.id,
        command: {
          type: "submit_node_result",
          nodeId: activeAttempt.nodeId,
          expectedAttemptId: activeAttempt.id,
          runtimeRunRef: "runtime-first-task",
          providerRunId: providerRun.id,
          result: {
            kind: "done",
            summary: "Claimed result",
            evidence: { runId: submissionRun.id },
            deliverables: [{
              deliverableKey: "claimed-result",
              title: "Claimed result",
              kind: "document",
              source: { type: "generated_file", uri },
            }],
          },
        },
        context: { idempotencyKey: "deliverable-once", runId: submissionRun.id, sessionId: activeExecutionSession.id },
      });
      await Promise.all([submit(), submit()]);
      expect(await db.artifact.count({ where: { taskId: task.id } })).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("atomically rejects a second start with a different key while the first claim is in flight", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Kernel cross-process start claim");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_cross_process_start");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const left = await setupExecutionCommand({
      taskId: task.id,
      command: { type: "start", trigger: "manual" },
      context: { idempotencyKey: "start-owner-left" },
    });
    const right = await setupExecutionCommand({
      taskId: task.id,
      command: { type: "start", trigger: "manual" },
      context: { idempotencyKey: "start-owner-right" },
    });

    expect(left.kind).toBe("ready");
    expect(right.kind).toBe("result");
    const planRun = await db.taskPlanRun.findFirstOrThrow({
      where: { taskId: task.id, planId: compiledPlan.editablePlanId },
    });
    expect(planRun.executionEpoch).toBe(1);
    expect(await db.taskPlanCommandReceipt.count({ where: { planRunId: planRun.id } })).toBe(1);
  });

  it("does not reclaim an earlier command key after a different command", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-command-receipt" },
      output: { runtimeRunRef: "runtime-command-receipt" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel historical command receipt");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_historical_command_receipt");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await executeCommand({
      taskId: task.id,
      command: { type: "start", trigger: "manual" },
      context: { idempotencyKey: "receipt-bootstrap" },
    });
    await executeCommand({
      taskId: task.id,
      command: { type: "restart_from_beginning", trigger: "manual" },
      context: { idempotencyKey: "receipt-a" },
    });
    await executeCommand({
      taskId: task.id,
      command: { type: "restart_from_beginning", trigger: "manual" },
      context: { idempotencyKey: "receipt-b" },
    });

    const beforeReplay = await db.taskPlanRun.findFirstOrThrow({
      where: { taskId: task.id, planId: compiledPlan.editablePlanId },
    });
    const eventCountBeforeReplay = await db.event.count({
      where: { taskId: task.id, eventType: "plan_execution.execution_started" },
    });
    await executeCommand({
      taskId: task.id,
      command: { type: "restart_from_beginning", trigger: "manual" },
      context: { idempotencyKey: "receipt-a" },
    });

    const afterReplay = await db.taskPlanRun.findUniqueOrThrow({ where: { id: beforeReplay.id } });
    expect(afterReplay.executionEpoch).toBe(beforeReplay.executionEpoch);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(3);
    expect(await db.event.count({
      where: { taskId: task.id, eventType: "plan_execution.execution_started" },
    })).toBe(eventCountBeforeReplay);
    expect(await db.taskPlanCommandReceipt.findMany({
      where: { planRunId: beforeReplay.id },
      orderBy: { executionEpoch: "asc" },
      select: { commandKey: true },
    })).toEqual([
      { commandKey: "receipt-bootstrap" },
      { commandKey: "receipt-a" },
      { commandKey: "receipt-b" },
    ]);
  });

  it("rejects a stale intermediate onStateChange snapshot after a newer command claim", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-stale-state" },
      output: { runtimeRunRef: "runtime-stale-state" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Kernel stale intermediate state");
    const compiledPlan = makeTwoTaskPlan("graph_kernel_stale_intermediate_state");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await executeCommand({
      taskId: task.id,
      command: { type: "start", trigger: "manual" },
      context: { idempotencyKey: "stale-state-a" },
    });
    const runtime = await ensureNativePlanRun(task.id);
    if (!runtime?.persisted.graph) throw new Error("Expected persisted graph runtime");
    const staleEpoch = runtime.persisted.executionEpoch;
    expect(await claimPlanRunCommand({
      taskId: task.id,
      planId: runtime.planId,
      workBlockId: runtime.workBlockId,
      expectedEpoch: staleEpoch,
      commandKey: "stale-state-b",
      commandDigest: "stale-state-digest-b",
    })).toMatchObject({ status: "claimed" });

    await expect(persistRuntimeState({
      workspaceId: runtime.workspaceId,
      taskId: task.id,
      workBlockId: runtime.workBlockId,
      planId: runtime.planId,
      expectedExecutionEpoch: staleEpoch,
      compiledPlan: runtime.compiledPlan,
      graph: runtime.persisted.graph,
      attempts: runtime.persisted.attempts.map((attempt) => ({ ...attempt, status: "failed" as const })),
      results: runtime.persisted.results,
      executionContextSnapshots: runtime.persisted.executionContextSnapshots,
    })).rejects.toThrow("Plan runtime state changed before intermediate persistence");

    const reloaded = await getPlanRun(task.id, runtime.planId, runtime.workBlockId);
    expect(reloaded?.executionEpoch).toBe(staleEpoch + 1);
    expect(reloaded?.attempts.map((attempt) => attempt.status)).toEqual(["running"]);
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
      context: {
        idempotencyKey: "late-duplicate-result",
        sessionId: completed.executionSessionId ?? undefined,
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
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: "Completed",
      completedAt: expect.any(Date),
    });

    const restarted = await executeCommand({
      taskId: task.id,
      command: { type: "restart_from_beginning", trigger: "manual" },
    });

    expect(restarted.status).toBe("running");
    expect(restarted.currentNodeId).toBe("first_task");
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: "Running",
      completedAt: null,
    });
    expect(await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } })).toMatchObject({
      persistedStatus: "Running",
      displayState: "ExecutionActive",
      currentNodeId: "first_task",
    });
    expect(await db.executionSession.count({ where: { taskId: task.id, status: "Active" } })).toBe(1);
  });
});
