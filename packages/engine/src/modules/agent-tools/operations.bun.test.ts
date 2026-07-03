import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import type { PlanBlueprint } from "@chrona/contracts";
import { PlanCompileError } from "@chrona/contracts/ai";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { createChronaEngine } from "../../engine";
import { createAgentToolOperationsService } from "./operations";

function service(input: { materialize?: (input: Record<string, unknown>) => Promise<unknown> } = {}) {
  const calls = {
    planGenerate: 0,
    planPatch: 0,
    taskUpdate: 0,
    dispatchActions: [] as unknown[],
    submittedNodeResults: [] as unknown[],
  };
  const task = {
    id: "task-1",
    title: "Build MCP tools",
    status: "Ready",
    priority: "High",
  };
  const agentTools = createAgentToolOperationsService({
    tasks: {
      create: async () => ({ task }),
      update: async () => {
        calls.taskUpdate += 1;
        return { task: { ...task, title: "Updated" } };
      },
      delete: async () => ({}),
      getPage: async () => ({ task }),
      list: async () => ({ tasks: [task] }),
    },
    plan: {
      getState: async () => ({
        taskId: task.id,
        aiPlanGenerationStatus: "accepted" as const,
        savedPlan: { id: "plan-1", revision: 2, status: "Accepted" },
        generationSession: null,
      }),
      getActiveGeneration: () => ({ generationSession: null }),
      getGenerationSession: () => ({ generationSession: null }),
      subscribeToActiveGeneration: () => null,
      subscribeToGeneration: () => null,
      accept: async () => ({ savedPlan: null }),
      materialize: input.materialize ?? (async (input: Record<string, unknown>) => {
        calls.planGenerate += 1;
        return {
          id: "plan-generated",
          planId: "plan-generated",
          revision: 1,
          status: "draft",
          summary: (input.blueprint as { title?: string }).title,
        };
      }),
      generate: () => { throw new Error("unused"); },
      stopGeneration: () => ({ taskId: task.id, stopped: false }),
      patch: async (input: Record<string, unknown>) => {
        calls.planPatch += 1;
        return { ...input, savedPlan: { id: "plan-1", revision: 3, status: "Accepted" } };
      },
      mutate: async (input: Record<string, unknown>) => {
        calls.planPatch += 1;
        return { ...input, revision: 3 };
      },
    },
    schedule: {
      apply: async () => ({ task: { ...task, scheduledStartAt: "start" } }),
      clear: async () => ({ task }),
      propose: async () => ({ proposalId: "proposal-1" }),
      decideProposal: async () => ({ proposalId: "proposal-1" }),
    },
    execution: {
      dispatch: async (input: unknown) => {
        calls.dispatchActions.push((input as { action?: unknown }).action);
        return { result: { status: "running", sessionId: "session-1" } };
      },
      submitNodeResult: async (input: unknown) => {
        calls.submittedNodeResults.push((input as { action?: unknown }).action);
        return { result: { status: "running", sessionId: "session-1" } };
      },
      syncRuntimeResult: async () => ({}),
    },
  } as unknown as Parameters<typeof createAgentToolOperationsService>[0]) as ReturnType<typeof createAgentToolOperationsService> & { calls: typeof calls };

  (agentTools as { calls: typeof calls }).calls = calls;
  return agentTools;
}

function serviceWithDispatchError(code: keyof typeof ENGINE_ERROR_CODES) {
  return createAgentToolOperationsService({
    tasks: {
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      getPage: async () => ({ task: { id: "task-1", status: "Ready" } }),
      list: async () => ({ tasks: [] }),
    },
    plan: {
      getState: async () => ({ taskId: "task-1", aiPlanGenerationStatus: "accepted", savedPlan: null, generationSession: null }),
      getActiveGeneration: () => ({ generationSession: null }),
      getGenerationSession: () => ({ generationSession: null }),
      subscribeToActiveGeneration: () => null,
      subscribeToGeneration: () => null,
      accept: async () => ({ savedPlan: null }),
      generate: () => { throw new Error("unused"); },
      stopGeneration: () => ({ taskId: "task-1", stopped: false }),
      patch: async () => ({}),
      mutate: async () => ({}),
    },
    schedule: {
      apply: async () => ({}),
      clear: async () => ({}),
      propose: async () => ({}),
      decideProposal: async () => ({}),
    },
    execution: {
      dispatch: async () => {
        throw new EngineError(ENGINE_ERROR_CODES[code], "Mapped failure");
      },
      submitNodeResult: async () => {
        throw new EngineError(ENGINE_ERROR_CODES[code], "Mapped failure");
      },
      syncRuntimeResult: async () => ({}),
    },
  } as unknown as Parameters<typeof createAgentToolOperationsService>[0]);
}

async function seedNodeToolAuditRuntime(taskId: string) {
  await db.taskSession.create({
    data: {
      id: "task-session-audit",
      taskId,
      runtimeName: "hermes",
      sessionKey: "runtime-session-audit",
      label: "Audit session",
    },
  });
  await db.run.create({
    data: {
      id: "run-audit",
      taskId,
      taskSessionId: "task-session-audit",
      runtimeName: "hermes",
      runtimeRunRef: "runtime-run-audit",
      runtimeSessionRef: "runtime-session-audit",
      status: "Running",
      triggeredBy: "agent",
    },
  });
  await db.taskPlanProviderRun.create({
    data: {
      id: "provider-run-audit",
      workspaceId: "workspace-audit",
      taskId,
      planId: "plan-audit",
      planRunId: "plan-run-audit",
      nodeAttemptId: "attempt-condition",
      idempotencyKey: "provider-run-key",
      providerRunRef: "runtime-run-audit",
      runtimeName: "hermes",
      status: "running",
      correlationId: "provider-run-audit",
      startedAt: new Date(),
    },
  });
}

function testBlueprint(title: string): PlanBlueprint {
  return {
    title,
    goal: title,
    nodes: [
      { id: "fetch_trending", type: "task", title: "Fetch GitHub trending", expectedOutput: "Trending list" },
    ],
    edges: [],
  };
}

async function resetDb() {
  await db.toolInvocation.deleteMany();
  await db.rawEventLog.deleteMany();
  await db.executionSession.deleteMany();
  await db.taskPlanProviderRun.deleteMany();
  await db.taskPlanNodeAttempt.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.event.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskSession.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedNodeToolAuditFixture() {
  const workspace = await db.workspace.create({
    data: { id: "workspace-audit", name: "Audit Workspace", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      id: "task-audit",
      workspaceId: workspace.id,
      title: "Audit task",
      status: "Ready",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
    },
  });
  await db.taskPlan.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: "plan-audit",
      revision: 1,
      status: "Accepted",
      compiledPlan: {},
    },
  });
  await db.taskPlanRun.create({
    data: {
      id: "plan-run-audit",
      workspaceId: workspace.id,
      taskId: task.id,
      planId: "plan-audit",
      planRun: { mutableGraph: { graph: { nodes: [{ id: "node-condition", title: "Choose branch" }] } } },
    },
  });
  await db.executionSession.create({
    data: {
      id: "execution-session-audit",
      workspaceId: workspace.id,
      taskId: task.id,
      planId: "plan-audit",
      status: "Active",
      currentNodeId: "node-condition",
      currentNodeAttemptId: "attempt-condition",
      startedAt: new Date(),
    },
  });
  await db.taskPlanNodeAttempt.create({
    data: {
      id: "attempt-condition",
      workspaceId: workspace.id,
      taskId: task.id,
      planId: "plan-audit",
      planRunId: "plan-run-audit",
      nodeId: "node-condition",
      nodeLayerId: "layer-condition",
      idempotencyKey: "attempt-condition-key",
      attemptNumber: 1,
      status: "running",
      executionEpoch: 1,
      startedAt: new Date(),
    },
  });
  await seedNodeToolAuditRuntime(task.id);
  return task;
}

describe("agent tool operations service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("returns registry metadata", () => {
    expect(service().registry().tools.map((tool) => tool.name)).toContain("chrona.plan.generate");
  });

  it("executes read and mutating task tools through Chrona services", async () => {
    await expect(
      service().execute({
        toolName: "chrona.task.read",
        input: { workspaceId: "workspace-1", taskId: "task-1", actorType: "agent" },
      }),
    ).resolves.toMatchObject({ status: "accepted", state: { taskStatus: "Ready" } });

    await expect(
      service().execute({
        toolName: "chrona.task.update",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          actorType: "agent",
          idempotencyKey: "update-1",
          payload: { title: "Updated" },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted", state: { taskTitle: "Updated" } });
  });

  it("resolves Hermes-injected sessionId to task and workspace context", async () => {
    const workspace = await db.workspace.create({
      data: { name: "MCP Session Workspace", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Session mapped task",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.taskSession.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        sessionKey: "chrona:task:task-1:execute",
        label: "Execution session",
      },
    });

    const agentTools = service();
    const resolved = await agentTools.resolveInputContext({
      sessionId: "chrona:task:task-1:execute",
      actorType: "agent",
    });

    expect(resolved).toMatchObject({
      workspaceId: workspace.id,
      taskId: task.id,
      sessionId: "chrona:task:task-1:execute",
    });

    await expect(agentTools.resolveInputContext({
      sessionId: resolved.taskId ? (await db.taskSession.findFirstOrThrow()).id : "missing",
      actorType: "agent",
    })).resolves.toMatchObject({
      workspaceId: workspace.id,
      taskId: task.id,
    });
  });

  it("resolves runtime run refs to task and workspace context", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Runtime Ref Workspace", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Runtime mapped task",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        runtimeRunRef: "hermes-run-1",
        runtimeSessionRef: "hermes-session-1",
        status: "Running",
        triggeredBy: "agent",
      },
    });

    await expect(service().resolveInputContext({
      sessionId: "hermes-run-1",
      actorType: "agent",
    })).resolves.toMatchObject({
      workspaceId: workspace.id,
      taskId: task.id,
      sessionId: "hermes-run-1",
    });
  });

  it("uses the default workspace for task creation without model-supplied workspaceId", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Default MCP Workspace", status: "Active", defaultRuntime: "hermes" },
    });

    const resolved = await service().resolveInputContext({
      sessionId: "chrona:hermes:create:task",
      actorType: "agent",
    });

    expect(resolved).toMatchObject({
      workspaceId: workspace.id,
      sessionId: "chrona:hermes:create:task",
    });
  });

  it("rejects missing idempotency keys and stale expected revisions without writes", async () => {
    const agentTools = service();
    await expect(
      agentTools.execute({
        toolName: "chrona.task.update",
        input: { workspaceId: "workspace-1", taskId: "task-1", actorType: "agent", payload: { title: "Updated" } },
      }),
    ).resolves.toMatchObject({ status: "rejected", reasonCode: "VALIDATION_ERROR" });

    await expect(
      agentTools.execute({
        toolName: "chrona.plan.read",
        input: { workspaceId: "workspace-1", taskId: "task-1", actorType: "agent", expectedRevision: 1 },
      }),
    ).resolves.toMatchObject({ status: "rejected", reasonCode: "STALE_STATE" });

    await expect(
      agentTools.execute({
        toolName: "chrona.task.update",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          actorType: "agent",
          idempotencyKey: "stale-task-update",
          expectedRevision: 1,
          payload: { title: "Updated" },
        },
      }),
    ).resolves.toMatchObject({ status: "rejected", reasonCode: "STALE_STATE" });
    expect(agentTools.calls.taskUpdate).toBe(0);
  });

  it("passes plan mutations to the existing plan patch command", async () => {
    const agentTools = service();

    await expect(
      agentTools.execute({
        toolName: "chrona.plan.mutate",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          actorType: "agent",
          idempotencyKey: "plan-mutate-1",
          expectedRevision: 2,
          payload: {
            reason: "Rename node",
            operations: [
              {
                type: "push_node_layer",
                nodeId: "node-1",
                layer: {
                  id: "layer-1",
                  nodeId: "node-1",
                  type: "definition",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  createdBy: "ai",
                  definition: {
                    title: "Renamed",
                    objective: "Renamed objective",
                    semantics: { type: "task" },
                  },
                },
              },
            ],
          },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted", state: { planRevision: 3 } });
    expect(agentTools.calls.planPatch).toBe(1);
  });

  it("persists Hermes-generated plan graphs through the plan service", async () => {
    const agentTools = service();

    await expect(
      agentTools.execute({
        toolName: "chrona.plan.generate",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          actorType: "agent",
          idempotencyKey: "plan-generate-1",
          payload: {
            title: "Generated MCP plan",
            goal: "Save complete plan graph",
            nodes: [
              {
                id: "first_step",
                type: "task",
                title: "First step",
              },
            ],
            edges: [],
          },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted", state: { planRevision: 1 } });
    expect(agentTools.calls.planGenerate).toBe(1);
  });

  it("reproduces MCP plan generation saving to previous occurrence when only sessionId identifies the run", async () => {
    const engine = createChronaEngine();
    const workspace = await db.workspace.create({
      data: { name: "MCP recurring scope", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Fetch GitHub trending",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    const previousWorkBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        recurrenceKey: "2026-06-05T14:00:00.000Z",
        title: "Fetch GitHub trending · 6.5",
        status: "Completed",
        scheduledStartAt: new Date("2026-06-05T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-05T15:00:00.000Z"),
        trigger: "scheduled",
      },
    });
    const targetWorkBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        recurrenceKey: "2026-06-06T14:00:00.000Z",
        title: "Fetch GitHub trending · 6.6",
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-06T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-06T15:00:00.000Z"),
        trigger: "scheduled",
      },
    });

    await engine.tasks.plan.materialize({
      taskId: task.id,
      workspaceId: workspace.id,
      workBlockId: previousWorkBlock.id,
      blueprint: testBlueprint("Accepted 6.5 plan"),
      generatedBy: "test",
    });
    await db.taskPlan.updateMany({
      where: { taskId: task.id, workBlockId: previousWorkBlock.id },
      data: { status: "Accepted" },
    });

    const taskSession = await db.taskSession.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        sessionKey: "provider-session-for-6-6",
        label: "6.6 plan generation session",
      },
    });
    await db.workBlock.update({
      where: { id: targetWorkBlock.id },
      data: { sessionId: taskSession.id },
    });

    const input = await engine.agentTools.resolveInputContext({
      sessionId: taskSession.sessionKey,
      actorType: "agent",
      idempotencyKey: `generate-6-6-${task.id}`,
      payload: testBlueprint("Generated 6.6 plan"),
    });

    await expect(
      engine.agentTools.execute({
        toolName: "chrona.plan.generate",
        input,
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    const generatedPlan = await db.taskPlan.findFirstOrThrow({
      where: { taskId: task.id, summary: "Generated 6.6 plan" },
      select: { workBlockId: true },
    });
    expect(generatedPlan.workBlockId).toBe(targetWorkBlock.id);
  });

  it("returns plan compile issues when generated graphs are invalid", async () => {
    const issue = { path: "edges", message: "Plan graph must be a DAG" };
    const agentTools = service({ materialize: async () => {
      throw new PlanCompileError("Plan blueprint compilation failed", [issue]);
    } });

    await expect(
      agentTools.execute({
        toolName: "chrona.plan.generate",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          actorType: "agent",
          idempotencyKey: "plan-generate-invalid-graph",
          payload: {
            title: "Invalid MCP plan",
            goal: "Expose compile diagnostics",
            nodes: [
              { id: "first_step", type: "task", title: "First step" },
              { id: "second_step", type: "task", title: "Second step" },
            ],
            edges: [
              { from: "first_step", to: "second_step" },
              { from: "second_step", to: "first_step" },
            ],
          },
        },
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reasonCode: "VALIDATION_ERROR",
      message: "Plan blueprint compilation failed: edges: Plan graph must be a DAG",
      recovery: { nextTool: "chrona.plan.read", details: { issues: [issue] } },
      evidence: { validationIssues: [issue] },
    });
  });

  it("maps node terminal tools to execution dispatch with model-supplied condition node ids", async () => {
    const agentTools = service();

    await expect(
      agentTools.execute({
        toolName: "chrona.plan.output",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          sessionId: "session-1",
          actorType: "agent",
          idempotencyKey: "plan-output-1",
          payload: { patches: [{ op: "add", path: "/root", value: "root" }] },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    await expect(
      agentTools.execute({
        toolName: "chrona.node.complete",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          sessionId: "session-1",
          actorType: "agent",
          idempotencyKey: "node-complete-1",
          payload: { summary: "Done" },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    await expect(
      agentTools.execute({
        toolName: "chrona.node.condition_select",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          sessionId: "session-1",
          actorType: "agent",
          idempotencyKey: "node-condition-select-1",
          payload: { nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Condition met" },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    await expect(
      agentTools.execute({
        toolName: "chrona.node.block",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          sessionId: "session-1",
          actorType: "agent",
          idempotencyKey: "node-block-1",
          payload: {
            reason: "Waiting on dependency",
            actionForm: {
              instructions: "Provide the dependency status update.",
              inputFields: [{ name: "dependencyStatus", label: "Dependency status", type: "textarea", required: true }],
            },
          },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    await expect(
      agentTools.execute({
        toolName: "chrona.node.fail",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          sessionId: "session-1",
          actorType: "agent",
          idempotencyKey: "node-fail-1",
          payload: { error: "Command failed" },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    expect(agentTools.calls.dispatchActions).toEqual([]);
    expect(agentTools.calls.submittedNodeResults).toEqual([
      {
        action: "update_plan_output",
        sessionId: "session-1",
        patches: [{ op: "add", path: "/root", value: "root" }],
      },
      {
        action: "complete_manual_node",
        sessionId: "session-1",
        summary: "Done",
        output: undefined,
        terminalKind: "task",
      },
      {
        action: "complete_manual_node",
        sessionId: "session-1",
        nodeId: "condition-node",
        summary: "Condition met",
        terminalKind: "condition",
        branchRef: "B20260516-01-A",
      },
      {
        action: "block_current_node",
        sessionId: "session-1",
        reason: "Waiting on dependency",
        actionForm: {
          instructions: "Provide the dependency status update.",
          inputFields: [{ name: "dependencyStatus", label: "Dependency status", type: "textarea", required: true }],
        },
      },
      {
        action: "fail_current_node",
        sessionId: "session-1",
        error: "Command failed",
      },
    ]);
  });

  it("persists validated dashboard brief result only on dashboard tool accepted state", async () => {
    await db.workspace.create({
      data: { id: "workspace-dashboard-tool", name: "Dashboard tool workspace", status: "Active", defaultRuntime: "codex" },
    });

    const result = await service().execute({
      toolName: "chrona.dashboard.brief",
      input: {
        workspaceId: "workspace-dashboard-tool",
        sessionId: "workspace:workspace-dashboard-tool:dashboard.brief:fingerprint",
        actorType: "agent",
        idempotencyKey: "dashboard-brief-tool",
        payload: {
          summaryText: "Needs review",
          spec: {
            root: "root",
            elements: {
              root: { type: "Text", props: { content: "One task needs review.", variant: "small" }, children: [] },
            },
          },
        },
      },
    });

    expect(result).toMatchObject({
      status: "accepted",
      state: {
        result: {
          summaryText: "Needs review",
          spec: {
            root: "root",
            elements: { root: { props: { text: "One task needs review.", variant: "caption" } } },
          },
        },
      },
    });
    const invocation = await db.toolInvocation.findFirstOrThrow({
      where: { toolName: "chrona.dashboard.brief", workspaceId: "workspace-dashboard-tool" },
    });
    expect(invocation.outputPayload).toMatchObject({
      state: {
        result: {
          summaryText: "Needs review",
          spec: {
            root: "root",
            elements: { root: { props: { text: "One task needs review.", variant: "caption" } } },
          },
        },
      },
    });
  });

  it("correlates node tool audit records to the active plan node attempt", async () => {
    const task = await seedNodeToolAuditFixture();

    await expect(
      service().execute({
        toolName: "chrona.node.condition_select",
        input: {
          workspaceId: "workspace-audit",
          taskId: task.id,
          sessionId: "runtime-session-audit",
          actorType: "agent",
          idempotencyKey: "condition-audit-key",
          payload: { nodeId: "node-condition", branchRef: "branch-a", summary: "Select A" },
        },
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    const invocation = await db.toolInvocation.findFirstOrThrow({
      where: { toolName: "chrona.node.condition_select", taskId: task.id },
    });
    expect(invocation).toMatchObject({
      runId: "run-audit",
      executionSessionId: "execution-session-audit",
      planId: "plan-audit",
      planRunId: "plan-run-audit",
      nodeAttemptId: "attempt-condition",
      providerRunId: "provider-run-audit",
      nodeId: "node-condition",
    });

    const raw = await db.rawEventLog.findFirstOrThrow({
      where: { id: invocation.inputRawEventId ?? undefined },
    });
    expect(raw).toMatchObject({
      planId: "plan-audit",
      planRunId: "plan-run-audit",
      nodeAttemptId: "attempt-condition",
      providerRunId: "provider-run-audit",
      nodeId: "node-condition",
    });

    const selected = await db.event.findFirstOrThrow({
      where: { eventType: "condition.selected", taskId: task.id },
    });
    expect(selected).toMatchObject({
      planId: "plan-audit",
      planRunId: "plan-run-audit",
      nodeAttemptId: "attempt-condition",
      providerRunId: "provider-run-audit",
      nodeId: "node-condition",
    });
  });

  it("replays duplicate mutating operations without duplicate side effects", async () => {
    const agentTools = service();
    const operation = {
      toolName: "chrona.task.update" as const,
      input: {
        workspaceId: "workspace-1",
        taskId: "task-1",
        actorType: "agent" as const,
        idempotencyKey: "same-key",
        payload: { title: "Updated" },
      },
    };

    await expect(agentTools.execute(operation)).resolves.toMatchObject({ status: "accepted" });
    await expect(agentTools.execute(operation)).resolves.toMatchObject({
      status: "noop",
      reasonCode: "DUPLICATE_OPERATION",
      idempotency: "replayed",
    });
  });

  it("maps engine failures to structured rejection reason codes", async () => {
    await expect(
      serviceWithDispatchError("TASK_NOT_FOUND").execute({
        toolName: "chrona.execution.dispatch",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          actorType: "agent",
          idempotencyKey: "missing-task",
          payload: { action: "start_manual" },
        },
      }),
    ).resolves.toMatchObject({ status: "rejected", reasonCode: "NOT_FOUND", auditRef: expect.any(String) });

    await expect(
      serviceWithDispatchError("CONFLICT").execute({
        toolName: "chrona.execution.dispatch",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          actorType: "agent",
          idempotencyKey: "conflict",
          payload: { action: "start_manual" },
        },
      }),
    ).resolves.toMatchObject({ status: "rejected", reasonCode: "CONFLICT" });
  });

  it("keeps provider traces and structured output as evidence only", async () => {
    await expect(
      service().execute({
        toolName: "chrona.task.update",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          actorType: "agent",
          idempotencyKey: "evidence-only",
          payload: { title: "Updated" },
          evidence: {
            providerText: "Final answer claims task is Done.",
            toolCalls: [{ tool: "chrona.task.update", callId: "call-1" }],
            toolOutputs: [{ callId: "call-1", status: "accepted" }],
            structuredOutput: { taskTitle: "Provider title", taskStatus: "Done" },
          },
        },
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      state: { taskTitle: "Updated", taskStatus: "Ready" },
      evidence: {
        providerText: "Final answer claims task is Done.",
        structuredOutput: { taskTitle: "Provider title", taskStatus: "Done" },
      },
    });
  });
});
