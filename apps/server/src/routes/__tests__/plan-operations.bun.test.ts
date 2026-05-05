import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { MemoryScope, MemorySourceType, MemoryStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import {
  getLatestCompiledPlan,
  saveCompiledPlan,
  materializeTaskPlan,
  applyPlanPatchCommand,
} from "@chrona/engine";
import { getAcceptedTaskPlanGraph } from "@chrona/engine";
import type {
  CompiledPlan,
  CompiledNode,
  CompiledEdge,
} from "@chrona/contracts/ai";

// ---------------------------------------------------------------------------
// Inline HTTP helpers (avoid loading full api.ts → cascade imports)
// ---------------------------------------------------------------------------

function _err(c: Context, message: string, status: number = 400) {
  return c.json({ error: message }, status as unknown as undefined);
}

function err500(c: Context, route: string, cause: unknown, fallback: string) {
  console.error(route, cause);
  return c.json({ error: fallback }, 500 as unknown as undefined);
}

// ---------------------------------------------------------------------------
// Standalone test router with only the plan endpoint
// ---------------------------------------------------------------------------

function createPlanTestRouter() {
  const api = new Hono();

  api.post("/tasks/:taskId/plan", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { operation, nodes, edges, nodePatches, deletedNodeIds, reorder, summary } =
        body as {
          operation: string;
          nodes?: Array<Record<string, unknown>>;
          edges?: Array<Record<string, unknown>>;
          nodePatches?: Array<{ id: string } & Record<string, unknown>>;
          deletedNodeIds?: string[];
          reorder?: string[];
          summary?: string;
        };

      const result = await applyPlanPatchCommand({
        taskId,
        operation,
        nodes,
        edges,
        nodePatches,
        deletedNodeIds,
        reorder,
        summary,
      });

      return c.json({
        taskId: result.taskId,
        operation: result.operation,
        planGraph: { ...(result.compiledPlan as unknown as Record<string, unknown>), ...(summary !== undefined ? { summary } : {}) },
      } as Record<string, unknown>, 200);
    } catch (cause) {
      return err500(c, "POST /api/tasks/:taskId/plan", cause, "Failed to apply plan patch");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createPlanTestRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

interface SeedResult {
  workspaceId: string;
  taskId: string;
  planId: string;
}

async function seedPlan(): Promise<SeedResult> {
  const workspace = await db.workspace.create({
    data: { name: "Plan Ops Test", status: "Active", defaultRuntime: "openclaw" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Test flow graph task",
      status: "Ready",
      priority: "High",
      ownerType: "human",
    },
  });

  const edges = [
    { id: "edge-ab", from: "node-a", to: "node-b" },
    { id: "edge-bc", from: "node-b", to: "node-c" },
    { id: "edge-cd", from: "node-c", to: "node-d" },
  ];

  const compiledPlan: CompiledPlan = {
    id: "plan-test",
    editablePlanId: "editable-test",
    sourceVersion: 1,
    title: "Test flow",
    goal: "Linear A→B→C→D flow",
    assumptions: [],
    nodes: [
      {
        id: "node-a", localId: "node-a", type: "task", title: "Research",
        config: { type: "task", objective: "Research the domain" } as any,
        dependencies: [], dependents: ["node-b"],
        executor: "ai", mode: "auto", estimatedMinutes: 30, priority: "High",
      },
      {
        id: "node-b", localId: "node-b", type: "task", title: "Design",
        config: { type: "task", objective: "Design the solution" } as any,
        dependencies: ["node-a"], dependents: ["node-c"],
        executor: "ai", mode: "auto", estimatedMinutes: 60, priority: "Medium",
      },
      {
        id: "node-c", localId: "node-c", type: "checkpoint", title: "Review",
        config: { type: "checkpoint", checkpointType: "approve", prompt: "Get sign-off" } as any,
        dependencies: ["node-b"], dependents: ["node-d"],
        executor: "user", mode: "manual", estimatedMinutes: 15, priority: "High",
      },
      {
        id: "node-d", localId: "node-d", type: "task", title: "Ship",
        config: { type: "task", objective: "Deploy to production" } as any,
        dependencies: ["node-c"], dependents: [],
        executor: "ai", mode: "auto", estimatedMinutes: 20, priority: "Urgent",
      },
    ] as CompiledNode[],
    edges: edges as CompiledEdge[],
    entryNodeIds: ["node-a"],
    terminalNodeIds: ["node-d"],
    topologicalOrder: ["node-a", "node-b", "node-c", "node-d"],
    completionPolicy: { type: "all_tasks_completed" } as CompiledPlan["completionPolicy"],
    validationWarnings: [],
  };

  const content = JSON.stringify({
    type: "compiled_plan_v1",
    compiledPlan,
    editablePlan: null,
    status: "accepted",
    prompt: "Build a 4-step workflow",
    summary: "Linear A→B→C→D flow",
    generatedBy: "graph-planner",
  });

  const memory = await db.memory.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      content,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: 1,
    },
  });

  return { workspaceId: workspace.id, taskId: task.id, planId: memory.id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:taskId/plan", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("add_node", () => {
    it("adds a new node and optional edges", async () => {
      const { taskId } = await seedPlan();
      const newNode = {
        id: "node-x",
        type: "task",
        title: "Auto-fix",
        objective: "Auto-fix lint issues",
        priority: "Low",
        executionMode: "automatic",
      };
      const newEdge = { fromNodeId: "node-c", toNodeId: "node-x", type: "sequential" };

      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "add_node",
          nodes: [newNode],
          edges: [newEdge],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: unknown[]; edges: unknown[] } };

      expect(body.planGraph.nodes).toHaveLength(5);
      const added = (body.planGraph.nodes as Record<string, unknown>[]).find((n) => n.id === "node-x");
      expect(added).toBeTruthy();
      if (added) {
        expect(added.title).toBe("Auto-fix");
        expect(added.type).toBe("task");
      }

      expect(body.planGraph.edges).toHaveLength(4);
    });

    it("adds node without edges (intentionally floating)", async () => {
      const { taskId } = await seedPlan();
      const newNode = { id: "node-y", title: "Orphan", objective: "No edges" };

      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "add_node", nodes: [newNode] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: unknown[]; edges: unknown[] } };
      expect(body.planGraph.nodes).toHaveLength(5);
      expect(body.planGraph.edges).toHaveLength(3);
    });

    it("auto-generates id if missing", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "add_node",
          nodes: [{ title: "No ID", objective: "Auto ID" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: Record<string, unknown>[] } };
      const added = body.planGraph.nodes.find((n) => n.id && (n.id as string).startsWith("node-"));
      expect(added).toBeTruthy();
    });

    it("returns 400 when nodes[] is empty", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "add_node", nodes: [] }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("update_node", () => {
    it("updates node title and objective", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_node",
          nodePatches: [
            { id: "node-a", title: "Deep Research", objective: "Comprehensive study" },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: Record<string, unknown>[] } };
      const updated = body.planGraph.nodes.find((n) => n.id === "node-a");
      expect(updated).toBeTruthy();
      if (updated) {
        expect(updated.title).toBe("Deep Research");
        expect((updated.config as Record<string, unknown>)?.expectedOutput).toBe("Comprehensive study");
        expect(updated.type).toBe("task");
      }
    });

    it("updates multiple nodes at once", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_node",
          nodePatches: [
            { id: "node-b", title: "Sketch", status: "in_progress" },
            { id: "node-d", priority: "Low", estimatedMinutes: 5 },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: Record<string, unknown>[] } };
      const b = body.planGraph.nodes.find((n) => n.id === "node-b");
      const d = body.planGraph.nodes.find((n) => n.id === "node-d");
      expect(b?.title).toBe("Sketch");
      expect(d?.priority).toBe("Low");
      expect(d?.estimatedMinutes).toBe(5);
    });

    it("returns 400 for unknown node id", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_node",
          nodePatches: [{ id: "nonexistent", title: "Ghost" }],
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("delete_node", () => {
    it("removes a node and its incident edges", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "delete_node",
          deletedNodeIds: ["node-b"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: unknown[]; edges: Record<string, unknown>[] } };
      expect(body.planGraph.nodes).toHaveLength(3);
      expect(body.planGraph.nodes.some((n: any) => n.id === "node-b")).toBe(false);
      // only edge-cd (c→d) remains — edge-ab (a→b) and edge-bc (b→c) deleted
      expect(body.planGraph.edges).toHaveLength(1);
      expect(body.planGraph.edges.some((e) => e.from === "node-b" || e.to === "node-b")).toBe(false);
    });

    it("deletes multiple nodes", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "delete_node",
          deletedNodeIds: ["node-a", "node-d"],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: unknown[]; edges: unknown[] } };
      expect(body.planGraph.nodes).toHaveLength(2);
      expect(body.planGraph.edges).toHaveLength(1);
    });
  });

  describe("reorder_nodes", () => {
    it("reorders nodes within their original index range", async () => {
      const { taskId } = await seedPlan();
      // original: [a, b, c, d], swap b and c → [a, c, b, d]
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "reorder_nodes",
          reorder: ["node-c", "node-b"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: { id: string }[] } };
      const ids = body.planGraph.nodes.map((n) => n.id);
      expect(ids).toEqual(["node-a", "node-c", "node-b", "node-d"]);
    });

    it("handles non-contiguous reorder — pushes to first index", async () => {
      const { taskId } = await seedPlan();
      // reorder [c(index=2), a(index=0)]: pushed to index 0, then b(1), d(3) follow
      // result: [c, a, b, d] — kept nodes follow reordered block
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "reorder_nodes",
          reorder: ["node-c", "node-a"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: { id: string }[] } };
      const ids = body.planGraph.nodes.map((n) => n.id);
      expect(ids).toEqual(["node-c", "node-a", "node-b", "node-d"]);
    });
  });

  describe("update_dependencies", () => {
    it("adds new edges", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_dependencies",
          edges: [
            { fromNodeId: "node-a", toNodeId: "node-c", type: "depends_on" },
            { fromNodeId: "node-a", toNodeId: "node-d", type: "sequential" },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { edges: Record<string, unknown>[] } };
      expect(body.planGraph.edges).toHaveLength(5);
    });

    it("deduplicates existing edge", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_dependencies",
          edges: [{ fromNodeId: "node-a", toNodeId: "node-b", type: "depends_on" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { edges: unknown[] } };
      expect(body.planGraph.edges).toHaveLength(3);
    });

    it("returns 400 when referencing unknown nodes", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_dependencies",
          edges: [{ fromNodeId: "ghost", toNodeId: "node-a", type: "sequential" }],
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("update_plan_summary", () => {
    it("updates the plan summary", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_plan_summary",
          summary: "Revised workflow",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { summary: string } };
      expect(body.planGraph.summary).toBe("Revised workflow");
    });
  });

  describe("edge cases", () => {
    it("returns 400 for unsupported operation", async () => {
      const { taskId } = await seedPlan();
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "custom" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 when task has no plan", async () => {
      const workspace = await db.workspace.create({
        data: { name: "No Plan", status: "Active", defaultRuntime: "openclaw" },
      });
      const task = await db.task.create({
        data: { workspaceId: workspace.id, title: "No plan", status: "Ready", ownerType: "human", priority: "Medium" },
      });
      const res = await app().request(`http://local/api/tasks/${task.id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "update_plan_summary", summary: "nope" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for nonexistent task", async () => {
      const res = await app().request("http://local/api/tasks/nonexistent-id/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "update_plan_summary", summary: "nope" }),
      });
      expect(res.status).toBe(404);
    });

    it("preserves non-target nodes after update", async () => {
      const { taskId } = await seedPlan();

      await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_node",
          nodePatches: [{ id: "node-a", title: "New Title" }],
        }),
      });

      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "update_plan_summary", summary: "Check" }),
      });

      const body = await res.json() as { planGraph: { nodes: Record<string, unknown>[] } };
      const nodeA = body.planGraph.nodes.find((n) => n.id === "node-a");
      const nodeB = body.planGraph.nodes.find((n) => n.id === "node-b");
      const nodeC = body.planGraph.nodes.find((n) => n.id === "node-c");
      const nodeD = body.planGraph.nodes.find((n) => n.id === "node-d");

      expect(nodeA?.title).toBe("New Title");
      expect(nodeB?.title).toBe("Design");
      expect(nodeC?.type).toBe("checkpoint");
      expect(nodeD?.priority).toBe("Urgent");
    });

    it("deep-clones plan — sequential mutations do not corrupt", async () => {
      const { taskId } = await seedPlan();

      // Mutation 1: rename node-a
      await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_node",
          nodePatches: [{ id: "node-a", title: "Mutated" }],
        }),
      });

      // Mutation 2: add a node
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "add_node",
          nodes: [{ id: "node-e", title: "Extra", objective: "Added later" }],
        }),
      });

      const body = await res.json() as { planGraph: { nodes: Record<string, unknown>[] } };
      const nodeA = body.planGraph.nodes.find((n) => n.id === "node-a");
      const nodeE = body.planGraph.nodes.find((n) => n.id === "node-e");

      // Both mutations should be visible in the latest plan
      expect(nodeA?.title).toBe("Mutated");
      expect(nodeE?.title).toBe("Extra");
      expect(body.planGraph.nodes).toHaveLength(5);
    });

    it("modify then reorder keeps all changes", async () => {
      const { taskId } = await seedPlan();

      // Rename node-d
      await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "update_node",
          nodePatches: [{ id: "node-d", title: "Deploy!" }],
        }),
      });

      // Reorder: move node-d to position of node-b
      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "reorder_nodes",
          reorder: ["node-d", "node-b", "node-c"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: { id: string; title: string }[] } };
      const ids = body.planGraph.nodes.map((n) => n.id);
      // d was at index 3, now at index 1 (first reorder slot)
      // order should be: [a, d, b, c]
      expect(ids).toEqual(["node-a", "node-d", "node-b", "node-c"]);

      const nodeD = body.planGraph.nodes.find((n) => n.id === "node-d");
      expect(nodeD?.title).toBe("Deploy!");
    });
  });

  describe("replace_plan", () => {
    it("replaces the entire plan with new nodes and edges", async () => {
      const { taskId } = await seedPlan();

      const newNodes = [
        { id: "node-x", type: "step", title: "X Step", objective: "Do X" },
        { id: "node-y", type: "checkpoint", title: "Y Check", objective: "Check Y" },
      ];
      const newEdges = [
        { fromNodeId: "node-x", toNodeId: "node-y", type: "sequential" },
      ];

      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "replace_plan",
          nodes: newNodes,
          edges: newEdges,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: unknown[]; edges: unknown[] } };
      expect(body.planGraph.nodes).toHaveLength(2);
      expect(body.planGraph.edges).toHaveLength(1);
    });

    it("replaced plan has no old node IDs", async () => {
      const { taskId } = await seedPlan();

      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "replace_plan",
          nodes: [{ id: "node-x", type: "step", title: "Only Node", objective: "Sole objective" }],
          edges: [],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { planGraph: { nodes: { id: string }[]; edges: unknown[] } };
      const nodeIds = body.planGraph.nodes.map((n) => n.id);
      expect(nodeIds).not.toContain("node-a");
      expect(nodeIds).not.toContain("node-b");
      expect(nodeIds).not.toContain("node-c");
      expect(nodeIds).not.toContain("node-d");
      expect(nodeIds).toContain("node-x");
    });

    it("replaced plan has correct node fields", async () => {
      const { taskId } = await seedPlan();

      const res = await app().request(`http://local/api/tasks/${taskId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "replace_plan",
          nodes: [
            {
              id: "the-one",
              type: "task",
              title: "Final Deliverable",
              objective: "Ship it",
              status: "in_progress",
              priority: "Urgent",
              estimatedMinutes: 120,
            },
          ],
          edges: [],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        planGraph: { nodes: Array<{ id: string; title: string; type: string; status: string; priority: string; estimatedMinutes: number }> };
      };
      expect(body.planGraph.nodes.length).toBe(1);
      expect(body.planGraph.nodes[0].id).toBe("the-one");
      expect(body.planGraph.nodes[0].title).toBe("Final Deliverable");
          expect(body.planGraph.nodes[0].type).toBe("task");
      expect(body.planGraph.nodes[0].priority).toBe("Urgent");
      expect(body.planGraph.nodes[0].estimatedMinutes).toBe(120);
    });
  });

  describe("materialize_child_tasks", () => {
    it("linkedTaskId is set on plan nodes after materialization", async () => {
      const { workspaceId: _workspaceId, taskId, planId: _planId } = await seedPlan();

      // Ensure the plan is accepted
      const latest = await getLatestCompiledPlan(taskId);
      if (latest) {
        await saveCompiledPlan({
          workspaceId: latest.workspaceId,
          taskId,
          compiledPlan: latest.compiledPlan,
          status: "accepted",
          prompt: latest.prompt,
          summary: latest.summary,
          generatedBy: latest.generatedBy,
        });
      }

      // Materialize
      const materialized = await materializeTaskPlan({ taskId });

      expect(materialized.createdTaskIds.length).toBeGreaterThan(0);

      // Verify linkedTaskId on accepted plan nodes
      const acceptedPlan = await getAcceptedTaskPlanGraph(taskId);
      expect(acceptedPlan).toBeTruthy();
      const materializedNodes = acceptedPlan!.plan.nodes.filter(
        (node) => typeof node.linkedTaskId === "string" && (node.linkedTaskId as string).length > 0,
      );
      expect(materializedNodes.length).toBeGreaterThan(0);

      // Verify child tasks have correct parentTaskId
      const childTasks = await db.task.findMany({
        where: { id: { in: materialized.createdTaskIds } },
      });
      expect(childTasks.length).toBe(materialized.createdTaskIds.length);
      expect(childTasks.every((t) => t.parentTaskId === taskId)).toBe(true);
    });
  });
});
