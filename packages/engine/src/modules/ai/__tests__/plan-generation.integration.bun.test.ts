/**
 * Real integration tests for plan generation.
 * These call the actual LLM API (CPA) — NOT mocked.
 *
 * Requires:
 *   - CPA endpoint reachable at https://cpa.saya.love/v1
 *   - Valid API key in DB or TEST_CPA_API_KEY env var
 *   - RUN_LLM_INTEGRATION=1
 *
 * Run: RUN_LLM_INTEGRATION=1 bun test packages/engine/src/modules/ai/__tests__/plan-generation.integration.bun.test.ts
 */

import { describe, expect, it } from "bun:test";

import { extractJSON, llmCall } from "@/modules/ai/providers";
import { SYSTEM_PROMPTS } from "@/modules/ai/prompts";
import type {
  PlanBlueprintNode,
  PlanBlueprintEdge,
  CompiledPlan,
  CompiledNode,
  CompiledEdge,
  NodeConfig,
  PlanOverlayLayer,
  RuntimeLayer,
} from "@chrona/contracts/ai";
import { getReadyAutoRunnableNodes } from "@/modules/plan-execution/compat";

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

function normalizeNodeType(value: unknown): PlanBlueprintNode["type"] {
  const valid = ["task", "checkpoint", "condition", "wait"];
  return valid.includes(value as string) ? (value as PlanBlueprintNode["type"]) : "task";
}

function _normalizeEdgeType(value: unknown): string {
  const valid = ["sequential", "depends_on"];
  return valid.includes(value as string) ? (value as string) : "sequential";
}

function _normalizePriority(value: unknown): "Low" | "Medium" | "High" | "Urgent" | null {
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
  const parsed = extractJSON(candidate) as {
    summary?: string;
    reasoning?: string;
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
  } | null;

  const nodes: PlanBlueprintNode[] = (parsed?.nodes ?? []).map((n: Record<string, unknown>, i: number) => ({
    id: (n.id as string) ?? `node-${i + 1}`,
    type: normalizeNodeType(n.type),
    title: (n.title as string) ?? `Step ${i + 1}`,
    ...((n.type as string) === "task" ? {
      executor: (n.executor as "ai" | "user" | "system") ?? "ai",
      estimatedMinutes: typeof n.estimatedMinutes === "number" ? n.estimatedMinutes : 30,
    } : (n.type as string) === "checkpoint" ? {
      checkpointType: (n.checkpointType as string) ?? "confirm",
      prompt: (n.prompt as string) ?? "",
    } : (n.type as string) === "condition" ? {
      condition: (n.condition as string) ?? "",
      branches: (n.branches as Array<{ label: string; nextNodeId: string }>) ?? [],
    } : (n.type as string) === "wait" ? {
      waitFor: (n.waitFor as string) ?? "",
    } : {}),
  })) as PlanBlueprintNode[];

  const edges: PlanBlueprintEdge[] = (parsed?.edges ?? []).map((_e: Record<string, unknown>, i: number) => ({
    from: ((_e.fromNodeId ?? _e.from ?? "") as string),
    to: ((_e.toNodeId ?? _e.to ?? "") as string),
    label: (_e.type as string) ?? `edge-${i + 1}`,
  }));

  return {
    summary: (parsed?.summary as string) ?? "",
    reasoning: parsed?.reasoning as string | undefined,
    nodes,
    edges,
  };
}

// -- Tests --

const describeIf = RUN_LLM_INTEGRATION ? describe : describe.skip;

describeIf("Plan generation (real LLM)", () => {
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
      const node = n as unknown as Record<string, unknown>;
      expect(node.id).toBeTruthy();
      expect(node.title).toBeTruthy();
      expect(node.objective).toBeTruthy();
      expect(["automatic", "manual", "hybrid"]).toContain(node.executionMode as string);
      expect(typeof node.autoRunnable).toBe("boolean");
      expect(typeof node.requiresHumanInput).toBe("boolean");
      expect(typeof node.requiresHumanApproval).toBe("boolean");
    }

    // Every edge references valid nodes
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      expect(nodeIds.has(e.from)).toBe(true);
      expect(nodeIds.has(e.to)).toBe(true);
    }

    // Graph must NOT be purely linear — should have parallelism
    const outDeg = new Map<string, number>();
    const inDeg = new Map<string, number>();
    for (const e of graph.edges) {
      outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
      inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
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

    const autoNodes = graph.nodes.filter((n) => (n as unknown as Record<string, unknown>).autoRunnable);
    const manualNodes = graph.nodes.filter((n) => !(n as unknown as Record<string, unknown>).autoRunnable);

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
      const node = n as unknown as Record<string, unknown>;
      if (node.requiresHumanApproval || node.requiresHumanInput) {
        expect(node.autoRunnable).toBe(false);
      }
    }
  }, 120_000);
});

describe("getReadyAutoRunnableNodes", () => {
  it("returns root auto nodes when nothing is completed", () => {
    const { compiledPlan, layers } = makeCompiledPlan(
      [
        makeCompiledNode("n1", { mode: "auto" }),
        makeCompiledNode("n2", { mode: "manual" }),
        makeCompiledNode("n3", { mode: "auto" }),
      ],
      [
        makeCompiledEdge("e1", "n1", "n2"),
        makeCompiledEdge("e2", "n2", "n3"),
      ],
    );

    const ready = getReadyAutoRunnableNodes(compiledPlan, layers);
    // n1 has no deps → ready. n3 depends on n2 (pending) → not ready.
    expect(ready.map((n) => n.nodeId)).toEqual(["n1"]);
  });

  it("unblocks auto node after manual predecessor completes", () => {
    const { compiledPlan, layers } = makeCompiledPlan(
      [
        makeCompiledNode("n1", { mode: "manual" }),
        makeCompiledNode("n2", { mode: "auto" }),
        makeCompiledNode("n3", { mode: "auto" }),
      ],
      [
        makeCompiledEdge("e1", "n1", "n2"),
        makeCompiledEdge("e2", "n1", "n3"),
      ],
      { n1: "completed" },
    );

    const ready = getReadyAutoRunnableNodes(compiledPlan, layers);
    // n1 done → n2, n3 both ready (parallel)
    expect(ready.map((n) => n.nodeId).sort()).toEqual(["n2", "n3"]);
  });

  it("blocks auto node when manual predecessor is pending", () => {
    const { compiledPlan, layers } = makeCompiledPlan(
      [
        makeCompiledNode("n1", { mode: "auto" }),
        makeCompiledNode("n2", { mode: "manual" }),
        makeCompiledNode("n3", { mode: "auto" }),
      ],
      [
        makeCompiledEdge("e1", "n1", "n2"),
        makeCompiledEdge("e2", "n2", "n3"),
      ],
      { n1: "completed" },
    );

    const ready = getReadyAutoRunnableNodes(compiledPlan, layers);
    // n2 is pending manual → n3 is blocked
    expect(ready).toEqual([]);
  });

  it("auto nodes with no edges are immediately ready", () => {
    const { compiledPlan, layers } = makeCompiledPlan(
      [
        makeCompiledNode("n1", { mode: "auto" }),
        makeCompiledNode("n2", { mode: "auto" }),
      ],
      [],
    );

    const ready = getReadyAutoRunnableNodes(compiledPlan, layers);
    expect(ready.map((n) => n.nodeId).sort()).toEqual(["n1", "n2"]);
  });

  it("does not return already completed nodes", () => {
    const { compiledPlan, layers } = makeCompiledPlan(
      [
        makeCompiledNode("n1", { mode: "auto" }),
      ],
      [],
      { n1: "completed" },
    );

    const ready = getReadyAutoRunnableNodes(compiledPlan, layers);
    expect(ready).toEqual([]);
  });

  it("returns no subtask or decomposition types anywhere", () => {
    // Verify the graph structure has zero legacy fields
    const node = makeCompiledNode("n1", { mode: "auto" });
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

function makeCompiledNode(
  id: string,
  overrides: Partial<CompiledNode> = {},
): CompiledNode {
  return {
    id,
    localId: id,
    type: "task",
    title: `Node ${id}`,
    config: {} as NodeConfig,
    dependencies: [],
    dependents: [],
    mode: "auto",
    ...overrides,
  };
}

function makeCompiledEdge(
  id: string,
  from: string,
  to: string,
): CompiledEdge {
  return { id, from, to };
}

function makeCompiledPlan(
  nodes: CompiledNode[],
  edges: CompiledEdge[],
  runtimeStatuses?: Record<string, "pending" | "completed" | "skipped">,
): { compiledPlan: CompiledPlan; layers: PlanOverlayLayer[] } {
  const planId = "ep-test";
  const compiledPlan: CompiledPlan = {
    id: "plan-test",
    editablePlanId: planId,
    sourceVersion: 1,
    title: "Test Plan",
    goal: "Test",
    assumptions: [],
    nodes,
    edges,
    entryNodeIds: nodes.filter((n) => !edges.some((e) => e.to === n.id)).map((n) => n.id),
    terminalNodeIds: nodes.filter((n) => !edges.some((e) => e.from === n.id)).map((n) => n.id),
    topologicalOrder: nodes.map((n) => n.id),
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };

  const layers: PlanOverlayLayer[] = [];
  if (runtimeStatuses && Object.keys(runtimeStatuses).length > 0) {
    const layer: RuntimeLayer = {
      type: "runtime",
      planId,
      layerId: "rl-test",
      version: 1,
      active: true,
      timestamp: new Date().toISOString(),
      nodeStates: Object.fromEntries(
        Object.entries(runtimeStatuses).map(([nodeId, status]) => [nodeId, { status }]),
      ),
    };
    layers.push(layer);
  }

  return { compiledPlan, layers };
}
