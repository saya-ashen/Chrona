import { describe, expect, it } from "vitest";
import { compiledPlanToGraphPlan, taskPlanReadModelToGraphPlan } from "@/components/tasks/plan/task-plan-view-model";
import type { CompiledPlan, TaskPlanReadModel } from "@chrona/contracts/ai";

const compiledPlan: CompiledPlan = {
  id: "compiled-plan-1",
  editablePlanId: "plan-1",
  sourceVersion: 2,
  title: "做汉堡",
  goal: "完成午餐",
  assumptions: [],
  nodes: [
    {
      id: "condition-1",
      localId: "condition_local",
      type: "condition",
      title: "是否加芝士",
      config: {
        condition: "用户是否要芝士",
        evaluationBy: "user",
        branches: [
          { label: "是", nextNodeId: "task_add_cheese" },
          { label: "否", nextNodeId: "task_skip_cheese" },
        ],
        defaultNextNodeId: "task_skip_cheese",
      },
      dependencies: [],
      dependents: ["task-yes", "task-no"],
    },
    {
      id: "task-yes",
      localId: "task_add_cheese",
      type: "task",
      title: "加芝士",
      config: { expectedOutput: "加好芝士" },
      dependencies: ["condition-1"],
      dependents: [],
      executor: "user",
      mode: "manual",
    },
  ],
  edges: [
    { id: "edge-yes", from: "condition-1", to: "task-yes", label: "是" },
  ],
  entryNodeIds: ["condition-1"],
  terminalNodeIds: ["task-yes"],
  topologicalOrder: ["condition-1", "task-yes"],
  completionPolicy: { type: "all_tasks_completed" },
  validationWarnings: [],
};

describe("task-plan-view-model", () => {
  it("preserves condition metadata and edge labels for compiled plans", () => {
    const graphPlan = compiledPlanToGraphPlan(compiledPlan);

    expect(graphPlan?.steps[0]?.metadata).toMatchObject({
      condition: "用户是否要芝士",
      evaluationBy: "user",
    });
    expect(graphPlan?.steps[0]?.metadata?.branches).toEqual([
      { label: "是", nextNodeId: "task_add_cheese" },
      { label: "否", nextNodeId: "task_skip_cheese" },
    ]);
    expect(graphPlan?.edges?.[0]?.label).toBe("是");
  });

  it("models confirm checkpoints as approval decisions", () => {
    const graphPlan = compiledPlanToGraphPlan({
      ...compiledPlan,
      nodes: [
        {
          id: "checkpoint-1",
          localId: "confirm_scope",
          type: "checkpoint",
          title: "确认需求范围",
          config: {
            checkpointType: "confirm",
            prompt: "是否确认当前需求范围？",
            required: true,
          },
          dependencies: [],
          dependents: [],
        },
      ],
      edges: [],
      entryNodeIds: ["checkpoint-1"],
      terminalNodeIds: ["checkpoint-1"],
      topologicalOrder: ["checkpoint-1"],
    });

    expect(graphPlan?.steps[0]).toMatchObject({
      interactionType: "confirm",
      availableActions: [{ label: "审批", kind: "approve" }],
      interactiveFields: [
        {
          key: "checkpoint:decision",
          label: "审批决策",
          control: "approval",
          required: true,
          options: ["Approve", "Reject"],
        },
      ],
    });
  });

  it("uses effective plan runtime status and active labeled edges from read model", () => {
    const readModel: TaskPlanReadModel = {
      id: "plan-1",
      status: "accepted",
      revision: 2,
      prompt: null,
      summary: "午餐计划",
      updatedAt: "2026-05-07T10:00:00.000Z",
      generatedBy: "ai",
      blueprint: {
        title: "做汉堡",
        goal: "完成午餐",
        assumptions: [],
        nodes: [],
        edges: [],
      },
      compiledPlan,
      effectivePlan: {
        graphId: "graph-1",
        planId: "plan-1",
        basePlanId: "compiled-plan-1",
        resolvedAt: "2026-05-07T10:00:00.000Z",
        resolvedVersion: 3,
        nodes: [
          {
            id: "condition-1",
            nodeId: "condition-1",
            activeLayerId: null,
            semanticKey: "condition-1",
            localId: "condition_local",
            type: "condition",
            title: "是否加芝士",
            definition: {
              title: "是否加芝士",
              objective: "用户是否要芝士",
              semantics: { type: "condition" },
            },
            config: compiledPlan.nodes[0]!.config,
            dependencies: [],
            dependents: ["task-yes"],
            status: "completed",
            invalidated: false,
            attempts: 1,
            metadata: {},
            dependenciesSatisfied: true,
            ready: false,
            reachable: true,
            result: {
              outputSummary: "选择了是",
              outputs: [{ kind: "json", value: { selectedBranch: "是" } }],
              evidence: { runId: "run-1", runtimeRunRef: "runtime-ref-1" },
              selectedBranch: { label: "是", nextNodeId: "task-yes", source: "user" },
            },
          },
          {
            id: "task-yes",
            nodeId: "task-yes",
            activeLayerId: null,
            semanticKey: "task-yes",
            localId: "task_add_cheese",
            type: "task",
            title: "加芝士",
            definition: {
              title: "加芝士",
              objective: "加好芝士",
              semantics: { type: "task" },
            },
            config: { expectedOutput: "加好芝士" },
            dependencies: ["condition-1"],
            dependents: [],
            status: "ready",
            invalidated: false,
            attempts: 0,
            metadata: {},
            dependenciesSatisfied: true,
            ready: true,
            reachable: true,
            executor: "user",
            mode: "manual",
          },
        ],
        edges: [
          { id: "edge-yes", from: "condition-1", to: "task-yes", label: "是", active: true },
          { id: "edge-no", from: "condition-1", to: "task-no", label: "否", active: false },
        ],
        entryNodeIds: ["condition-1"],
        terminalNodeIds: ["task-yes"],
        readyNodeIds: ["task-yes"],
        blockedNodeIds: [],
        completedNodeIds: ["condition-1"],
        runningNodeIds: [],
        invalidatedNodeIds: [],
        failedNodeIds: [],
        pendingNodeIds: [],
      },
    };

    const graphPlan = taskPlanReadModelToGraphPlan(readModel);

    expect(graphPlan?.currentStepId).toBe(null);
    expect(graphPlan?.steps.find((step) => step.id === "condition-1")?.status).toBe("done");
    expect(graphPlan?.steps.find((step) => step.id === "condition-1")?.resultOutputs).toEqual([
      { kind: "json", value: { selectedBranch: "是" } },
    ]);
    expect(graphPlan?.steps.find((step) => step.id === "condition-1")?.resultEvidence).toMatchObject({
      runId: "run-1",
      runtimeRunRef: "runtime-ref-1",
    });
    expect(graphPlan?.steps.find((step) => step.id === "task-yes")?.status).toBe("ready");
    expect(graphPlan?.steps.find((step) => step.id === "task-yes")?.readiness).toBe("ready");
    expect(graphPlan?.edges).toEqual([
      {
        id: "edge-yes",
        from: "condition-1",
        to: "task-yes",
        label: "是",
        kind: "branch_option",
        emphasis: "normal",
      },
    ]);
  });

  it("keeps skipped runtime branch nodes out of entry analytics", () => {
    const readModel: TaskPlanReadModel = {
      id: "plan-1",
      status: "accepted",
      revision: 2,
      prompt: null,
      summary: "午餐计划",
      updatedAt: "2026-05-07T10:00:00.000Z",
      generatedBy: "ai",
      blueprint: {
        title: "做汉堡",
        goal: "完成午餐",
        assumptions: [],
        nodes: [],
        edges: [],
      },
      compiledPlan,
      effectivePlan: {
        graphId: "graph-1",
        planId: "plan-1",
        basePlanId: "compiled-plan-1",
        resolvedAt: "2026-05-07T10:00:00.000Z",
        resolvedVersion: 3,
        nodes: [
          {
            id: "condition-1",
            nodeId: "condition-1",
            activeLayerId: null,
            semanticKey: "condition-1",
            localId: "condition_local",
            type: "condition",
            title: "是否加芝士",
            definition: { title: "是否加芝士", objective: "用户是否要芝士", semantics: { type: "condition" } },
            config: compiledPlan.nodes[0]!.config,
            dependencies: [],
            dependents: ["task-yes"],
            status: "completed",
            invalidated: false,
            attempts: 1,
            metadata: {},
            dependenciesSatisfied: true,
            ready: false,
            reachable: true,
          },
          {
            id: "task-yes",
            nodeId: "task-yes",
            activeLayerId: null,
            semanticKey: "task-yes",
            localId: "task_add_cheese",
            type: "task",
            title: "加芝士",
            definition: { title: "加芝士", objective: "加好芝士", semantics: { type: "task" } },
            config: { expectedOutput: "加好芝士" },
            dependencies: ["condition-1"],
            dependents: [],
            status: "skipped",
            invalidated: false,
            attempts: 0,
            metadata: {},
            dependenciesSatisfied: false,
            ready: false,
            reachable: false,
          },
        ],
        edges: [
          { id: "edge-yes", from: "condition-1", to: "task-yes", label: "是", active: false },
        ],
        entryNodeIds: ["condition-1"],
        terminalNodeIds: ["condition-1"],
        readyNodeIds: [],
        blockedNodeIds: [],
        completedNodeIds: ["condition-1", "task-yes"],
        runningNodeIds: [],
        invalidatedNodeIds: [],
        failedNodeIds: [],
        pendingNodeIds: [],
      },
    };

    const graphPlan = taskPlanReadModelToGraphPlan(readModel);

    expect(graphPlan?.steps.find((step) => step.id === "task-yes")?.status).toBe("skipped");
    expect(graphPlan?.analytics.entryNodeIds).toEqual(["condition-1"]);
    expect(graphPlan?.analytics.entryNodeIds).not.toContain("task-yes");
  });
});
