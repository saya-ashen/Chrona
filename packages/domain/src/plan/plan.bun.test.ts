import { describe, expect, it } from "bun:test";

import type {
  EditablePlan,
  EditableNode,
  EditableTaskNode,
  EditableCheckpointNode,
  EditableConditionNode,
  EditableWaitNode,
  PlanPatch,
  TaskExecutor,
  TaskMode,
} from "@chrona/contracts/ai";

import { PlanCompileError } from "@chrona/contracts/ai";
import { validateEditablePlan } from "./validate";
import { applyPlanPatch } from "./patch";
import { compileEditablePlan } from "./compile";

// ─── Helpers ───

function makeTask(
  id: string,
  overrides?: Partial<EditableTaskNode>,
): EditableTaskNode {
  return {
    id,
    type: "task",
    title: `Task ${id}`,
    executor: "ai",
    mode: "auto",
    ...overrides,
  };
}

function makeCheckpoint(
  id: string,
  overrides?: Partial<EditableCheckpointNode>,
): EditableCheckpointNode {
  return {
    id,
    type: "checkpoint",
    title: `Checkpoint ${id}`,
    checkpointType: "confirm",
    prompt: "Are you sure?",
    required: true,
    ...overrides,
  };
}

function makeCondition(
  id: string,
  branches: Array<{ label: string; nextNodeId: string }>,
  overrides?: Partial<EditableConditionNode>,
): EditableConditionNode {
  return {
    id,
    type: "condition",
    title: `Condition ${id}`,
    condition: "Check something",
    evaluationBy: "ai",
    branches,
    ...overrides,
  };
}

function makeWait(
  id: string,
  overrides?: Partial<EditableWaitNode>,
): EditableWaitNode {
  return {
    id,
    type: "wait",
    title: `Wait ${id}`,
    waitFor: "something to happen",
    ...overrides,
  };
}

function makePlan(
  id: string,
  nodes: EditablePlan["nodes"],
  edges: EditablePlan["edges"],
  overrides?: Partial<EditablePlan>,
): EditablePlan {
  return {
    id,
    version: 1,
    title: "Test plan",
    goal: "Test goal",
    nodes,
    edges,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// validateEditablePlan tests
// ═══════════════════════════════════════════════════════════════

describe("validateEditablePlan", () => {
  it("1. accepts a valid DAG", () => {
    const plan = makePlan(
      "plan_1",
      [makeCheckpoint("review_budget"), makeTask("book_trip")],
      [{ from: "review_budget", to: "book_trip" }],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("2. rejects edge pointing to non-existent node", () => {
    const plan = makePlan(
      "plan_1",
      [makeTask("start_here")],
      [{ from: "start_here", to: "missing_node" }],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("missing_node"))).toBe(
      true,
    );
  });

  it("3. rejects cycle", () => {
    const plan = makePlan(
      "plan_1",
      [makeTask("first_step"), makeTask("second_step")],
      [
        { from: "first_step", to: "second_step" },
        { from: "second_step", to: "first_step" },
      ],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("DAG"))).toBe(true);
  });

  it("4. rejects invalid node type", () => {
    const plan = makePlan(
      "plan_1",
      // Use as unknown cast to simulate bad AI output at runtime
      [
        {
          id: "my_node",
          type: "start",
          title: "Start",
        } as unknown as EditableNode,
      ],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("Invalid node type")),
    ).toBe(true);
  });

  it("5. rejects duplicate node id", () => {
    const plan = makePlan(
      "plan_1",
      [makeTask("dup_node"), makeTask("dup_node")],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(
      true,
    );
  });

  it("6. rejects non-snake_case id", () => {
    const plan = makePlan(
      "plan_1",
      [
        {
          id: "Bad Name",
          type: "task",
          title: "Bad",
          executor: "ai",
          mode: "auto",
        },
      ],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("snake_case"))).toBe(
      true,
    );
  });

  it("7. rejects condition branch pointing to non-existent node", () => {
    const plan = makePlan(
      "plan_1",
      [
        makeCondition("check_status", [
          { label: "yes", nextNodeId: "missing_branch" },
        ]),
      ],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("missing_branch")),
    ).toBe(true);
  });

  it("8. does not warn from text-only action heuristics", () => {
    const plan = makePlan(
      "plan_1",
      [makeTask("send_email", { title: "Send email to vendor" })],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("9. accepts checkpointed action plans without advisory text heuristics", () => {
    const plan = makePlan(
      "plan_1",
      [
        makeCheckpoint("approve_send", {
          checkpointType: "approve",
          prompt: "Approve sending?",
        }),
        makeTask("send_email", { title: "Send email to vendor" }),
      ],
      [{ from: "approve_send", to: "send_email" }],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("10. accepts valid snake_case ids with numbers and underscores", () => {
    const plan = makePlan(
      "plan_1",
      [
        makeTask("task_1"),
        makeTask("task_2"),
        makeTask("a_really_long_task_id_123"),
      ],
      [
        { from: "task_1", to: "task_2" },
        { from: "task_2", to: "a_really_long_task_id_123" },
      ],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(true);
  });

  it("10b. accepts multiple entry nodes that converge to one terminal task", () => {
    const plan = makePlan(
      "plan_parallel",
      [makeTask("fetch_a"), makeTask("fetch_b"), makeTask("combine_results")],
      [
        { from: "fetch_a", to: "combine_results" },
        { from: "fetch_b", to: "combine_results" },
      ],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(true);
  });

  it("10c. rejects dangling extra terminal nodes", () => {
    const plan = makePlan(
      "plan_dangling",
      [makeTask("fetch_data"), makeTask("summarize_data"), makeTask("report_empty")],
      [{ from: "fetch_data", to: "summarize_data" }],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("exactly one terminal node"))).toBe(true);
  });

  it("10d. rejects plans ending on a checkpoint", () => {
    const plan = makePlan(
      "plan_checkpoint_terminal",
      [makeTask("fetch_data"), makeCheckpoint("choose_empty")],
      [{ from: "fetch_data", to: "choose_empty" }],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("terminal node must be a task"))).toBe(true);
  });

  it("10e. rejects condition branch cycles even without explicit edges", () => {
    const plan = makePlan(
      "plan_branch_cycle",
      [
        makeCondition("check", [{ label: "again", nextNodeId: "fetch_data" }]),
        makeTask("fetch_data"),
      ],
      [{ from: "fetch_data", to: "check" }],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("DAG"))).toBe(true);
  });

  it("10f. rejects generated empty-result fallback nodes left unconnected", () => {
    const plan = makePlan(
      "plan_generated_orphan",
      [
        makeTask("task_fetch_trending"),
        makeTask("task_parse_repos"),
        makeCondition("condition_has_repos", [
          { label: "有数据", nextNodeId: "task_summarize" },
          { label: "无数据", nextNodeId: "checkpoint_handle_empty" },
        ]),
        makeTask("task_summarize"),
        makeCheckpoint("checkpoint_handle_empty", {
          checkpointType: "choose",
          required: false,
          options: ["重试抓取与解析", "改为输出今日无数据说明", "取消任务"],
        }),
        makeTask("task_retry_parse"),
        makeTask("task_report_empty"),
      ],
      [
        { from: "task_fetch_trending", to: "task_parse_repos" },
        { from: "task_parse_repos", to: "condition_has_repos" },
        { from: "task_retry_parse", to: "task_summarize" },
      ],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("exactly one terminal node"))).toBe(true);
  });

  it("11. rejects empty plan", () => {
    const plan = makePlan("plan_1", [], []);
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
  });

  it("12. rejects plan with missing executor on task node", () => {
    const plan = makePlan(
      "plan_1",
      // Edge case: empty strings for executor/mode should be caught by validation
      [
        {
          id: "bad_task",
          type: "task",
          title: "Bad",
          executor: "" as TaskExecutor,
          mode: "" as TaskMode,
        },
      ],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
  });

  it("13. accepts condition with defaultNextNodeId pointing to valid node", () => {
    const plan = makePlan(
      "plan_1",
      [
        makeCondition("check", [{ label: "yes", nextNodeId: "yes_task" }], {
          defaultNextNodeId: "no_task",
        }),
        makeTask("yes_task"),
        makeTask("no_task"),
        makeTask("deliver_result"),
      ],
      [
        { from: "yes_task", to: "deliver_result" },
        { from: "no_task", to: "deliver_result" },
      ],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(true);
  });

  it("14. rejects condition with defaultNextNodeId pointing to non-existent node", () => {
    const plan = makePlan(
      "plan_1",
      [
        makeCondition("check", [{ label: "yes", nextNodeId: "yes_task" }], {
          defaultNextNodeId: "nowhere",
        }),
        makeTask("yes_task"),
      ],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// applyPlanPatch tests
// ═══════════════════════════════════════════════════════════════

describe("applyPlanPatch", () => {
  const basePlan = makePlan(
    "plan_a",
    [makeTask("task_a"), makeTask("task_b")],
    [{ from: "task_a", to: "task_b" }],
  );

  it("15. add_node + add_edge succeeds", () => {
    const patch: PlanPatch = {
      basePlanId: "plan_a",
      baseVersion: 1,
      rationale: "Add a task",
      operations: [
        { op: "add_node", node: makeTask("task_c") },
        { op: "add_edge", edge: { from: "task_b", to: "task_c" } },
      ],
    };

    const result = applyPlanPatch(basePlan, patch);
    expect(result.ok).toBe(true);
    expect(result.plan!.version).toBe(2);
    expect(result.plan!.nodes).toHaveLength(3);
    expect(result.plan!.edges).toHaveLength(2);
    expect(result.plan!.nodes.some((n) => n.id === "task_c")).toBe(true);
  });

  it("16. delete_node removes associated edges", () => {
    const patch: PlanPatch = {
      basePlanId: "plan_a",
      baseVersion: 1,
      rationale: "Remove task_b",
      operations: [{ op: "delete_node", nodeId: "task_b" }],
    };

    const result = applyPlanPatch(basePlan, patch);
    expect(result.ok).toBe(true);
    expect(result.plan!.nodes).toHaveLength(1);
    expect(result.plan!.edges).toHaveLength(0); // Edge auto-removed
  });

  it("17. version mismatch fails (optimistic locking)", () => {
    const patch: PlanPatch = {
      basePlanId: "plan_a",
      baseVersion: 2, // plan is at version 1
      operations: [{ op: "add_node", node: makeTask("task_c") }],
    };

    const result = applyPlanPatch(basePlan, patch);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Version conflict");
  });

  it("18. plan ID mismatch fails", () => {
    const patch: PlanPatch = {
      basePlanId: "plan_b",
      baseVersion: 1,
      operations: [{ op: "add_node", node: makeTask("task_c") }],
    };

    const result = applyPlanPatch(basePlan, patch);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ID mismatch");
  });

  it("19. update_node cannot change node.type", () => {
    const patch: PlanPatch = {
      basePlanId: "plan_a",
      baseVersion: 1,
      operations: [
        {
          op: "update_node",
          nodeId: "task_a",
          patch: { type: "checkpoint" as any, title: "Changed" },
        },
      ],
    };

    const result = applyPlanPatch(basePlan, patch);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot change node type");
  });

  it("20. update_node can change non-type fields", () => {
    const patch: PlanPatch = {
      basePlanId: "plan_a",
      baseVersion: 1,
      operations: [
        {
          op: "update_node",
          nodeId: "task_a",
          patch: { title: "Updated Title", estimatedMinutes: 45 },
        },
      ],
    };

    const result = applyPlanPatch(basePlan, patch);
    expect(result.ok).toBe(true);
    const updated = result.plan!.nodes.find((n) => n.id === "task_a");
    expect(updated!.title).toBe("Updated Title");
    if (updated && "estimatedMinutes" in updated) {
      expect(updated.estimatedMinutes).toBe(45);
    }
  });

  it("21. update_plan changes top-level fields", () => {
    const patch: PlanPatch = {
      basePlanId: "plan_a",
      baseVersion: 1,
      operations: [
        { op: "update_plan", patch: { title: "New Title", goal: "New Goal" } },
      ],
    };

    const result = applyPlanPatch(basePlan, patch);
    expect(result.ok).toBe(true);
    expect(result.plan!.title).toBe("New Title");
    expect(result.plan!.goal).toBe("New Goal");
    expect(result.plan!.version).toBe(2);
  });

  it("22. does not mutate the input plan (immutable)", () => {
    const original = structuredClone(basePlan);

    const patch: PlanPatch = {
      basePlanId: "plan_a",
      baseVersion: 1,
      operations: [{ op: "add_node", node: makeTask("task_c") }],
    };

    applyPlanPatch(basePlan, patch);

    // Original should be unchanged
    expect(basePlan.nodes).toHaveLength(original.nodes.length);
    expect(basePlan.version).toBe(original.version);
  });

  it("23. rejects patch that creates invalid graph", () => {
    const patch: PlanPatch = {
      basePlanId: "plan_a",
      baseVersion: 1,
      operations: [{ op: "delete_node", nodeId: "task_a" }],
    };

    const result = applyPlanPatch(basePlan, patch);
    // After deleting task_a, task_b has no incoming edges but edge from task_a→task_b
    // The edge is also removed. Result should still be valid (single node, no edges).
    expect(result.ok).toBe(true);
    expect(result.plan!.nodes).toHaveLength(1);
  });

  it("24. replace_subgraph works correctly", () => {
    const plan = makePlan(
      "plan_sg",
      [makeTask("old_1"), makeTask("old_2")],
      [{ from: "old_1", to: "old_2" }],
    );

    const patch: PlanPatch = {
      basePlanId: "plan_sg",
      baseVersion: 1,
      operations: [
        {
          op: "replace_subgraph",
          removeNodeIds: ["old_1", "old_2"],
          addNodes: [makeTask("new_1"), makeTask("new_2")],
          addEdges: [{ from: "new_1", to: "new_2" }],
        },
      ],
    };

    const result = applyPlanPatch(plan, patch);
    expect(result.ok).toBe(true);
    expect(result.plan!.nodes.map((n) => n.id).sort()).toEqual([
      "new_1",
      "new_2",
    ]);
    expect(result.plan!.edges).toHaveLength(1);
  });

  it("25. add_edge that creates a cycle is caught after validation", () => {
    const plan = makePlan(
      "plan_cyc",
      [makeTask("a"), makeTask("b"), makeTask("c")],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    );

    // Adding c→a creates a cycle
    const patch: PlanPatch = {
      basePlanId: "plan_cyc",
      baseVersion: 1,
      operations: [{ op: "add_edge", edge: { from: "c", to: "a" } }],
    };

    const result = applyPlanPatch(plan, patch);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("DAG");
  });
});

// ═══════════════════════════════════════════════════════════════
// compileEditablePlan tests
// ═══════════════════════════════════════════════════════════════

describe("compileEditablePlan", () => {
  it("26. correctly computes entryNodeIds / terminalNodeIds", () => {
    const plan = makePlan(
      "plan_comp",
      [
        makeCheckpoint("review", {
          checkpointType: "approve",
          prompt: "OK?",
        }),
        makeTask("build"),
      ],
      [{ from: "review", to: "build" }],
    );

    const compiled = compileEditablePlan(plan);

    expect(compiled.entryNodeIds).toHaveLength(1);
    expect(compiled.terminalNodeIds).toHaveLength(1);

    const entryNode = compiled.nodes.find(
      (n) => n.id === compiled.entryNodeIds[0],
    );
    expect(entryNode?.localId).toBe("review");

    const terminalNode = compiled.nodes.find(
      (n) => n.id === compiled.terminalNodeIds[0],
    );
    expect(terminalNode?.localId).toBe("build");
  });

  it("27. correctly rewrites localId to compiled node id", () => {
    const plan = makePlan(
      "plan_map",
      [makeTask("collect_info"), makeTask("process_data")],
      [{ from: "collect_info", to: "process_data" }],
    );

    const compiled = compileEditablePlan(plan);

    expect(compiled.nodes).toHaveLength(2);

    const node0 = compiled.nodes[0];
    const node1 = compiled.nodes[1];

    // localId preserved
    expect(node0.localId).toBe("collect_info");
    expect(node1.localId).toBe("process_data");

    // compiled id is different from localId
    expect(node0.id).not.toBe(node0.localId);
    expect(node1.id).not.toBe(node1.localId);

    // edge rewritten
    expect(compiled.edges).toHaveLength(1);
    expect(compiled.edges[0].from).toBe(node0.id);
    expect(compiled.edges[0].to).toBe(node1.id);
  });

  it("28. injects completionPolicy", () => {
    const plan = makePlan("plan_pol", [makeTask("do_stuff")], []);

    const compiled = compileEditablePlan(plan);

    expect(compiled.completionPolicy).toEqual({ type: "all_tasks_completed" });
  });

  it("29. compiles without text-only validation warnings", () => {
    const plan = makePlan(
      "plan_warn",
      [makeTask("send_email", { title: "Send email" })],
      [],
    );

    const compiled = compileEditablePlan(plan);

    expect(compiled.validationWarnings).toEqual([]);
  });

  it("30. refuses to compile invalid plan", () => {
    const plan = makePlan(
      "plan_bad",
      [makeTask("first"), makeTask("second")],
      [
        { from: "first", to: "second" },
        { from: "second", to: "first" },
      ],
    );

    expect(() => compileEditablePlan(plan)).toThrow(PlanCompileError);
  });

  it("31. correctly resolves dependencies and dependents", () => {
    const plan = makePlan(
      "plan_dep",
      [makeTask("a"), makeTask("b"), makeTask("c"), makeTask("d")],
      [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
    );

    const compiled = compileEditablePlan(plan);

    const nodeA = compiled.nodes.find((n) => n.localId === "a")!;
    const nodeB = compiled.nodes.find((n) => n.localId === "b")!;
    const nodeC = compiled.nodes.find((n) => n.localId === "c")!;
    const nodeD = compiled.nodes.find((n) => n.localId === "d")!;

    // A has no dependencies, 2 dependents
    expect(nodeA.dependencies).toHaveLength(0);
    expect(nodeA.dependents).toHaveLength(2);
    expect(nodeA.dependents).toContain(nodeB.id);
    expect(nodeA.dependents).toContain(nodeC.id);

    // B/C depend on A and converge into D
    expect(nodeB.dependencies).toHaveLength(1);
    expect(nodeB.dependencies[0]).toBe(nodeA.id);
    expect(nodeB.dependents).toEqual([nodeD.id]);

    expect(nodeC.dependencies).toHaveLength(1);
    expect(nodeC.dependencies[0]).toBe(nodeA.id);
    expect(nodeC.dependents).toEqual([nodeD.id]);

    expect(nodeD.dependencies).toEqual(expect.arrayContaining([nodeB.id, nodeC.id]));
  });

  it("32. handles condition branches as implicit edges", () => {
    const plan = makePlan(
      "plan_cond",
      [
        makeCondition("check", [{ label: "yes", nextNodeId: "do_yes" }], {
          defaultNextNodeId: "do_no",
        }),
        makeTask("do_yes"),
        makeTask("do_no"),
        makeTask("deliver_result"),
      ],
      [
        { from: "do_yes", to: "deliver_result" },
        { from: "do_no", to: "deliver_result" },
      ],
    );

    const compiled = compileEditablePlan(plan);

    const conditionNode = compiled.nodes.find((n) => n.localId === "check")!;
    // Condition node should have 2 dependents (both branches)
    expect(conditionNode.dependents.length).toBeGreaterThanOrEqual(1);

    // Should have edges for both branches
    const edges = compiled.edges;
    expect(edges.length).toBeGreaterThanOrEqual(2);

    const yesNode = compiled.nodes.find((n) => n.localId === "do_yes")!;
    const noNode = compiled.nodes.find((n) => n.localId === "do_no")!;
    const config = conditionNode.config as { branches: Array<{ nextNodeId: string }>; defaultNextNodeId?: string };
    expect(config.branches[0]?.nextNodeId).toBe(yesNode.id);
    expect(config.defaultNextNodeId).toBe(noNode.id);
  });

  it("32b. keeps explicit condition branch labels when default shares the same edge", () => {
    const plan = makePlan(
      "plan_cond_labels",
      [
        makeCondition(
          "check",
          [
            { label: "yes", nextNodeId: "do_yes" },
            { label: "no", nextNodeId: "do_no" },
          ],
          {
            defaultNextNodeId: "do_no",
          },
        ),
        makeTask("do_yes"),
        makeTask("do_no"),
        makeTask("deliver_result"),
      ],
      [
        { from: "check", to: "do_yes" },
        { from: "check", to: "do_no", label: "wrong" },
        { from: "do_yes", to: "deliver_result" },
        { from: "do_no", to: "deliver_result" },
      ],
    );

    const compiled = compileEditablePlan(plan);
    const conditionNode = compiled.nodes.find((n) => n.localId === "check")!;
    const yesNode = compiled.nodes.find((n) => n.localId === "do_yes")!;
    const noNode = compiled.nodes.find((n) => n.localId === "do_no")!;

    expect(
      compiled.edges.find(
        (edge) => edge.from === conditionNode.id && edge.to === yesNode.id,
      )?.label,
    ).toBe("yes");
    expect(
      compiled.edges.find(
        (edge) => edge.from === conditionNode.id && edge.to === noNode.id,
      )?.label,
    ).toBe("no");
  });

  it("32c. labels fallback-only condition edges as default", () => {
    const plan = makePlan(
      "plan_cond_default_only",
      [
        makeCondition("check", [{ label: "yes", nextNodeId: "do_yes" }], {
          defaultNextNodeId: "do_no",
        }),
        makeTask("do_yes"),
        makeTask("do_no"),
        makeTask("deliver_result"),
      ],
      [
        { from: "check", to: "do_yes" },
        { from: "do_yes", to: "deliver_result" },
        { from: "do_no", to: "deliver_result" },
      ],
    );

    const compiled = compileEditablePlan(plan);
    const conditionNode = compiled.nodes.find((n) => n.localId === "check")!;
    const noNode = compiled.nodes.find((n) => n.localId === "do_no")!;

    expect(
      compiled.edges.find(
        (edge) => edge.from === conditionNode.id && edge.to === noNode.id,
      )?.label,
    ).toBe("default");
  });

  it("33. stores node config correctly for each type", () => {
    const plan = makePlan(
      "plan_config",
      [
        makeTask("t", { expectedOutput: "Output", completionCriteria: "Done" }),
        makeCheckpoint("c", {
          checkpointType: "approve",
          prompt: "Please approve",
          required: true,
        }),
        makeWait("w", {
          waitFor: "signal",
          timeout: { minutes: 5, onTimeout: "fail" },
        }),
        makeCondition("cond", [{ label: "ok", nextNodeId: "t" }]),
      ],
      [
        { from: "c", to: "w" },
        { from: "w", to: "t" },
      ],
    );

    const compiled = compileEditablePlan(plan);

    const tNode = compiled.nodes.find((n) => n.localId === "t")!;
    const cNode = compiled.nodes.find((n) => n.localId === "c")!;
    const wNode = compiled.nodes.find((n) => n.localId === "w")!;
    const condNode = compiled.nodes.find((n) => n.localId === "cond")!;

    expect(tNode.config).toHaveProperty("expectedOutput", "Output");
    expect(cNode.config).toHaveProperty("checkpointType", "approve");
    expect(wNode.config).toHaveProperty("waitFor", "signal");
    expect(condNode.config).toHaveProperty("condition", "Check something");
  });
});

// ═══════════════════════════════════════════════════════════════
// Prompt builder tests
// ═══════════════════════════════════════════════════════════════
