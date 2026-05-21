import { describe, expect, it } from "bun:test";

import {
  buildConditionNodeEvaluationFeatureSpec,
  buildDispatchTaskFeatureSpec,
  buildEditPlanPatchFeatureSpec,
  buildCheckpointNodeReviewFeatureSpec,
  buildTaskNodeExecutionFeatureSpec,
  SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
  buildSuggestFeatureSpec,
  GENERATE_PLAN_BLUEPRINT_TOOL_NAME,
  buildGeneratePlanFeatureSpec,
  validatePreparedFeaturePayload,
} from "./ai";

describe("generate_plan feature spec", () => {
  it("builds a provider-agnostic feature spec that delegates persistence to MCP", () => {
    const spec = buildGeneratePlanFeatureSpec({
      taskId: "task-1",
      title: "制作一个汉堡",
      description: "准备食材并完成烹饪",
      estimatedMinutes: 60,
    });

    expect(spec).toMatchObject({
      feature: "generate_plan",
    });
    expect(spec.structuredOutputSchema).toBeUndefined();
    expect(GENERATE_PLAN_BLUEPRINT_TOOL_NAME).toBe("chrona_plan_generate");
    expect(spec.instructions).toContain("You MUST call the chrona_plan_generate tool.");
    expect(spec.inputText).toContain("Title: 制作一个汉堡");
    expect(spec.inputText).toContain("Estimated duration: 60 minutes");
  });

  it("validates generate_plan tool payloads through the shared contract", () => {
    const spec = buildGeneratePlanFeatureSpec({
      title: "制作一个汉堡",
    });

    expect(
      validatePreparedFeaturePayload(spec, {
        title: "汉堡制作计划",
        goal: "完成汉堡制作",
        nodes: [{ id: "prepare", type: "task", title: "准备食材" }],
        edges: [],
      }),
    ).toEqual({ ok: true });

    expect(
      validatePreparedFeaturePayload(spec, {
        title: "",
        goal: "",
        nodes: [],
        edges: [],
      }),
    ).toMatchObject({ ok: false });
  });

  it("does not expose provider structured output schema for generate_plan", () => {
    const spec = buildGeneratePlanFeatureSpec({
      title: "制作一个汉堡",
    });

    expect(spec.structuredOutputSchema).toBeUndefined();
  });
});

describe("node runtime feature prompts", () => {
  it("tells agents to use Chrona read tools only when needed", () => {
    const specs = [
      buildTaskNodeExecutionFeatureSpec({
        graphId: "graph-1",
        nodeId: "node-1",
        nodeLayerId: "layer-1",
        attemptId: "attempt-1",
        contextSnapshotId: "snapshot-1",
        taskId: "task-1",
        nodeTitle: "Do work",
        nodeObjective: "Do the current work",
        instructions: "Finish the work",
        completedNodeTitles: [],
      }),
      buildConditionNodeEvaluationFeatureSpec({
        graphId: "graph-1",
        nodeId: "node-2",
        nodeLayerId: "layer-2",
        taskId: "task-1",
        nodeTitle: "Choose path",
        condition: "Is it ready?",
        branches: [{ label: "yes", nextNodeId: "node-3" }],
        instructions: "Pick a branch",
        completedNodeTitles: [],
      }),
      buildCheckpointNodeReviewFeatureSpec({
        graphId: "graph-1",
        nodeId: "node-4",
        nodeLayerId: "layer-4",
        taskId: "task-1",
        nodeTitle: "Approve work",
        checkpointType: "approve",
        prompt: "Approve?",
        instructions: "Review the checkpoint",
        completedNodeTitles: [],
      }),
    ];

    for (const spec of specs) {
      expect(spec.instructions).toContain("Do not call chrona_node_read or chrona_execution_read by default");
      expect(spec.instructions).toContain("Call chrona_node_read only when");
      expect(spec.instructions).toContain("Call chrona_execution_read only after");
    }
  });
});

describe("structured feature specs", () => {
  it("builds suggest as a shared structured feature contract", () => {
    const spec = buildSuggestFeatureSpec();

    expect(spec).toMatchObject({
      feature: "suggest",
      structuredOutputSchema: {
        name: SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
      },
    });
    expect(spec.instructions).toContain("You MUST call the business tool suggest_task_completions.");
  });

  it("validates suggest payloads through the shared contract", () => {
    const spec = buildSuggestFeatureSpec();

    expect(
      validatePreparedFeaturePayload(spec, {
        suggestions: [{ title: "Plan groceries" }],
      }),
    ).toEqual({ ok: true });

    expect(
      validatePreparedFeaturePayload(spec, {
        suggestions: [{}],
      }),
    ).toMatchObject({ ok: false });
  });

  it("validates edit_plan payloads through the shared PlanPatch schema", () => {
    const spec = buildEditPlanPatchFeatureSpec({
      planId: "plan-1",
      version: 1,
      title: "Plan",
      goal: "Goal",
      nodes: [{ id: "task_one", type: "task", title: "Task one" }],
      edges: [],
      userInstruction: "Rename the plan",
    });

    expect(
      validatePreparedFeaturePayload(spec, {
        basePlanId: "plan-1",
        baseVersion: 1,
        operations: [
          {
            op: "update_plan",
            patch: { title: "Updated plan" },
          },
        ],
      }),
    ).toEqual({ ok: true });

    expect(
      validatePreparedFeaturePayload(spec, {
        basePlanId: "plan-1",
        baseVersion: 1,
        operations: [],
      }),
    ).toMatchObject({ ok: false });
  });

  it("validates dispatch_task payloads through the shared decision schema", () => {
    const spec = buildDispatchTaskFeatureSpec();

    expect(
      validatePreparedFeaturePayload(spec, {
        schemaName: "task_dispatch_decision",
        schemaVersion: "1.0.0",
        action: "run_node",
        targetNodeId: "node-1",
        safety: { requiresHumanApproval: false, riskLevel: "low" },
        confidence: 0.9,
        reason: "Node is ready",
      }),
    ).toEqual({ ok: true });

    expect(
      validatePreparedFeaturePayload(spec, {
        schemaName: "task_dispatch_decision",
        schemaVersion: "1.0.0",
        action: "run_node",
        safety: { requiresHumanApproval: false, riskLevel: "low" },
        confidence: 0.9,
        reason: "Node is ready",
      }),
    ).toMatchObject({ ok: false });
  });
});
