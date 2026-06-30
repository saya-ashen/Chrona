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

  it("adds condition branch edges from metadata before execution runtime exists", () => {
    const graphPlan = compiledPlanToGraphPlan({
      ...compiledPlan,
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
              { label: "是", nextNodeId: "task-yes" },
              { label: "否", nextNodeId: "task-no" },
            ],
            defaultNextNodeId: "task-no",
          },
          dependencies: [],
          dependents: ["task-yes", "task-no"],
        },
        {
          id: "task-yes",
          localId: "task_yes",
          type: "task",
          title: "加芝士",
          config: { expectedOutput: "加好芝士" },
          dependencies: ["condition-1"],
          dependents: [],
        },
        {
          id: "task-no",
          localId: "task_no",
          type: "task",
          title: "不加芝士",
          config: { expectedOutput: "不加芝士" },
          dependencies: ["condition-1"],
          dependents: [],
        },
      ],
      edges: [],
      entryNodeIds: ["condition-1"],
      terminalNodeIds: ["task-yes", "task-no"],
      topologicalOrder: ["condition-1", "task-yes", "task-no"],
    });

    expect(graphPlan?.edges.map((edge) => ({ from: edge.from, to: edge.to, label: edge.label }))).toEqual([
      { from: "condition-1", to: "task-yes", label: "是" },
      { from: "condition-1", to: "task-no", label: "否" },
      { from: "condition-1", to: "task-no", label: "default" },
    ]);
    expect(graphPlan?.analytics.rankByNodeId).toMatchObject({
      "condition-1": 0,
      "task-yes": 1,
      "task-no": 1,
    });
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
      availableActions: [{ label: "Approve", kind: "approve" }],
      interactiveFields: [
        {
          key: "checkpoint:decision",
          label: "Approval decision",
          control: "approval",
          required: true,
          options: ["Approve", "Reject"],
        },
      ],
    });
  });

  it("uses effective plan runtime status and preserves inactive labeled edges from read model", () => {
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
        waitingNodeIds: [],
        waitingForUserNodeIds: [],
        waitingForApprovalNodeIds: [],
        degradedNodeIds: [],
        skippedNodeIds: [],
        cancelledNodeIds: [],
        completedNodeIds: ["condition-1"],
        runningNodeIds: [],
        invalidatedNodeIds: [],
        failedNodeIds: [],
        pendingNodeIds: [],
      },
    };

    const graphPlan = taskPlanReadModelToGraphPlan(readModel);

    expect(graphPlan?.currentStepId).toBe("task-yes");
    expect(graphPlan?.steps.find((step) => step.id === "condition-1")?.status).toBe("done");
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
        active: true,
        kind: "branch_option",
        emphasis: "normal",
      },
      {
        id: "edge-no",
        from: "condition-1",
        to: "task-no",
        label: "否",
        active: false,
        kind: "branch_option",
        emphasis: "inactive",
      },
    ]);
  });

  it("preserves explicit attention states and current node from effective plan summaries", () => {
    const readModel: TaskPlanReadModel = {
      id: "plan-1",
      status: "accepted",
      revision: 2,
      prompt: null,
      summary: "Runtime status plan",
      updatedAt: "2026-05-07T10:00:00.000Z",
      generatedBy: "ai",
      blueprint: {
        title: "Runtime status plan",
        goal: "Expose explicit node status",
        assumptions: [],
        nodes: [],
        edges: [],
      },
      compiledPlan,
      effectivePlan: {
        graphId: "graph-1",
        basePlanId: "compiled-plan-1",
        resolvedAt: "2026-05-07T10:00:00.000Z",
        resolvedVersion: 3,
        nodes: [
          {
            id: "approval",
            nodeId: "approval",
            activeLayerId: null,
            semanticKey: "approval",
            localId: "approval_local",
            type: "checkpoint",
            title: "Approve launch",
            definition: { title: "Approve launch", objective: "Approve launch", semantics: { type: "checkpoint" } },
            config: { checkpointType: "approve", prompt: "Approve launch?", required: true },
            dependencies: [],
            dependents: [],
            status: "waiting_for_approval",
            invalidated: false,
            attempts: 1,
            metadata: {},
            dependenciesSatisfied: true,
            ready: false,
            reachable: true,
            blockedReason: "Approval required",
          },
          {
            id: "sync",
            nodeId: "sync",
            activeLayerId: null,
            semanticKey: "sync",
            localId: "sync_local",
            type: "task",
            title: "Sync runtime",
            definition: { title: "Sync runtime", objective: "Sync runtime", semantics: { type: "task" } },
            config: { expectedOutput: "Runtime synced" },
            dependencies: ["approval"],
            dependents: [],
            status: "degraded",
            invalidated: false,
            attempts: 1,
            metadata: {},
            dependenciesSatisfied: false,
            ready: false,
            reachable: true,
            lastError: "Runtime sync timed out",
          },
        ],
        edges: [{ id: "approval-sync", from: "approval", to: "sync", active: true }],
        entryNodeIds: ["approval"],
        terminalNodeIds: ["sync"],
        readyNodeIds: [],
        blockedNodeIds: [],
        waitingNodeIds: ["approval"],
        waitingForUserNodeIds: [],
        waitingForApprovalNodeIds: ["approval"],
        degradedNodeIds: ["sync"],
        skippedNodeIds: [],
        cancelledNodeIds: [],
        completedNodeIds: [],
        runningNodeIds: [],
        invalidatedNodeIds: [],
        failedNodeIds: [],
        pendingNodeIds: [],
      },
    };

    const graphPlan = taskPlanReadModelToGraphPlan(readModel);

    expect(graphPlan?.currentStepId).toBe("approval");
    expect(graphPlan?.steps.find((step) => step.id === "approval")).toMatchObject({
      status: "waiting_for_approval",
      readiness: "blocked",
      blocked: true,
      actionable: true,
    });
    expect(graphPlan?.steps.find((step) => step.id === "sync")).toMatchObject({
      status: "degraded",
      readiness: "blocked",
      blocked: true,
      actionable: true,
    });
    expect(graphPlan?.analytics.attentionNodeIds).toEqual(["approval", "sync"]);
    expect(graphPlan?.analytics.blockedNodeIds).toEqual(["approval", "sync"]);
  });

  it("surfaces manual-action waiting results with blocked reasons as blocked nodes", () => {
    const blocker = "已创建脚本文件，但当前运行环境访问 wttr.in 连续超时。";
    const readModel: TaskPlanReadModel = {
      id: "plan-1",
      status: "accepted",
      revision: 2,
      prompt: null,
      summary: "天气脚本计划",
      updatedAt: "2026-05-07T10:00:00.000Z",
      generatedBy: "ai",
      blueprint: {
        title: "天气脚本计划",
        goal: "创建并验证天气脚本",
        assumptions: [],
        nodes: [],
        edges: [],
      },
      compiledPlan,
      effectivePlan: {
        graphId: "graph-1",
        basePlanId: "compiled-plan-1",
        resolvedAt: "2026-05-07T10:00:00.000Z",
        resolvedVersion: 3,
        nodes: [
          {
            id: "weather-script",
            nodeId: "weather-script",
            activeLayerId: null,
            semanticKey: "weather-script",
            localId: "weather_script_local",
            type: "task",
            title: "创建天气脚本",
            definition: { title: "创建天气脚本", objective: "创建天气脚本", semantics: { type: "task" } },
            config: { expectedOutput: "天气脚本" },
            dependencies: [],
            dependents: [],
            status: "waiting",
            invalidated: false,
            attempts: 1,
            metadata: {},
            dependenciesSatisfied: true,
            ready: false,
            reachable: true,
            blockedReason: blocker,
            lastError: blocker,
            result: {
              status: "current",
              error: blocker,
              waitKind: "manual_action",
              actionForm: {
                instructions: "提供天气 API 密钥后继续执行。",
                submitLabel: "提交密钥",
                inputFields: [{ name: "apiKey", label: "天气 API 密钥", type: "text", required: true }],
              },
            },
          },
        ],
        edges: [],
        entryNodeIds: ["weather-script"],
        terminalNodeIds: ["weather-script"],
        readyNodeIds: [],
        blockedNodeIds: [],
        waitingNodeIds: ["weather-script"],
        waitingForUserNodeIds: [],
        waitingForApprovalNodeIds: [],
        degradedNodeIds: [],
        skippedNodeIds: [],
        cancelledNodeIds: [],
        completedNodeIds: [],
        runningNodeIds: [],
        invalidatedNodeIds: [],
        failedNodeIds: [],
        pendingNodeIds: [],
      },
    };

    const graphPlan = taskPlanReadModelToGraphPlan(readModel);

    expect(graphPlan?.currentStepId).toBe("weather-script");
    expect(graphPlan?.steps[0]).toMatchObject({
      status: "blocked",
      statusLabel: "Blocked",
      readiness: "blocked",
      blocked: true,
      actionable: true,
      interactionType: "retry",
      nextAction: "提供天气 API 密钥后继续执行。",
      interactiveFields: [
        { key: "apiKey", label: "天气 API 密钥", value: "", control: "text", required: true, options: undefined },
      ],
      availableActions: [
        { id: "weather-script:resolve", label: "Resolve blocker", kind: "resolve", emphasis: "primary" },
        { id: "weather-script:retry", label: "Retry node", kind: "retry", emphasis: "warning" },
      ],
      result: { error: blocker, waitKind: "manual_action" },
    });
    expect(graphPlan?.analytics.attentionNodeIds).toEqual(["weather-script"]);
    expect(graphPlan?.analytics.blockedNodeIds).toEqual(["weather-script"]);
  });

  it("keeps completed input checkpoints read-only while preserving fields for display", () => {
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
        basePlanId: "compiled-plan-1",
        resolvedAt: "2026-05-07T10:00:00.000Z",
        resolvedVersion: 3,
        nodes: [
          {
            id: "input-1",
            nodeId: "input-1",
            activeLayerId: null,
            semanticKey: "input-1",
            localId: "input_local",
            type: "checkpoint",
            title: "收集城市",
            definition: { title: "收集城市", objective: "获取默认城市", semantics: { type: "checkpoint" } },
            config: {
              checkpointType: "input",
              prompt: "默认城市是什么？",
              required: true,
              inputFields: [{ key: "city", label: "默认城市", required: true }],
            },
            dependencies: [],
            dependents: [],
            status: "completed",
            invalidated: false,
            attempts: 1,
            metadata: {},
            dependenciesSatisfied: true,
            ready: false,
            reachable: true,
            result: {
              outputSummary: "默认城市: 北京",
              inputFields: { city: "北京" },
            },
            requiredInfo: ["默认城市"],
          } as TaskPlanReadModel["effectivePlan"]["nodes"][number] & { requiredInfo: string[] },
        ],
        edges: [],
        entryNodeIds: ["input-1"],
        terminalNodeIds: ["input-1"],
        readyNodeIds: [],
        blockedNodeIds: [],
        waitingNodeIds: [],
        waitingForUserNodeIds: [],
        waitingForApprovalNodeIds: [],
        degradedNodeIds: [],
        skippedNodeIds: [],
        cancelledNodeIds: [],
        completedNodeIds: ["input-1"],
        runningNodeIds: [],
        invalidatedNodeIds: [],
        failedNodeIds: [],
        pendingNodeIds: [],
      },
    };

    const graphPlan = taskPlanReadModelToGraphPlan(readModel);
    const inputStep = graphPlan?.steps.find((step) => step.id === "input-1");

    expect(inputStep).toMatchObject({
      status: "done",
      interactionType: "observe",
      completionSummary: "默认城市: 北京",
      inputFields: { city: "北京" },
      availableActions: [],
      actionable: false,
    });
    expect(inputStep?.interactiveFields).toEqual([
      expect.objectContaining({ key: "required:默认城市", label: "默认城市", required: true }),
      expect.objectContaining({ key: "city", label: "默认城市", required: true }),
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
        waitingNodeIds: [],
        waitingForUserNodeIds: [],
        waitingForApprovalNodeIds: [],
        degradedNodeIds: [],
        skippedNodeIds: ["task-yes"],
        cancelledNodeIds: [],
        completedNodeIds: ["condition-1", "task-yes"],
        runningNodeIds: [],
        invalidatedNodeIds: [],
        failedNodeIds: [],
        pendingNodeIds: [],
      },
    };

    const graphPlan = taskPlanReadModelToGraphPlan(readModel);

    expect(graphPlan?.steps.find((step) => step.id === "task-yes")?.status).toBe("skipped");
    expect(graphPlan?.edges).toContainEqual({
      id: "edge-yes",
      from: "condition-1",
      to: "task-yes",
      label: "是",
      active: false,
      kind: "branch_option",
      emphasis: "inactive",
    });
    expect(graphPlan?.analytics.entryNodeIds).toEqual(["condition-1"]);
    expect(graphPlan?.analytics.entryNodeIds).not.toContain("task-yes");
    expect(graphPlan?.analytics.terminalNodeIds).toEqual(["condition-1"]);
  });
});
