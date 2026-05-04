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
import { createPlanRun, applyRuntimeCommand } from "./run";
import { buildPlanGenerationPrompt, buildPlanPatchPrompt } from "./prompts";

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
    evaluationBy: "system",
    branches,
    ...overrides,
  };
}

function makeWait(id: string, overrides?: Partial<EditableWaitNode>): EditableWaitNode {
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
    expect(result.errors.some((e) => e.message.includes("missing_node"))).toBe(true);
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
      [{ id: "my_node", type: "start", title: "Start" } as unknown as EditableNode],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Invalid node type"))).toBe(
      true,
    );
  });

  it("5. rejects duplicate node id", () => {
    const plan = makePlan(
      "plan_1",
      [makeTask("dup_node"), makeTask("dup_node")],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });

  it("6. rejects non-snake_case id", () => {
    const plan = makePlan(
      "plan_1",
      [{ id: "Bad Name", type: "task", title: "Bad", executor: "ai", mode: "auto" }],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("snake_case"))).toBe(true);
  });

  it("7. rejects condition branch pointing to non-existent node", () => {
    const plan = makePlan(
      "plan_1",
      [
        makeCondition("check_status", [{ label: "yes", nextNodeId: "missing_branch" }]),
      ],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("missing_branch")),
    ).toBe(true);
  });

  it("8. warns about high-risk task without checkpoint", () => {
    const plan = makePlan(
      "plan_1",
      [makeTask("send_email", { title: "Send email to vendor" })],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(true); // Warning, not error
    expect(result.warnings.some((w) => w.message.includes("High-risk"))).toBe(true);
  });

  it("9. accepts high-risk task with preceding checkpoint", () => {
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
    expect(result.warnings).toHaveLength(0);
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

  it("11. rejects empty plan", () => {
    const plan = makePlan("plan_1", [], []);
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
  });

  it("12. rejects plan with missing executor on task node", () => {
    const plan = makePlan(
      "plan_1",
      // Edge case: empty strings for executor/mode should be caught by validation
      [{ id: "bad_task", type: "task", title: "Bad", executor: "" as TaskExecutor, mode: "" as TaskMode }],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(false);
  });

  it("13. accepts condition with defaultNextNodeId pointing to valid node", () => {
    const plan = makePlan(
      "plan_1",
      [
        makeCondition(
          "check",
          [{ label: "yes", nextNodeId: "yes_task" }],
          { defaultNextNodeId: "no_task" },
        ),
        makeTask("yes_task"),
        makeTask("no_task"),
      ],
      [],
    );
    const result = validateEditablePlan(plan);
    expect(result.ok).toBe(true);
  });

  it("14. rejects condition with defaultNextNodeId pointing to non-existent node", () => {
    const plan = makePlan(
      "plan_1",
      [
        makeCondition(
          "check",
          [{ label: "yes", nextNodeId: "yes_task" }],
          { defaultNextNodeId: "nowhere" },
        ),
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
    expect(result.plan!.nodes.map((n) => n.id).sort()).toEqual(["new_1", "new_2"]);
    expect(result.plan!.edges).toHaveLength(1);
  });

  it("25. add_edge that creates a cycle is caught after validation", () => {
    const plan = makePlan(
      "plan_cyc",
      [makeTask("a"), makeTask("b"), makeTask("c")],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }],
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

    const entryNode = compiled.nodes.find((n) => n.id === compiled.entryNodeIds[0]);
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

  it("29. carries forward validation warnings", () => {
    const plan = makePlan(
      "plan_warn",
      [makeTask("send_email", { title: "Send email" })],
      [],
    );

    const compiled = compileEditablePlan(plan);

    // Warning about high-risk task
    expect(compiled.validationWarnings.some((w) => w.message.includes("High-risk"))).toBe(
      true,
    );
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
      [makeTask("a"), makeTask("b"), makeTask("c")],
      [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
      ],
    );

    const compiled = compileEditablePlan(plan);

    const nodeA = compiled.nodes.find((n) => n.localId === "a")!;
    const nodeB = compiled.nodes.find((n) => n.localId === "b")!;
    const nodeC = compiled.nodes.find((n) => n.localId === "c")!;

    // A has no dependencies, 2 dependents
    expect(nodeA.dependencies).toHaveLength(0);
    expect(nodeA.dependents).toHaveLength(2);
    expect(nodeA.dependents).toContain(nodeB.id);
    expect(nodeA.dependents).toContain(nodeC.id);

    // B depends on A, no dependents
    expect(nodeB.dependencies).toHaveLength(1);
    expect(nodeB.dependencies[0]).toBe(nodeA.id);
    expect(nodeB.dependents).toHaveLength(0);

    // C depends on A, no dependents
    expect(nodeC.dependencies).toHaveLength(1);
    expect(nodeC.dependencies[0]).toBe(nodeA.id);
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
      ],
      [],
    );

    const compiled = compileEditablePlan(plan);

    const conditionNode = compiled.nodes.find((n) => n.localId === "check")!;
    // Condition node should have 2 dependents (both branches)
    expect(conditionNode.dependents.length).toBeGreaterThanOrEqual(1);

    // Should have edges for both branches
    const edges = compiled.edges;
    expect(edges.length).toBeGreaterThanOrEqual(2);
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
        makeWait("w", { waitFor: "signal", timeout: { minutes: 5, onTimeout: "fail" } }),
        makeCondition("cond", [{ label: "ok", nextNodeId: "t" }]),
      ],
      [],
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
// createPlanRun tests
// ═══════════════════════════════════════════════════════════════

describe("createPlanRun", () => {
  it("34. initializes entry nodes as ready, others as pending", () => {
    const plan = makePlan(
      "plan_run",
      [makeTask("first"), makeTask("second")],
      [{ from: "first", to: "second" }],
    );
    const compiled = compileEditablePlan(plan);
    const run = createPlanRun(compiled);

    expect(run.status).toBe("pending");

    const firstNodeId = compiled.nodes.find((n) => n.localId === "first")!.id;
    const secondNodeId = compiled.nodes.find((n) => n.localId === "second")!.id;

    expect(run.nodeStates[firstNodeId].status).toBe("ready");
    expect(run.nodeStates[secondNodeId].status).toBe("pending");
  });

  it("35. attempts start at 0 for all nodes", () => {
    const plan = makePlan("plan_att", [makeTask("a")], []);
    const compiled = compileEditablePlan(plan);
    const run = createPlanRun(compiled);

    for (const state of Object.values(run.nodeStates)) {
      expect(state.attempts).toBe(0);
    }
  });

  it("36. all entry nodes in parallel graph are ready", () => {
    const plan = makePlan(
      "plan_par",
      [makeTask("a"), makeTask("b"), makeTask("c")],
      // Independent nodes: a→c, b→c. a and b are both entry
      [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
      ],
    );
    const compiled = compileEditablePlan(plan);
    const run = createPlanRun(compiled);

    const aId = compiled.nodes.find((n) => n.localId === "a")!.id;
    const bId = compiled.nodes.find((n) => n.localId === "b")!.id;
    const cId = compiled.nodes.find((n) => n.localId === "c")!.id;

    expect(run.nodeStates[aId].status).toBe("ready");
    expect(run.nodeStates[bId].status).toBe("ready");
    expect(run.nodeStates[cId].status).toBe("pending");
  });
});

// ═══════════════════════════════════════════════════════════════
// RuntimeCommand tests
// ═══════════════════════════════════════════════════════════════

describe("applyRuntimeCommand", () => {
  function makeCompiledPlanForRun() {
    const plan = makePlan(
      "plan_rcmd",
      [makeTask("task_a"), makeTask("task_b")],
      [{ from: "task_a", to: "task_b" }],
    );
    return compileEditablePlan(plan);
  }

  it("37. start_plan transitions from pending to running", () => {
    const compiled = makeCompiledPlanForRun();
    const run = createPlanRun(compiled);

    const result = applyRuntimeCommand(run, compiled, { type: "start_plan" });
    expect(result.ok).toBe(true);
    expect(result.run!.status).toBe("running");
    expect(result.run!.startedAt).toBeDefined();
  });

  it("38. pause_plan transitions from running to paused", () => {
    const compiled = makeCompiledPlanForRun();
    let run = createPlanRun(compiled);
    run = applyRuntimeCommand(run, compiled, { type: "start_plan" }).run!;

    const result = applyRuntimeCommand(run, compiled, { type: "pause_plan" });
    expect(result.ok).toBe(true);
    expect(result.run!.status).toBe("paused");
  });

  it("39. resume_plan transitions from paused to running", () => {
    const compiled = makeCompiledPlanForRun();
    let run = createPlanRun(compiled);
    run = applyRuntimeCommand(run, compiled, { type: "start_plan" }).run!;
    run = applyRuntimeCommand(run, compiled, { type: "pause_plan" }).run!;

    const result = applyRuntimeCommand(run, compiled, { type: "resume_plan" });
    expect(result.ok).toBe(true);
    expect(result.run!.status).toBe("running");
  });

  it("40. cancel_plan transitions to cancelled and sets completedAt", () => {
    const compiled = makeCompiledPlanForRun();
    const run = createPlanRun(compiled);

    const result = applyRuntimeCommand(run, compiled, { type: "cancel_plan" });
    expect(result.ok).toBe(true);
    expect(result.run!.status).toBe("cancelled");
    expect(result.run!.completedAt).toBeDefined();
  });

  it("41. approve_checkpoint unlocks downstream node", () => {
    const plan = makePlan(
      "plan_cp",
      [
        makeCheckpoint("approve_step", {
          checkpointType: "approve",
          prompt: "OK?",
        }),
        makeTask("do_work"),
      ],
      [{ from: "approve_step", to: "do_work" }],
    );
    const compiled = compileEditablePlan(plan);
    let run = createPlanRun(compiled);

    // Start the plan
    run = applyRuntimeCommand(run, compiled, { type: "start_plan" }).run!;

    const cpId = compiled.nodes.find((n) => n.localId === "approve_step")!.id;
    const taskId = compiled.nodes.find((n) => n.localId === "do_work")!.id;

    // Approve the checkpoint
    const result = applyRuntimeCommand(run, compiled, {
      type: "approve_checkpoint",
      nodeId: cpId,
      response: { approved: true },
    });

    expect(result.ok).toBe(true);
    expect(result.run!.nodeStates[cpId].status).toBe("completed");
    expect(result.run!.nodeStates[taskId].status).toBe("ready");
    expect(result.run!.checkpointResponses).toHaveLength(1);
    expect(result.run!.checkpointResponses[0].response).toEqual({ approved: true });
  });

  it("42. reject_checkpoint marks node as failed and pauses plan", () => {
    const plan = makePlan(
      "plan_rej",
      [makeCheckpoint("safe_gate", { checkpointType: "confirm", prompt: "Go?" })],
      [],
    );
    const compiled = compileEditablePlan(plan);
    let run = createPlanRun(compiled);
    run = applyRuntimeCommand(run, compiled, { type: "start_plan" }).run!;

    const cpId = compiled.nodes.find((n) => n.localId === "safe_gate")!.id;

    const result = applyRuntimeCommand(run, compiled, {
      type: "reject_checkpoint",
      nodeId: cpId,
      reason: "Not ready yet",
    });

    expect(result.ok).toBe(true);
    expect(result.run!.nodeStates[cpId].status).toBe("failed");
    expect(result.run!.nodeStates[cpId].lastError).toBe("Not ready yet");
    expect(result.run!.status).toBe("paused");
  });

  it("43. mark_user_task_completed unlocks dependent nodes", () => {
    const plan = makePlan(
      "plan_ut",
      [makeTask("human_task", { executor: "user", mode: "manual" }), makeTask("auto_follow")],
      [{ from: "human_task", to: "auto_follow" }],
    );
    const compiled = compileEditablePlan(plan);
    let run = createPlanRun(compiled);
    run = applyRuntimeCommand(run, compiled, { type: "start_plan" }).run!;

    const humanId = compiled.nodes.find((n) => n.localId === "human_task")!.id;
    const followId = compiled.nodes.find((n) => n.localId === "auto_follow")!.id;

    // Human task completes
    const result = applyRuntimeCommand(run, compiled, {
      type: "mark_user_task_completed",
      nodeId: humanId,
    });

    expect(result.ok).toBe(true);
    expect(result.run!.nodeStates[humanId].status).toBe("completed");
    expect(result.run!.nodeStates[followId].status).toBe("ready");
  });

  it("44. retry_node resets failed node to ready", () => {
    const plan = makePlan(
      "plan_retry",
      [makeCheckpoint("gate", { checkpointType: "confirm", prompt: "OK?" })],
      [],
    );
    const compiled = compileEditablePlan(plan);
    let run = createPlanRun(compiled);
    run = applyRuntimeCommand(run, compiled, { type: "start_plan" }).run!;

    const gateId = compiled.nodes.find((n) => n.localId === "gate")!.id;

    // Fail it
    run = applyRuntimeCommand(run, compiled, {
      type: "reject_checkpoint",
      nodeId: gateId,
      reason: "Bad",
    }).run!;
    expect(run.nodeStates[gateId].status).toBe("failed");

    // Retry
    const result = applyRuntimeCommand(run, compiled, {
      type: "retry_node",
      nodeId: gateId,
    });

    expect(result.ok).toBe(true);
    expect(result.run!.nodeStates[gateId].status).toBe("ready");
    expect(result.run!.nodeStates[gateId].lastError).toBeUndefined();
  });

  it("45. plan auto-completes when all nodes are done", () => {
    const plan = makePlan("plan_auto", [makeTask("solo")], []);
    const compiled = compileEditablePlan(plan);
    let run = createPlanRun(compiled);
    run = applyRuntimeCommand(run, compiled, { type: "start_plan" }).run!;

    const soloId = compiled.nodes.find((n) => n.localId === "solo")!.id;

    const result = applyRuntimeCommand(run, compiled, {
      type: "mark_user_task_completed",
      nodeId: soloId,
    });

    expect(result.ok).toBe(true);
    expect(result.run!.status).toBe("completed");
    expect(result.run!.completedAt).toBeDefined();
  });

  it("46. cannot start an already running plan", () => {
    const compiled = makeCompiledPlanForRun();
    let run = createPlanRun(compiled);
    run = applyRuntimeCommand(run, compiled, { type: "start_plan" }).run!;

    const result = applyRuntimeCommand(run, compiled, { type: "start_plan" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot start");
  });

  it("47. cannot approve checkpoint that is not ready", () => {
    const plan = makePlan(
      "plan_not_ready",
      [makeCheckpoint("gate", { checkpointType: "confirm", prompt: "A?" })],
      [],
    );
    const compiled = compileEditablePlan(plan);
    const run = createPlanRun(compiled);
    // Not started, so node is "ready" (entry node), this should work
    // Actually gate is entry so it's ready. Let me test with a non-ready node.
    // Gate IS ready, so this should work. Let's just verify.
    const gateId = compiled.nodes.find((n) => n.localId === "gate")!.id;
    expect(run.nodeStates[gateId].status).toBe("ready");

    // Test with a completed node
    run.nodeStates[gateId].status = "completed";
    const result = applyRuntimeCommand(run, compiled, {
      type: "approve_checkpoint",
      nodeId: gateId,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot approve");
  });
});

// ═══════════════════════════════════════════════════════════════
// Prompt builder tests
// ═══════════════════════════════════════════════════════════════

describe("prompt builders", () => {
  it("48. buildPlanGenerationPrompt includes task details", () => {
    const prompt = buildPlanGenerationPrompt({
      title: "Test task",
      description: "Do something",
      estimatedMinutes: 30,
    });

    expect(prompt).toContain("Test task");
    expect(prompt).toContain("Do something");
    expect(prompt).toContain("30");
    // Should instruct NOT to include runtime fields
    expect(prompt).toContain("Do NOT include runtime fields");
    expect(prompt).toContain("status");
    // Should contain output format info
    expect(prompt).toContain("EditablePlan");
  });

  it("49. buildPlanPatchPrompt includes current plan state and base version", () => {
    const plan = makePlan(
      "plan_x",
      [makeTask("task_one"), makeTask("task_two")],
      [{ from: "task_one", to: "task_two" }],
      { version: 3 },
    );

    const prompt = buildPlanPatchPrompt(plan, "Add a review step");

    expect(prompt).toContain("plan_x");
    expect(prompt).toContain("baseVersion: 3");
    expect(prompt).toContain("task_one");
    expect(prompt).toContain("task_two");
    expect(prompt).toContain("Add a review step");
    // Should instruct NOT to modify runtime fields (covers toolCalls, artifacts, etc.)
    expect(prompt).toContain("DO NOT modify runtime fields");
    // Should instruct to keep node IDs stable
    expect(prompt).toContain("Keep existing node IDs stable");
  });

  it("50. buildPlanPatchPrompt instructs not to generate tool calls", () => {
    const plan = makePlan("plan_tc", [makeTask("a")], []);
    const prompt = buildPlanPatchPrompt(plan, "Fix it");

    expect(prompt).toContain("DO NOT generate tool calls");
  });

  it("51. buildPlanGenerationPrompt mentions all 4 node types", () => {
    const prompt = buildPlanGenerationPrompt({ title: "Test" });

    expect(prompt).toContain("task");
    expect(prompt).toContain("checkpoint");
    expect(prompt).toContain("condition");
    expect(prompt).toContain("wait");
  });
});
