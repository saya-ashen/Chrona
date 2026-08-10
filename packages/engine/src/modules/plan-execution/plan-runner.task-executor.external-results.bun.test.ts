import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import type { CompiledPlan, ConditionConfig, TaskConfig } from "@chrona/contracts/ai";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { NodeExecutionResult } from "./node-executors/types";
import { buildSemanticRefHistory } from "./runtime/node-runtime-refs";
import { recoverRecordedTerminalActions } from "./use-cases/recover-recorded-terminal-actions";
import {
  executeTaskNodeCapabilityMock,
  evaluateConditionNodeCapabilityMock,
  makeManualThenTaskPlan,
  makeSingleTaskPlan,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

describe("plan-runner task executor external results", () => {
  setupPlanRunnerTaskExecutorTest();

  it("does not let a provider started result overwrite an external node result", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const activeSession = await db.executionSession.findFirstOrThrow({
        where: { taskId: input.taskId },
        orderBy: { createdAt: "desc" },
      });
      expect(activeSession.currentNodeId).toBe("task_node");

      const submittedResult = await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "complete_manual_node",
          expectedAttemptId: input.attempt.id,
          summary: "Hermes completed externally",
          output: {
            root: "root",
            elements: {
              root: { type: "JsonView", props: { value: { source: "hermes" } } },
            },
          },
        },
        commandContext: {
          sessionId: activeSession.id,
          idempotencyKey: "external-result-first",
        },
      });
      expect(submittedResult.status).toBe("completed");

      return {
        status: "started",
        summary: "Hermes run started before external completion was observed",
        evidence: { sessionId: input.mainSession.id },
        output: { runtimeRunRef: "hermes-run-stale" },
      } satisfies NodeExecutionResult;
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner preserves external result");
    const compiledPlan = makeSingleTaskPlan("graph_task_external_result_race");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("completed");
    expect(result.currentNodeId).toBeNull();

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.planRun.status).toBe("completed");
    expect(persisted?.graph?.status).toBe("completed");
    expect(persisted?.results).toHaveLength(1);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "current",
      outputSummary: "Hermes completed externally",
    });
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]).toMatchObject({
      nodeId: "task_node",
      status: "succeeded",
    });

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Completed");
    expect(session.currentNodeId).toBeNull();

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);

    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(projection.persistedStatus).toBe(TaskStatus.Completed);

    const taskSession = await db.taskSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    const staleRunningRun = await db.run.create({
      data: {
        taskId: task.id,
        taskSessionId: taskSession.id,
        workBlockId: session.workBlockId,
        occurrenceId: session.occurrenceId,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
        startedAt: new Date(),
        syncStatus: "healthy",
      },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    const convergedRun = await db.run.findUniqueOrThrow({ where: { id: staleRunningRun.id } });
    expect(convergedRun.status).toBe("Completed");

    const reprojection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(reprojection.persistedStatus).toBe(TaskStatus.Completed);
    expect(reprojection.latestRunStatus).toBe("Completed");

    const eventsBeforeReplay = await db.event.findMany({
      where: { taskId: task.id },
      orderBy: { ingestSequence: "asc" },
      select: { eventType: true, payload: true },
    });
    const completionIndex = eventsBeforeReplay.findIndex(
      (event) => event.eventType === "plan_execution.execution_completed",
    );
    expect(completionIndex).toBeGreaterThanOrEqual(0);
    const attemptCountBeforeReplay = await db.taskPlanNodeAttempt.count({
      where: { taskId: task.id, nodeId: "task_node" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    const attemptCountAfterReplay = await db.taskPlanNodeAttempt.count({
      where: { taskId: task.id, nodeId: "task_node" },
    });
    expect(attemptCountAfterReplay).toBe(attemptCountBeforeReplay);
  });

  it("persists semantic node contributions without node-local output blobs", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const submittedResult = await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "complete_manual_node",
          expectedAttemptId: input.attempt.id,
          summary: "Task wrapped up",
          findings: [{ key: "final-finding", content: "Final semantic finding" }],
          decisions: [{ key: "publish", content: "Publish the result" }],
        },
        commandContext: {
          sessionId: input.executionSessionId,
          idempotencyKey: "semantic-result-first",
        },
      });
      expect(submittedResult.status).toBe("completed");

      return {
        status: "started",
        summary: "Provider stream observed external completion",
        evidence: { sessionId: input.mainSession.id },
      } satisfies NodeExecutionResult;
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner persists semantic results");
    const compiledPlan = makeSingleTaskPlan("graph_task_semantic_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(result.status).toBe("completed");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    const completed = persisted?.results.find(
      (entry) => entry.nodeId === "task_node" && entry.status === "current",
    );
    expect(completed).toMatchObject({
      status: "current",
      outputSummary: "Task wrapped up",
      findings: [{ key: "final-finding", content: "Final semantic finding" }],
      decisions: [{ key: "publish", content: "Publish the result" }],
    });
    expect(completed).not.toHaveProperty("outputs");
    expect(persisted?.planOutput.manifest.findings).toHaveLength(1);
  });

  it("persists semantic contributions returned by the runtime terminal action", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => ({
      status: "done",
      summary: "Runtime result complete",
      evidence: { sessionId: input.mainSession.id },
      findings: [{ key: "runtime-finding", content: "Preserved runtime finding" }],
      decisions: [{ key: "runtime-decision", content: "Preserved runtime decision" }],
      caveats: [{ key: "runtime-caveat", content: "Preserved runtime caveat" }],
      nextActions: [{ key: "runtime-next", content: "Preserved runtime next action" }],
      resultEvidence: [{
        key: "runtime-evidence",
        summary: "Preserved runtime evidence",
        sourceNodeRef: "",
      }],
    } satisfies NodeExecutionResult));

    const { workspace, task } = await seedWorkspaceAndTask("Runner preserves runtime semantic results");
    const compiledPlan = makeSingleTaskPlan("graph_task_runtime_semantic_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(result.status).toBe("completed");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    const completed = persisted?.results.find(
      (entry) => entry.nodeId === "task_node" && entry.status === "current",
    );
    expect(completed).toMatchObject({
      outputSummary: "Runtime result complete",
      findings: [{ key: "runtime-finding", content: "Preserved runtime finding" }],
      decisions: [{ key: "runtime-decision", content: "Preserved runtime decision" }],
      caveats: [{ key: "runtime-caveat", content: "Preserved runtime caveat" }],
      nextActions: [{ key: "runtime-next", content: "Preserved runtime next action" }],
      resultEvidence: [{ key: "runtime-evidence", summary: "Preserved runtime evidence" }],
    });
    expect(persisted?.planOutput.manifest).toMatchObject({
      findings: [{ key: "runtime-finding", content: "Preserved runtime finding" }],
      decisions: [{ key: "runtime-decision", content: "Preserved runtime decision" }],
      caveats: [{ key: "runtime-caveat", content: "Preserved runtime caveat" }],
      nextActions: [{ key: "runtime-next", content: "Preserved runtime next action" }],
      evidence: [{ key: "runtime-evidence", summary: "Preserved runtime evidence" }],
    });
  });

  it("registers generated deliverables returned by the runtime terminal action", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner registers runtime deliverable");
    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
      },
    });
    const scope = run.id;
    const directory = join(getChronaGeneratedFilesDir(), scope);
    const path = join(directory, "report.md");
    await mkdir(directory, { recursive: true });
    await writeFile(path, "# Runtime report\n\nPreserved content.\n");
    const uri = `generated://${scope}/report.md` as `generated://${string}`;
    const compiledPlan = makeSingleTaskPlan("graph_task_runtime_artifact_registration");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      await db.run.update({ where: { id: run.id }, data: { taskSessionId: input.mainSession.id } });
      return {
        status: "done",
        summary: "Generated runtime report",
        evidence: { sessionId: input.mainSession.id, runId: run.id },
        deliverables: [{
          deliverableKey: "runtime-report",
          title: "Runtime report",
          kind: "document",
          source: { type: "generated_file", uri },
        }],
      } satisfies NodeExecutionResult;
    });

    try {
      const result = await taskPlanExecution.dispatch({
        taskId: task.id,
        action: { action: "start_manual" },
      });
      expect(result.status).toBe("completed");

      const artifacts = await db.artifact.findMany({ where: { taskId: task.id, runId: run.id } });
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        title: "Runtime report",
        uri,
        contentPreview: "# Runtime report\n\nPreserved content.\n",
      });
      const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
      expect(persisted?.planOutput.manifest.deliverables).toMatchObject([{
        deliverableKey: "runtime-report",
        title: "Runtime report",
        status: "current",
      }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("registers generated FileRef output as an idempotent run artifact", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner registers generated artifact");
    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
      },
    });
    const scope = run.id;
    const directory = join(getChronaGeneratedFilesDir(), scope);
    const path = join(directory, "report.md");
    await mkdir(directory, { recursive: true });
    await writeFile(path, "# Registered report\n\nVerified content.\n");
    const uri = `generated://${scope}/report.md`;
    const compiledPlan = makeSingleTaskPlan("graph_task_artifact_registration");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      await db.run.update({
        where: { id: run.id },
        data: {
          taskSessionId: input.mainSession.id,
          nodeAttemptId: input.attempt.id,
        },
      });
      const action = {
        action: "complete_manual_node" as const,
        expectedAttemptId: input.attempt.id,
        summary: "Generated report",
        deliverables: [{
          deliverableKey: "report",
          title: "Registered report",
          kind: "document" as const,
          source: { type: "generated_file" as const, uri: uri as `generated://${string}` },
        }],
      };
      await taskPlanExecution.submitNodeResult({
        taskId: input.taskId,
        commandContext: {
          runId: run.id,
          sessionId: input.executionSessionId,
          idempotencyKey: "artifact-result-submit",
        },
        action,
      });
      await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "complete_manual_node",
          expectedAttemptId: input.attempt.id,
          summary: "Done",
        },
        commandContext: {
          sessionId: input.executionSessionId,
          idempotencyKey: "artifact-result-replay",
        },
      });
      return {
        status: "started",
        summary: "External completion observed",
        evidence: { sessionId: input.mainSession.id },
      } satisfies NodeExecutionResult;
    });

    try {
      await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } });
      const artifacts = await db.artifact.findMany({ where: { taskId: task.id, runId: run.id } });
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        workspaceId: workspace.id,
        type: "file",
        title: "Registered report",
        uri,
        contentPreview: "# Registered report\n\nVerified content.\n",
      });
      expect(artifacts[0]?.metadata).toMatchObject({
        checksumAlgorithm: "sha256",
        size: 39,
        mimeType: "text/markdown",
        sourceNodeId: "task_node",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("passes the accumulated semantic manifest to the next runtime-backed node", async () => {
    executeTaskNodeCapabilityMock
      .mockImplementationOnce(async (input) => {
        await taskPlanExecution.submitNodeResult({
          taskId: input.taskId,
          commandContext: {
            sessionId: input.executionSessionId,
            idempotencyKey: "manifest-first-result",
          },
          action: {
            action: "complete_manual_node",
            expectedAttemptId: input.attempt.id,
            summary: "First task completed",
            findings: [{ key: "first-finding", content: "First finding" }],
          },
        });

        return {
          status: "started",
          summary: "Provider observed first task completion",
          evidence: { sessionId: input.mainSession.id },
        } satisfies NodeExecutionResult;
      })
      .mockImplementationOnce(async (input) => {
        expect(input.node.id).toBe("second_task");
        expect(input.planOutput?.manifest.findings).toMatchObject([
          { key: "first-finding", content: "First finding" },
        ]);

        return {
          status: "started",
          summary: "Second runtime run started",
          evidence: { sessionId: input.mainSession.id },
        } satisfies NodeExecutionResult;
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner passes accumulated manifest");
    const compiledPlan = makeTwoTaskPlan("graph_passes_accumulated_manifest");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("running");
    await waitForTaskNodeCalls(["first_task", "second_task"]);
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.planOutput.manifest.findings).toHaveLength(1);
  });

  it("continues to downstream work when a running task submits its own terminal result", async () => {
    executeTaskNodeCapabilityMock
      .mockImplementationOnce(async (input) => {
        const submittedResult = await taskPlanExecution.submitNodeResult({
          taskId: input.taskId,
          commandContext: {
            sessionId: input.executionSessionId,
            idempotencyKey: "downstream-first-result",
          },
          action: {
            action: "complete_manual_node",
            expectedAttemptId: input.attempt.id,
            summary: "Runtime tool completed first task",
            output: {
              root: "root",
              elements: {
                root: { type: "JsonView", props: { value: { source: "finalized_result" } } },
              },
            },
          },
        });
        expect(submittedResult.status).toBe("running");

        const activeSession = await db.executionSession.findFirstOrThrow({
          where: { taskId: input.taskId, status: "Active" },
          orderBy: { updatedAt: "desc" },
        });
        expect(activeSession.id).not.toBe("provider-runtime-session");
        expect(activeSession.currentNodeId).toBe("second_task");

        return {
          status: "started",
          summary: "Provider stream observed external task completion",
          evidence: { sessionId: input.mainSession.id },
          output: { runtimeRunRef: "runtime-first-stale-after-tool" },
        } satisfies NodeExecutionResult;
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { runId: "second-run" },
        output: { runtimeRunRef: "runtime-second" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner external terminal continuation");
    const compiledPlan = makeTwoTaskPlan("graph_external_terminal_continuation");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("running");
    await waitForTaskNodeCalls(["first_task", "second_task"]);

    expect(executeTaskNodeCapabilityMock.mock.calls.map((call) => call[0].node.id)).toEqual([
      "first_task",
      "second_task",
    ]);

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id, status: "Active" },
      orderBy: { updatedAt: "desc" },
    });
    expect(session.currentNodeId).toBe("second_task");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "running"],
    ]);
    expect(persisted?.results.find((result) => result.nodeId === "first_task")).toMatchObject({
      status: "current",
      outputSummary: "Runtime tool completed first task",
    });

    const normalizedFirstAttempt = await db.taskPlanNodeAttempt.findFirstOrThrow({
      where: { taskId: task.id, nodeId: "first_task" },
    });
    expect(normalizedFirstAttempt.status).toBe("succeeded");
    expect(normalizedFirstAttempt.finishedAt).toBeInstanceOf(Date);

    const runningProviderRows = await db.taskPlanProviderRun.count({
      where: { taskId: task.id, nodeAttemptId: normalizedFirstAttempt.id, status: "running" },
    });
    expect(runningProviderRows).toBe(0);
  });

  it("syncs normalized attempts when the terminal provider task completes through its own tool", async () => {
    executeTaskNodeCapabilityMock
      .mockImplementationOnce(async (input) => {
        await taskPlanExecution.submitNodeResult({
          taskId: input.taskId,
          commandContext: {
            sessionId: input.executionSessionId,
            idempotencyKey: "normalized-first-result",
          },
          action: {
            action: "complete_manual_node",
            expectedAttemptId: input.attempt.id,
            summary: "First task completed through terminal tool",
          },
        });

        return {
          status: "started",
          summary: "First provider run observed terminal tool",
          evidence: { sessionId: input.mainSession.id },
          output: { runtimeRunRef: "runtime-first-stale-after-tool" },
        } satisfies NodeExecutionResult;
      })
      .mockImplementationOnce(async (input) => {
        await taskPlanExecution.submitNodeResult({
          taskId: input.taskId,
          commandContext: {
            sessionId: input.executionSessionId,
            idempotencyKey: "normalized-second-result",
          },
          action: {
            action: "complete_manual_node",
            expectedAttemptId: input.attempt.id,
            summary: "Second task completed through terminal tool",
          },
        });

        return {
          status: "started",
          summary: "Second provider run observed terminal tool",
          evidence: { sessionId: input.mainSession.id },
          output: { runtimeRunRef: "runtime-second-stale-after-tool" },
        } satisfies NodeExecutionResult;
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner terminal provider completion syncs attempts");
    const compiledPlan = makeTwoTaskPlan("graph_terminal_provider_completion_sync");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("completed");
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "succeeded"],
    ]);

    const normalizedAttempts = await db.taskPlanNodeAttempt.findMany({
      where: { taskId: task.id },
      orderBy: { startedAt: "asc" },
    });
    expect(normalizedAttempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "succeeded"],
    ]);
    expect(normalizedAttempts.every((attempt) => attempt.finishedAt instanceof Date)).toBe(true);
  });

  it("submits condition branch selections through the unified graph command", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "done",
      summary: "Follow-up task completed",
      evidence: { runId: "follow-up-run" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner condition node result");
    const compiledPlan = makeManualThenTaskPlan("graph_condition_node_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const started = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(started.status).toBe("waiting_for_user");
    expect(started.currentNodeId).toBe("manual_task");

    const initial = await getPlanRun(task.id, compiledPlan.editablePlanId);
    const initialEffective = resolveEffectivePlanGraph({
      graph: initial!.graph!,
      attempts: initial!.attempts,
      results: initial!.results,
    });
    const branchRef = buildSemanticRefHistory(initialEffective).branchRefs.find(
      (binding) => binding.nodeId === "manual_task",
    )!.ref;
    const nodeRef = buildSemanticRefHistory(initialEffective).nodeRefs.find(
      (binding) => binding.nodeId === "manual_task",
    )!.ref;

    const activeSession = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });

    const branchSelected = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "complete_manual_node",
        nodeId: nodeRef,
        terminalKind: "condition",
        branchRef,
        summary: "Condition selected continue branch",
        continueExecution: false,
      },
      commandContext: {
        sessionId: activeSession.id,
        idempotencyKey: "condition-branch-result",
      },
    });

    expect(branchSelected.status).toBe("running");
    expect(branchSelected.currentNodeId).toBeNull();

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["manual_task", "succeeded"],
    ]);
    const manualResult = [...(persisted?.results ?? [])].reverse().find(
      (result) => result.nodeId === "manual_task" && result.status === "current",
    );
    expect(manualResult).toMatchObject({
      nodeId: "manual_task",
      status: "current",
      selectedBranch: {
        ref: branchRef,
        label: "continue",
        nextNodeId: "auto_task",
        source: "ai",
      },
    });
    const effectiveAfterSelection = resolveEffectivePlanGraph({
      graph: persisted!.graph!,
      attempts: persisted!.attempts,
      results: persisted!.results,
    });
    expect(effectiveAfterSelection.nodes.find((node) => node.id === "auto_task")).toMatchObject({
      ready: true,
      status: "ready",
    });

    const events = await db.event.findMany({
      where: { taskId: task.id },
      orderBy: { ingestSequence: "asc" },
      select: { actorType: true, eventType: true, nodeId: true, payload: true, rawEventId: true },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: "user",
          eventType: "plan_execution.node_result_submitted",
          nodeId: "manual_task",
          payload: expect.objectContaining({
            command: "complete_manual_node",
            actor: expect.objectContaining({ type: "user" }),
            origin: expect.objectContaining({ channel: "api" }),
            correlation: expect.objectContaining({ taskId: task.id, planId: compiledPlan.editablePlanId }),
          }),
        }),
      ]),
    );
    const resultEvents = events.filter(
      (event) => event.eventType === "plan_execution.node_result_submitted",
    );
    expect(new Set(resultEvents.map((event) => event.rawEventId)).size).toBe(resultEvents.length);
  });

  it("converges when an AI condition submits a branch through the graph command", async () => {
    evaluateConditionNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const planRun = await getPlanRun(input.taskId, "graph_ai_condition_command_result");
      const effective = resolveEffectivePlanGraph({
        graph: planRun!.graph!,
        attempts: planRun!.attempts,
        results: planRun!.results,
      });
      const branchRef = buildSemanticRefHistory(effective).branchRefs.find(
        (binding) => binding.nodeId === "ai_condition",
      )!.ref;

      await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "complete_manual_node",
          expectedAttemptId: input.attempt.id,
          terminalKind: "condition",
          branchRef,
          summary: "AI selected command branch",
          continueExecution: true,
        },
        commandContext: {
          sessionId: input.executionSessionId,
          idempotencyKey: "ai-condition-result",
        },
      });

      return {
        status: "done",
        summary: "Provider completion has no branch and must not drive graph state",
        evidence: { sessionId: input.mainSession.id, runId: "provider-without-branch" },
      } satisfies NodeExecutionResult;
    });
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "Auto task runtime run started",
      evidence: { runId: "auto-run" },
      output: { runtimeRunRef: "auto-run" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner AI condition command result");
    const compiledPlan = makeAiConditionThenTaskPlan("graph_ai_condition_command_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("running");
    expect(result.message).toBe("Current execution state.");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    const conditionResult = [...(persisted?.results ?? [])].reverse().find(
      (nodeResult) => nodeResult.nodeId === "ai_condition" && nodeResult.status === "current",
    );
    expect(conditionResult).toMatchObject({
      nodeId: "ai_condition",
      outputSummary: "AI selected command branch",
      selectedBranch: {
        label: "continue",
        nextNodeId: "auto_task",
        source: "ai",
      },
    });
    const effectiveAfterSelection = resolveEffectivePlanGraph({
      graph: persisted!.graph!,
      attempts: persisted!.attempts,
      results: persisted!.results,
    });
    expect(effectiveAfterSelection.nodes.find((node) => node.id === "auto_task")).toMatchObject({
      ready: false,
      status: "running",
    });
    const blockedEvent = await db.event.findFirst({
      where: { taskId: task.id, eventType: "plan_execution.node_blocked" },
    });
    expect(blockedEvent).toBeNull();
  });

  it("does not let a provider started result overwrite an external blocked result", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const submittedResult = await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "block_current_node",
          expectedAttemptId: input.attempt.id,
          reason: "Hermes blocked externally",
          actionForm: {
            instructions: "Provide missing Hermes credentials.",
            inputFields: [{ name: "hermesToken", label: "Hermes token", type: "text", required: true }],
          },
        },
        commandContext: {
          sessionId: input.executionSessionId,
          idempotencyKey: "external-block-result",
        },
      });
      expect(submittedResult.status).toBe("blocked");

      return {
        status: "started",
        summary: "Hermes run started before external block was observed",
        evidence: { sessionId: input.mainSession.id },
        output: { runtimeRunRef: "hermes-run-stale-blocked" },
      } satisfies NodeExecutionResult;
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner preserves external block");
    const compiledPlan = makeSingleTaskPlan("graph_task_external_block_race");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("blocked");
    expect(result.currentNodeId).toBe("task_node");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results).toHaveLength(1);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "current",
      error: "Hermes blocked externally",
      waitKind: "manual_action",
      actionForm: {
        instructions: "Provide missing Hermes credentials.",
        inputFields: [{ name: "hermesToken", label: "Hermes token", type: "text", required: true }],
      },
    });
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]).toMatchObject({
      nodeId: "task_node",
      status: "failed",
    });

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Paused");
    expect(session.currentNodeId).toBe("task_node");

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Blocked);
  });

  it("persists detailed runtime failure context for a failed task node", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "failed",
      error: "Runtime failed while starting main session run for node task_node: Gateway refused the run",
      evidence: {
        sessionId: "main-session",
        runId: "run_failed",
        runtimeName: "hermes",
        runtimeRunRef: "resp_failed",
      },
      details: {
        nodeId: "task_node",
        nodeTitle: "Execute task",
        runtimeName: "hermes",
        runtimeRunRef: "resp_failed",
        runId: "run_failed",
        errorSummary: "Gateway refused the run",
      },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner preserves failure details");
    const compiledPlan = makeSingleTaskPlan("graph_task_failed_details");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("failed");
    expect(result.message).toBe("Plan execution failed.");
    expect("errorDetails" in result).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/Gateway refused|resp_failed|run_failed/);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts[0]?.error).toMatchObject({
      code: "NODE_FAILED",
      message: expect.stringContaining("Gateway refused the run"),
      details: expect.objectContaining({ runtimeRunRef: "resp_failed" }),
    });
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "rejected",
      error: expect.stringContaining("Gateway refused the run"),
      errorDetails: expect.objectContaining({ runtimeName: "hermes" }),
    });
  });

  it("does not leave session or attempt running when provider cancels a task node", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "failed",
      error: "Provider cancelled runtime run codex-run-cancelled",
      evidence: {
        sessionId: "main-session",
        runId: "run_cancelled",
        runtimeName: "hermes",
        runtimeRunRef: "codex-run-cancelled",
      },
      details: {
        nodeId: "task_node",
        nodeTitle: "Execute mocked task node",
        runtimeName: "hermes",
        runtimeRunRef: "codex-run-cancelled",
        runId: "run_cancelled",
      },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner handles provider cancellation");
    const compiledPlan = makeSingleTaskPlan("graph_task_cancelled_provider");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("failed");
    expect(result.message).toBe("Plan execution failed.");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts[0]).toMatchObject({
      nodeId: "task_node",
      status: "failed",
    });
    const normalizedAttempt = await db.taskPlanNodeAttempt.findFirstOrThrow({
      where: { taskId: task.id, nodeId: "task_node" },
      select: { status: true, finishedAt: true },
    });
    expect(normalizedAttempt.status).toBe("failed");
    expect(normalizedAttempt.finishedAt).toBeInstanceOf(Date);
    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).not.toBe("Active");
    expect(session.currentNodeId).toBe("task_node");
  });

  it("ignores late node result reports after execution completed", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "done",
      summary: "Task completed",
      evidence: { sessionId: "main-session", runId: "run_complete" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner late node result");
    const compiledPlan = makeSingleTaskPlan("graph_late_node_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const completed = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(completed.status).toBe("completed");

    const completedSession = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });

    const lateBlocked = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "block_current_node",
        reason: "MCP session binding fallback after verified completion",
      },
      commandContext: {
        sessionId: completedSession.id,
        idempotencyKey: "late-blocked-result",
      },
    });

    expect(lateBlocked.status).toBe("completed");
    expect(lateBlocked.message).toBe("Execution already completed; node result ignored.");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.error])).toEqual([
      ["task_node", "current", undefined],
    ]);

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
    expect(updatedTask.blockReason).toBeNull();
  });
  it("replays a recorded terminal action after process loss and completes the task exactly once", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "Provider run remains active until its terminal action is committed",
      evidence: { sessionId: "provider-session", runId: "provider-run" },
      output: { runtimeRunRef: "runtime-interrupted-terminal" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Recorded terminal restart recovery");
    const compiledPlan = makeSingleTaskPlan("graph_recorded_terminal_restart_recovery");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const started = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(started.status).toBe("running");

    const attempt = await db.taskPlanNodeAttempt.findFirstOrThrow({
      where: { taskId: task.id, nodeId: "task_node", status: "running" },
    });
    const run = await db.run.create({
      data: {
        taskId: task.id,
        taskSessionId: (await db.taskSession.findFirstOrThrow({
          where: { taskId: task.id },
          orderBy: { createdAt: "desc" },
        })).id,
        nodeAttemptId: attempt.id,
        runtimeName: "hermes",
        runtimeRunRef: "runtime-interrupted-terminal",
        status: "Running",
        startedAt: new Date(),
        triggeredBy: "system",
        syncStatus: "healthy",
      },
    });
    const mainSession = await db.taskSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });
    await db.taskPlanProviderRun.create({
      data: {
        runId: run.id,
        workspaceId: workspace.id,
        taskId: task.id,
        planId: compiledPlan.editablePlanId,
        planRunId: attempt.planRunId,
        nodeAttemptId: attempt.id,
        idempotencyKey: `provider-run:${attempt.id}`,
        providerRunRef: "runtime-interrupted-terminal",
        runtimeName: "hermes",
        status: "running",
      },
    });
    await db.taskPlanTerminalAction.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        taskSessionId: mainSession.id,
        runtimeSessionKey: mainSession.sessionKey,
        nodeId: "task_node",
        nodeAttemptId: attempt.id,
        kind: "complete",
        payload: { summary: "Recovered durable completion" },
      },
    });

    const first = await recoverRecordedTerminalActions({ taskId: task.id });
    const second = await recoverRecordedTerminalActions({ taskId: task.id });

    expect(first).toEqual({ checked: 1, recovered: 1, skipped: 0, failed: 0 });
    expect(second).toEqual({ checked: 0, recovered: 0, skipped: 0, failed: 0 });
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("Completed");
    expect((await db.executionSession.findFirstOrThrow({ where: { taskId: task.id } })).status).toBe("Completed");
    expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("Completed");
    expect((await db.taskPlanNodeAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("succeeded");
    expect((await db.taskPlanProviderRun.findFirstOrThrow({ where: { nodeAttemptId: attempt.id } })).status).toBe("completed");
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.find((result) => result.nodeId === "task_node")).toMatchObject({
      status: "current",
      outputSummary: "Recovered durable completion",
    });
  });

});

async function waitForTaskNodeCalls(expectedNodeIds: string[]) {
  const expected = JSON.stringify(expectedNodeIds);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const actual = JSON.stringify(
      executeTaskNodeCapabilityMock.mock.calls.map((call) => call[0].node.id),
    );
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeAiConditionThenTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `AI condition handoff ${editablePlanId}`,
    goal: "AI condition submits branch through graph command",
    assumptions: [],
    nodes: [
      {
        id: "ai_condition",
        localId: "ai_condition",
        type: "condition",
        title: "AI condition",
        description: "AI condition terminal tool selects branch",
        config: {
          condition: "Choose whether to continue",
          evaluationBy: "ai",
          branches: [{ label: "continue", nextNodeId: "auto_task" }],
        } satisfies ConditionConfig,
        dependencies: [],
        dependents: ["auto_task"],
        executor: "ai",
      },
      {
        id: "auto_task",
        localId: "auto_task",
        type: "task",
        title: "Automatic follow-up",
        description: "Should be ready after condition command result",
        config: { expectedOutput: "Automatic output" } satisfies TaskConfig,
        dependencies: ["ai_condition"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [{ id: "edge_ai_condition_to_auto", from: "ai_condition", to: "auto_task" }],
    entryNodeIds: ["ai_condition"],
    terminalNodeIds: ["auto_task"],
    topologicalOrder: ["ai_condition", "auto_task"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}
