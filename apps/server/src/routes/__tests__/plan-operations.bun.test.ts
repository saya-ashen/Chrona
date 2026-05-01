import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { MemoryScope, MemorySourceType, MemoryStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import { getLatestTaskPlanGraph, saveTaskPlanGraph } from "@chrona/runtime/modules/tasks/task-plan-graph-store";
import type {
  TaskPlanNodeType,
  TaskPlanNodeStatus,
  TaskPlanNodeExecutionMode,
  TaskPlanNodeBlockingReason,
  TaskPlanEdgeType,
} from "@chrona/contracts/ai";

// ---------------------------------------------------------------------------
// Inline HTTP helpers (avoid loading full api.ts → cascade imports)
// ---------------------------------------------------------------------------

function err(c: Context, message: string, status: number = 400) {
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

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return err(c, "Task not found", 404);

      const currentPlanGraph = await getLatestTaskPlanGraph(taskId);
      if (!currentPlanGraph) return err(c, "No plan found for this task", 404);

      const plan = {
        ...currentPlanGraph.plan,
        nodes: currentPlanGraph.plan.nodes.map((n: Record<string, unknown>) => ({ ...n })),
        edges: currentPlanGraph.plan.edges.map((e: Record<string, unknown>) => ({ ...e })),
      } as typeof currentPlanGraph.plan;

      switch (operation) {
        case "add_node": {
          if (!nodes || nodes.length === 0) {
            return err(c, "add_node requires nodes[]", 400);
          }
          const newNodes = nodes.map((n, i) => ({
            id: typeof n.id === "string" && n.id.trim() ? n.id : `node-${Date.now()}-${i}`,
            type: (typeof n.type === "string" ? n.type : "step") as TaskPlanNodeType,
            title: typeof n.title === "string" && n.title.trim() ? n.title : `Step ${plan.nodes.length + i + 1}`,
            objective: typeof n.objective === "string" && n.objective.trim() ? n.objective : (typeof n.title === "string" && n.title.trim() ? n.title : `Step ${plan.nodes.length + i + 1}`),
            description: typeof n.description === "string" && n.description.trim() ? n.description : null,
            status: "pending" as TaskPlanNodeStatus,
            phase: null as string | null,
            estimatedMinutes: typeof n.estimatedMinutes === "number" ? n.estimatedMinutes : null,
            priority: typeof n.priority === "string" ? n.priority as "Low" | "Medium" | "High" | "Urgent" | null : null,
            executionMode: (n.executionMode === "manual" || n.executionMode === "hybrid" ? n.executionMode : "automatic") as TaskPlanNodeExecutionMode,
            requiresHumanInput: Boolean(n.requiresHumanInput),
            requiresHumanApproval: Boolean(n.requiresHumanApproval),
            autoRunnable: !n.requiresHumanInput && !n.requiresHumanApproval,
            blockingReason: null as TaskPlanNodeBlockingReason,
            linkedTaskId: null as string | null,
            completionSummary: null as string | null,
            metadata: null as Record<string, unknown> | null,
          }));
          plan.nodes = [...plan.nodes, ...newNodes] as typeof plan.nodes;
          if (edges && edges.length > 0) {
            plan.edges = [...plan.edges, ...edges.map((e, i) => ({
              id: typeof e.id === "string" && e.id.trim() ? e.id : `edge-${Date.now()}-${i}`,
              fromNodeId: e.fromNodeId as string,
              toNodeId: e.toNodeId as string,
              type: (e.type === "depends_on" || e.type === "branches_to" || e.type === "unblocks" || e.type === "feeds_output" ? e.type : "sequential") as TaskPlanEdgeType,
              metadata: null as Record<string, unknown> | null,
            }))] as typeof plan.edges;
          }
          break;
        }
        case "update_node": {
          if (!nodePatches || nodePatches.length === 0) {
            return err(c, "update_node requires nodePatches[]", 400);
          }
          const existingIds = new Set(plan.nodes.map((n) => n.id));
          const unknownIds = nodePatches.map((p) => p.id).filter((id) => !existingIds.has(id));
          if (unknownIds.length > 0) {
            return err(c, `Unknown node id(s): ${unknownIds.join(", ")}`, 400);
          }
          const patchMap = new Map(nodePatches.map((p) => [p.id, p]));
          plan.nodes = plan.nodes.map((node) => {
            const patch = patchMap.get(node.id);
            if (!patch) return node;
            return {
              ...node,
              ...(typeof patch.title === "string" ? { title: patch.title } : {}),
              ...(typeof patch.objective === "string" ? { objective: patch.objective } : {}),
              ...(typeof patch.description === "string" ? { description: patch.description } : {}),
              ...(typeof patch.estimatedMinutes === "number" ? { estimatedMinutes: patch.estimatedMinutes } : {}),
              ...(typeof patch.status === "string" ? { status: patch.status as TaskPlanNodeStatus } : {}),
              ...(typeof patch.priority === "string" ? { priority: patch.priority as typeof node["priority"] } : {}),
              ...(typeof patch.executionMode === "string" ? { executionMode: patch.executionMode as TaskPlanNodeExecutionMode } : {}),
            };
          });
          break;
        }
        case "delete_node": {
          if (!deletedNodeIds || deletedNodeIds.length === 0) {
            return err(c, "delete_node requires deletedNodeIds[]", 400);
          }
          const deleteSet = new Set(deletedNodeIds);
          plan.nodes = plan.nodes.filter((n) => !deleteSet.has(n.id));
          plan.edges = plan.edges.filter(
            (e) => !deleteSet.has(e.fromNodeId) && !deleteSet.has(e.toNodeId),
          );
          break;
        }
        case "update_dependencies": {
          if (!edges || edges.length === 0) {
            return err(c, "update_dependencies requires edges[]", 400);
          }
          const existingIds = new Set(plan.nodes.map((n) => n.id));
          const missingFrom = edges.filter((e) => !existingIds.has(e.fromNodeId as string));
          const missingTo = edges.filter((e) => !existingIds.has(e.toNodeId as string));
          if (missingFrom.length > 0) {
            return err(c, `Unknown fromNodeId(s): ${missingFrom.map((e) => e.fromNodeId).join(", ")}`, 400);
          }
          if (missingTo.length > 0) {
            return err(c, `Unknown toNodeId(s): ${missingTo.map((e) => e.toNodeId).join(", ")}`, 400);
          }
          const newEdgeIds = new Set(edges.map((e) => `${e.fromNodeId}->${e.toNodeId}`));
          plan.edges = [
            ...plan.edges.filter((e) => !newEdgeIds.has(`${e.fromNodeId}->${e.toNodeId}`)),
            ...edges.map((e, i) => ({
              id: typeof e.id === "string" && e.id.trim() ? e.id : `edge-${Date.now()}-${i}`,
              fromNodeId: e.fromNodeId as string,
              toNodeId: e.toNodeId as string,
              type: (e.type === "depends_on" || e.type === "branches_to" || e.type === "unblocks" || e.type === "feeds_output" ? e.type : "sequential") as TaskPlanEdgeType,
              metadata: null as Record<string, unknown> | null,
            })),
          ] as typeof plan.edges;
          break;
        }
        case "reorder_nodes": {
          if (!reorder || reorder.length === 0) {
            return err(c, "reorder_nodes requires reorder[]", 400);
          }
          const orderMap = new Map(reorder.map((id, i) => [id, i]));
          const reordered = plan.nodes
            .filter((n) => orderMap.has(n.id))
            .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
          const firstIndex = plan.nodes.findIndex((n) => orderMap.has(n.id));
          const insertAt = firstIndex >= 0 ? firstIndex : plan.nodes.length;
          const kept = plan.nodes.filter((n) => !orderMap.has(n.id));
          plan.nodes = [...kept.slice(0, insertAt), ...reordered, ...kept.slice(insertAt)];
          break;
        }
        case "update_plan_summary": {
          if (summary !== undefined) {
            plan.summary = summary;
          }
          break;
        }
        default:
          return err(c, `Unsupported plan operation: ${operation}`, 400);
      }

      const savedPlan = await saveTaskPlanGraph({
        workspaceId: task.workspaceId,
        taskId,
        plan,
        prompt: currentPlanGraph.prompt,
        status: currentPlanGraph.status,
        source: "mixed",
        generatedBy: currentPlanGraph.generatedBy,
        summary: plan.summary ?? currentPlanGraph.summary,
        changeSummary: `Applied plan patch: ${operation}`,
      });

      return c.json({
        taskId,
        operation,
        planGraph: savedPlan.plan,
      }, 200);
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

  const nodes = [
    {
      id: "node-a", type: "step", title: "Research", objective: "Research the domain",
      description: "Gather materials", status: "pending", phase: "preparation",
      estimatedMinutes: 30, priority: "High", executionMode: "automatic",
      requiresHumanInput: false, requiresHumanApproval: false, autoRunnable: true,
      blockingReason: null, linkedTaskId: null, completionSummary: null, metadata: null,
    },
    {
      id: "node-b", type: "step", title: "Design", objective: "Design the solution",
      description: null, status: "pending", phase: "design",
      estimatedMinutes: 60, priority: "Medium", executionMode: "automatic",
      requiresHumanInput: false, requiresHumanApproval: true, autoRunnable: false,
      blockingReason: null, linkedTaskId: null, completionSummary: null, metadata: null,
    },
    {
      id: "node-c", type: "checkpoint", title: "Review", objective: "Review with team",
      description: "Get sign-off", status: "pending", phase: "review",
      estimatedMinutes: 15, priority: "High", executionMode: "manual",
      requiresHumanInput: true, requiresHumanApproval: true, autoRunnable: false,
      blockingReason: null, linkedTaskId: null, completionSummary: null, metadata: null,
    },
    {
      id: "node-d", type: "deliverable", title: "Ship", objective: "Deploy to production",
      description: null, status: "pending", phase: "execution",
      estimatedMinutes: 20, priority: "Urgent", executionMode: "automatic",
      requiresHumanInput: false, requiresHumanApproval: false, autoRunnable: true,
      blockingReason: null, linkedTaskId: null, completionSummary: null, metadata: null,
    },
  ];

  const edges = [
    { id: "edge-ab", fromNodeId: "node-a", toNodeId: "node-b", type: "depends_on", metadata: null },
    { id: "edge-bc", fromNodeId: "node-b", toNodeId: "node-c", type: "sequential", metadata: null },
    { id: "edge-cd", fromNodeId: "node-c", toNodeId: "node-d", type: "depends_on", metadata: null },
  ];

  const content = JSON.stringify({
    type: "task_plan_graph_v1",
    status: "accepted",
    revision: 1,
    source: "ai" as const,
    generatedBy: "graph-planner",
    prompt: "Build a 4-step workflow",
    summary: "Linear A→B→C→D flow",
    changeSummary: null,
    nodes,
    edges,
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

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  describe("add_node", () => {
    it("adds a new node and optional edges", async () => {
      const { taskId } = await seedPlan();
      const newNode = {
        id: "node-x",
        type: "tool_action",
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
        expect(added.type).toBe("tool_action");
        expect(added.status).toBe("pending");
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
        expect(updated.objective).toBe("Comprehensive study");
        expect(updated.status).toBe("pending");
        expect(updated.type).toBe("step");
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
      expect(b?.status).toBe("in_progress");
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
      expect(body.planGraph.edges.some((e) => e.fromNodeId === "node-b" || e.toNodeId === "node-b")).toBe(false);
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
            { fromNodeId: "node-a", toNodeId: "node-c", type: "branches_to" },
            { fromNodeId: "node-a", toNodeId: "node-d", type: "unblocks" },
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
});
