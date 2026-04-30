/**
 * Real integration tests for plan generation.
 * These call the actual LLM API (CPA) — NOT mocked.
 *
 * Requires:
 *   - CPA endpoint reachable at https://cpa.saya.love/v1
 *   - Valid API key in DB or TEST_CPA_API_KEY env var
 *   - RUN_LLM_INTEGRATION=1
 *
 * Run: RUN_LLM_INTEGRATION=1 bunx vitest run src/modules/ai/__tests__/plan-generation.integration.test.ts
 *
 * @vitest-environment bun
 */

import { describe, it, expect } from "vitest";
import { extractJSON, llmCall, SYSTEM_PROMPTS } from "@chrona/ai-features";
import type { TaskPlanNode, TaskPlanEdge } from "../types";
import { getReadyAutoRunnableNodes } from "@/modules/tasks/task-plan-graph-store";

// -- Config --

const LLM_CONFIG = {
  baseUrl: process.env.TEST_CPA_BASE_URL ?? "https://cpa.saya.love/v1",
  apiKey: process.env.TEST_CPA_API_KEY ?? "",
  model: process.env.TEST_CPA_MODEL ?? "gpt-5.2",
  temperature: 0.7,
};
const RUN_LLM_INTEGRATION = process.env.RUN_LLM_INTEGRATION === "1";

// Try to load API key from DB if not in env
async function ensureApiKey() {
  if (LLM_CONFIG.apiKey) return;
  try {
    const { execSync } = await import("node:child_process");
    const key = execSync(
      `sqlite3 prisma/dev.db "SELECT json_extract(config, '$.apiKey') FROM AiClient WHERE name='CPA';"`,
      { encoding: "utf-8", cwd: process.cwd() },
    ).trim();
    if (key) LLM_CONFIG.apiKey = key;
  } catch {
    // skip
  }
  if (!LLM_CONFIG.apiKey) {
    throw new Error("No API key: set TEST_CPA_API_KEY or ensure prisma/dev.db has CPA client");
  }
}

// -- Helpers --

function normalizeNodeType(value: unknown): TaskPlanNode["type"] {
  const valid = ["step", "checkpoint", "decision", "user_input", "deliverable", "tool_action"];
  return valid.includes(value as string) ? (value as TaskPlanNode["type"]) : "step";
}

function normalizeEdgeType(value: unknown): TaskPlanEdge["type"] {
  const valid = ["sequential", "depends_on", "branches_to", "unblocks", "feeds_output"];
  return valid.includes(value as string) ? (value as TaskPlanEdge["type"]) : "sequential";
}

function normalizePriority(value: unknown): "Low" | "Medium" | "High" | "Urgent" | null {
  if (typeof value !== "string") return null;
  const n = value.trim().toLowerCase();
  if (n === "low") return "Low";
  if (n === "medium") return "Medium";
  if (n === "high") return "High";
  if (n === "urgent") return "Urgent";
  return null;
}

function parseGraphResponse(raw: string) {
  const toolJsonMatch = raw.match(
    /```(?:json|tool)?\s*\n?(?:generate_task_plan_graph\s*\n)?([\s\S]*?)```/,
  );
  const candidate = toolJsonMatch?.[1]?.trim() || raw;
  const parsed = extractJSON<{
    summary?: string;
    reasoning?: string;
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
  }>(candidate, "llm");

  const nodes: TaskPlanNode[] = (parsed.nodes ?? []).map((n, i) => {
    const execMode =
      n.executionMode === "manual" || n.executionMode === "hybrid"
        ? (n.executionMode as "manual" | "hybrid")
        : ("automatic" as const);
    const requiresInput = Boolean(n.requiresHumanInput);
    const requiresApproval = Boolean(n.requiresHumanApproval);
    const autoRunnable = execMode === "automatic" && !requiresInput && !requiresApproval;

    return {
      id: (n.id as string) ?? `node-${i + 1}`,
      type: normalizeNodeType(n.type),
      title: (n.title as string) ?? `Step ${i + 1}`,
      objective: (n.objective as string) ?? (n.title as string) ?? `Step ${i + 1}`,
      description: (n.description as string) ?? null,
      status: "pending" as const,
      phase: (n.phase as string) ?? null,
      estimatedMinutes: typeof n.estimatedMinutes === "number" ? n.estimatedMinutes : 30,
      priority: normalizePriority(n.priority),
      executionMode: execMode,
      requiresHumanInput: requiresInput,
      requiresHumanApproval: requiresApproval,
      autoRunnable,
      blockingReason: requiresInput
        ? ("needs_user_input" as const)
        : requiresApproval
          ? ("needs_approval" as const)
          : null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
    };
  });

  const edges: TaskPlanEdge[] = (parsed.edges ?? []).map((e, i) => ({
    id: (e.id as string) ?? `edge-${i + 1}`,
    fromNodeId: ((e.fromNodeId ?? e.from ?? "") as string),
    toNodeId: ((e.toNodeId ?? e.to ?? "") as string),
    type: normalizeEdgeType(e.type),
    metadata: null,
  }));

  return {
    summary: (parsed.summary as string) ?? "",
    reasoning: parsed.reasoning as string | undefined,
    nodes,
    edges,
  };
}

// -- Tests --

describe.runIf(RUN_LLM_INTEGRATION)("Plan generation (real LLM)", () => {
  it("generates a valid graph with nodes and edges", async () => {
    await ensureApiKey();

    const msg = `Generate an executable task plan graph for:
Title: "Write unit tests for a REST API"
Estimated: 60 min

Return JSON.`;

    const raw = await llmCall(LLM_CONFIG, SYSTEM_PROMPTS.generate_plan, msg, {
      jsonMode: true,
      temperature: 0.7,
    });

    const graph = parseGraphResponse(raw);

    expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
    expect(graph.summary).toBeTruthy();

    // Every node has required fields
    for (const n of graph.nodes) {
      expect(n.id).toBeTruthy();
      expect(n.title).toBeTruthy();
      expect(n.objective).toBeTruthy();
      expect(["automatic", "manual", "hybrid"]).toContain(n.executionMode);
      expect(typeof n.autoRunnable).toBe("boolean");
      expect(typeof n.requiresHumanInput).toBe("boolean");
      expect(typeof n.requiresHumanApproval).toBe("boolean");
    }

    // Every edge references valid nodes
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      expect(nodeIds.has(e.fromNodeId)).toBe(true);
      expect(nodeIds.has(e.toNodeId)).toBe(true);
    }

    // Graph must NOT be purely linear — should have parallelism
    const outDeg = new Map<string, number>();
    const inDeg = new Map<string, number>();
    for (const e of graph.edges) {
      outDeg.set(e.fromNodeId, (outDeg.get(e.fromNodeId) ?? 0) + 1);
      inDeg.set(e.toNodeId, (inDeg.get(e.toNodeId) ?? 0) + 1);
    }
    const hasFanOut = [...outDeg.values()].some((d) => d > 1);
    const hasFanIn = [...inDeg.values()].some((d) => d > 1);
    expect(hasFanOut || hasFanIn).toBe(true);
  }, 120_000);

  it("separates automatic and manual nodes", async () => {
    await ensureApiKey();

    const msg = `Generate an executable task plan graph for:
Title: "Deploy a new microservice to production"
Description: Need to write code, get code review approval, then deploy.
Estimated: 90 min

Return JSON.`;

    const raw = await llmCall(LLM_CONFIG, SYSTEM_PROMPTS.generate_plan, msg, {
      jsonMode: true,
      temperature: 0.5,
    });

    const graph = parseGraphResponse(raw);

    const autoNodes = graph.nodes.filter((n) => n.autoRunnable);
    const manualNodes = graph.nodes.filter((n) => !n.autoRunnable);

    // Should have both types — deployment has auto steps (build, deploy)
    // and manual steps (code review approval)
    expect(autoNodes.length).toBeGreaterThanOrEqual(1);
    expect(manualNodes.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("autoRunnable is false when requiresHumanApproval is true", async () => {
    await ensureApiKey();

    const msg = `Generate an executable task plan graph for:
Title: "Publish a blog post"
Description: Write draft, get editor approval, then publish.
Estimated: 45 min

Return JSON.`;

    const raw = await llmCall(LLM_CONFIG, SYSTEM_PROMPTS.generate_plan, msg, {
      jsonMode: true,
      temperature: 0.3,
    });

    const graph = parseGraphResponse(raw);

    // Normalization should ensure this invariant
    for (const n of graph.nodes) {
      if (n.requiresHumanApproval || n.requiresHumanInput) {
        expect(n.autoRunnable).toBe(false);
      }
    }
  }, 120_000);
});

describe("getReadyAutoRunnableNodes", () => {
  it("returns root auto nodes when nothing is completed", () => {
    const graph = {
      id: "test-1",
      taskId: "t1",
      status: "draft" as const,
      revision: 1,
      source: "ai" as const,
      generatedBy: "test",
      prompt: null,
      summary: "test",
      changeSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        makeNode("n1", { autoRunnable: true, executionMode: "automatic" }),
        makeNode("n2", { autoRunnable: false, executionMode: "manual", requiresHumanInput: true }),
        makeNode("n3", { autoRunnable: true, executionMode: "automatic" }),
      ],
      edges: [
        makeEdge("e1", "n1", "n2"),
        makeEdge("e2", "n2", "n3"),
      ],
    };

    const ready = getReadyAutoRunnableNodes(graph);
    // n1 has no deps → ready. n3 depends on n2 (pending) → not ready.
    expect(ready.map((n) => n.id)).toEqual(["n1"]);
  });

  it("unblocks auto node after manual predecessor completes", () => {
    const graph = {
      id: "test-2",
      taskId: "t1",
      status: "draft" as const,
      revision: 1,
      source: "ai" as const,
      generatedBy: "test",
      prompt: null,
      summary: "test",
      changeSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        makeNode("n1", { autoRunnable: false, executionMode: "manual", requiresHumanInput: true, status: "done" }),
        makeNode("n2", { autoRunnable: true, executionMode: "automatic" }),
        makeNode("n3", { autoRunnable: true, executionMode: "automatic" }),
      ],
      edges: [
        makeEdge("e1", "n1", "n2"),
        makeEdge("e2", "n1", "n3"),
      ],
    };

    const ready = getReadyAutoRunnableNodes(graph);
    // n1 done → n2, n3 both ready (parallel)
    expect(ready.map((n) => n.id).sort()).toEqual(["n2", "n3"]);
  });

  it("blocks auto node when manual predecessor is pending", () => {
    const graph = {
      id: "test-3",
      taskId: "t1",
      status: "draft" as const,
      revision: 1,
      source: "ai" as const,
      generatedBy: "test",
      prompt: null,
      summary: "test",
      changeSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        makeNode("n1", { autoRunnable: true, executionMode: "automatic", status: "done" }),
        makeNode("n2", { autoRunnable: false, executionMode: "manual", requiresHumanApproval: true }),
        makeNode("n3", { autoRunnable: true, executionMode: "automatic" }),
      ],
      edges: [
        makeEdge("e1", "n1", "n2"),
        makeEdge("e2", "n2", "n3"),
      ],
    };

    const ready = getReadyAutoRunnableNodes(graph);
    // n2 is pending manual → n3 is blocked
    expect(ready).toEqual([]);
  });

  it("auto nodes with no edges are immediately ready", () => {
    const graph = {
      id: "test-4",
      taskId: "t1",
      status: "draft" as const,
      revision: 1,
      source: "ai" as const,
      generatedBy: "test",
      prompt: null,
      summary: "test",
      changeSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        makeNode("n1", { autoRunnable: true, executionMode: "automatic" }),
        makeNode("n2", { autoRunnable: true, executionMode: "automatic" }),
      ],
      edges: [],
    };

    const ready = getReadyAutoRunnableNodes(graph);
    expect(ready.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
  });

  it("does not return already completed nodes", () => {
    const graph = {
      id: "test-5",
      taskId: "t1",
      status: "draft" as const,
      revision: 1,
      source: "ai" as const,
      generatedBy: "test",
      prompt: null,
      summary: "test",
      changeSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        makeNode("n1", { autoRunnable: true, executionMode: "automatic", status: "done" }),
      ],
      edges: [],
    };

    const ready = getReadyAutoRunnableNodes(graph);
    expect(ready).toEqual([]);
  });

  it("returns no subtask or decomposition types anywhere", () => {
    // Verify the graph structure has zero legacy fields
    const node = makeNode("n1", { autoRunnable: true, executionMode: "automatic" });
    const keys = Object.keys(node);
    expect(keys).not.toContain("subtask");
    expect(keys).not.toContain("subtasks");
    expect(keys).not.toContain("decomposition");
    expect(keys).not.toContain("dependsOnPrevious");
    expect(keys).not.toContain("feasibilityScore");
    expect(keys).not.toContain("totalEstimatedMinutes");
    expect(keys).not.toContain("warnings");
  });
});

// -- Factories --

function makeNode(
  id: string,
  overrides: Partial<TaskPlanNode> = {},
): TaskPlanNode {
  return {
    id,
    type: "step",
    title: `Node ${id}`,
    objective: `Objective for ${id}`,
    description: null,
    status: "pending",
    phase: null,
    estimatedMinutes: 10,
    priority: "Medium",
    executionMode: "automatic",
    requiresHumanInput: false,
    requiresHumanApproval: false,
    autoRunnable: true,
    blockingReason: null,
    linkedTaskId: null,
    completionSummary: null,
    metadata: null,
    ...overrides,
  };
}

function makeEdge(
  id: string,
  from: string,
  to: string,
): TaskPlanEdge {
  return { id, fromNodeId: from, toNodeId: to, type: "depends_on", metadata: null };
}
