import type { CompiledNode, CompiledPlan, PlanGraph } from "@chrona/graph-runtime";
import type { NodeAttempt, NodeResult, PlanOutputState } from "@chrona/contracts/ai";
import { validateChronaSpec } from "@chrona/ui-protocol";

export const README_FIXTURE_GENERATED_BY = "graph-layout-fixtures";
const README_FIXTURE_RUNTIME = "hermes";

export type ReadmeFixtureNode = {
  id: string;
  title: string;
  type?: NonNullable<CompiledNode["type"]>;
  executor?: NonNullable<CompiledNode["executor"]>;
  mode?: NonNullable<CompiledNode["mode"]>;
  priority?: NonNullable<CompiledNode["priority"]>;
  estimatedMinutes?: number;
  config?: CompiledNode["config"];
};

export type ReadmeFixtureEdge = {
  from: string;
  to: string;
  label?: string;
  active?: boolean;
};

export type ReadmeFixture = {
  slug: string;
  graphType: string;
  description: string;
  nodes: ReadmeFixtureNode[];
  edges: ReadmeFixtureEdge[];
  entryNodeIds?: string[];
  taskTitle?: string;
  planTitle?: string;
  demoState?: "ready" | "running" | "waiting" | "completed";
  resultKind?: "trending-research";
};

type SeedPlan = Pick<CompiledPlan, "id" | "editablePlanId" | "sourceVersion" | "nodes">;
type DemoState = NonNullable<ReadmeFixture["demoState"]>;
type SeedNodeStatus = "pending" | "running" | "waiting_for_user" | "completed" | "skipped";

export function fixtureTaskTitle(fixture: ReadmeFixture) {
  return fixture.taskTitle ?? `[Graph: ${fixture.graphType}] ${fixture.description}`;
}

export function fixtureTaskStatus(fixture: ReadmeFixture) {
  if (fixture.demoState === "waiting") return "WaitingForInput" as const;
  if (fixture.demoState === "completed") return "Completed" as const;
  return "Ready" as const;
}

function inactiveNodeIds(fixture: ReadmeFixture) {
  return new Set(
    fixture.nodes
      .filter((node) => {
        const incoming = fixture.edges.filter((edge) => edge.to === node.id);
        return incoming.length > 0 && incoming.every((edge) => edge.active === false);
      })
      .map((node) => `${fixture.slug}-${node.id}`),
  );
}

function currentNodeIndex(fixture: ReadmeFixture, state: DemoState) {
  const localId = state === "waiting" ? "review" : "analyze";
  const index = fixture.nodes.findIndex((node) => node.id === localId);
  return Math.max(index, 0);
}

function planRunNodeStatus(input: {
  state: DemoState;
  nodeId: string;
  index: number;
  currentIndex: number;
  inactiveIds: Set<string>;
}): SeedNodeStatus {
  if (input.inactiveIds.has(input.nodeId)) return "skipped";
  if (input.state === "completed") return "completed";
  if (input.state === "ready" || input.index > input.currentIndex) return "pending";
  if (input.index < input.currentIndex) return "completed";
  if (input.state === "waiting") return "waiting_for_user";
  return "running";
}

function planRunStatus(state: DemoState) {
  if (state === "completed") return "completed" as const;
  if (state === "waiting") return "paused" as const;
  if (state === "running") return "running" as const;
  return "pending" as const;
}

export function createFixturePlanRun(compiledPlan: SeedPlan, fixture: ReadmeFixture) {
  const createdAt = new Date().toISOString();
  const state = fixture.demoState ?? "ready";
  const inactiveIds = inactiveNodeIds(fixture);
  const currentIndex = currentNodeIndex(fixture, state);
  const nodeStates = Object.fromEntries(compiledPlan.nodes.map((node, index) => {
    const status = planRunNodeStatus({ state, nodeId: node.id, index, currentIndex, inactiveIds });
    const attempted = status !== "pending" && status !== "skipped";
    return [node.id, {
      nodeId: node.id,
      status,
      attempts: attempted ? 1 : 0,
      startedAt: attempted ? createdAt : undefined,
      completedAt: status === "completed" ? createdAt : undefined,
    }];
  }));

  return {
    id: `plan-run-${compiledPlan.editablePlanId}`,
    compiledPlanId: compiledPlan.id,
    editablePlanId: compiledPlan.editablePlanId,
    sourceVersion: compiledPlan.sourceVersion,
    status: planRunStatus(state),
    nodeStates,
    checkpointResponses: [],
    artifactRefs: [],
    attempts: [],
    createdAt,
    startedAt: state === "ready" ? undefined : createdAt,
    completedAt: state === "completed" ? createdAt : undefined,
  };
}

function evidenceDisposition(state: DemoState, index: number, currentIndex: number) {
  return {
    complete: state === "completed" || index < currentIndex,
    run: state === "running" && index === currentIndex,
    wait: state === "waiting" && index === currentIndex,
  };
}

function definitionLayerId(graph: PlanGraph, nodeId: string) {
  return graph.nodes
    .find((node) => node.id === nodeId)
    ?.layers.find((layer) => layer.type === "definition")
    ?.id;
}

function resultForNode(input: {
  graph: PlanGraph;
  fixtureNode: ReadmeFixtureNode;
  nodeId: string;
  nodeLayerId: string;
  attemptId: string;
  waiting: boolean;
}): NodeResult {
  return {
    id: `fixture-result-${input.nodeId}`,
    taskId: input.graph.taskId,
    graphId: input.graph.id,
    nodeId: input.nodeId,
    nodeLayerId: input.nodeLayerId,
    attemptId: input.attemptId,
    status: "current",
    outputSummary: input.waiting
      ? "Waiting for review notes before the brief is published."
      : `${input.fixtureNode.title} completed with reviewable evidence.`,
    waitKind: input.waiting ? "user_input" : undefined,
  };
}

function fixtureNodeEvidence(input: {
  fixture: ReadmeFixture;
  fixtureNode: ReadmeFixtureNode;
  graph: PlanGraph;
  state: DemoState;
  index: number;
  currentIndex: number;
  inactiveIds: Set<string>;
  now: string;
}) {
  const nodeId = `${input.fixture.slug}-${input.fixtureNode.id}`;
  if (input.inactiveIds.has(nodeId)) return null;
  const disposition = evidenceDisposition(input.state, input.index, input.currentIndex);
  if (!disposition.complete && !disposition.run && !disposition.wait) return null;
  const nodeLayerId = definitionLayerId(input.graph, nodeId);
  if (!nodeLayerId) return null;
  const attemptId = `fixture-attempt-${nodeId}`;
  const attempt: NodeAttempt = {
    id: attemptId,
    taskId: input.graph.taskId,
    graphId: input.graph.id,
    nodeId,
    nodeLayerId,
    executionContextSnapshotId: `fixture-context-${nodeId}`,
    status: disposition.run ? "running" : "succeeded",
    idempotencyKey: `fixture-${nodeId}-1`,
    attemptNumber: 1,
    startedAt: input.now,
    finishedAt: disposition.complete || disposition.wait ? input.now : undefined,
  };
  const result = disposition.complete || disposition.wait
    ? resultForNode({
        graph: input.graph,
        fixtureNode: input.fixtureNode,
        nodeId,
        nodeLayerId,
        attemptId,
        waiting: disposition.wait,
      })
    : null;
  return { attempt, result };
}

export function createFixtureRuntimeEvidence(fixture: ReadmeFixture, graph: PlanGraph): {
  attempts: NodeAttempt[];
  results: NodeResult[];
} {
  const state = fixture.demoState ?? "ready";
  if (state === "ready") return { attempts: [], results: [] };
  const inactiveIds = inactiveNodeIds(fixture);
  const currentIndex = currentNodeIndex(fixture, state);
  const now = new Date().toISOString();
  const attempts: NodeAttempt[] = [];
  const results: NodeResult[] = [];

  for (const [index, fixtureNode] of fixture.nodes.entries()) {
    const evidence = fixtureNodeEvidence({ fixture, fixtureNode, graph, state, index, currentIndex, inactiveIds, now });
    if (!evidence) continue;
    attempts.push(evidence.attempt);
    if (evidence.result) results.push(evidence.result);
  }
  return { attempts, results };
}

function assertValidFixtureSpec(spec: unknown) {
  const validation = validateChronaSpec(spec);
  if (!validation.ok) throw new Error(`Invalid fixture result spec: ${JSON.stringify(validation)}`);
}

function genericResultSpec(fixture: ReadmeFixture) {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: { gap: "md" }, children: ["summary", "details"] },
      summary: {
        type: "ResultSummary",
        props: { text: `${fixture.graphType} fixture ready for documentation capture.` },
        children: [],
      },
      details: {
        type: "RichMarkdown",
        props: {
          content: `### ${fixture.graphType} result\n\n- Fixture seeded for README and graph layout screenshots.\n- Workflow uses English release-readiness labels.`,
        },
        children: [],
      },
    },
  };
}

function trendingResultSpec() {
  return {
    root: "root",
    elements: {
      root: {
        type: "Stack",
        props: { gap: "md" },
        children: ["summary", "overviewCard", "themesCard", "rankingCard", "actionsCard"],
      },
      summary: {
        type: "ResultSummary",
        props: {
          text: "Documentation fixture complete: AI agents, MCP tooling, and local-first apps are the sample’s leading themes.",
          copyText: "Fixture themes: AI coding workflows, MCP integrations, browser automation, security testing, and local-first tools.",
        },
        children: [],
      },
      overviewCard: {
        type: "Card",
        props: { title: "Research snapshot", description: "Deterministic documentation fixture", maxWidth: "full" },
        children: ["overviewMarkdown"],
      },
      overviewMarkdown: {
        type: "RichMarkdown",
        props: {
          content: "- Reviewed a **21-project fixture dataset**.\n- Strongest recent-activity signal: **agent workflow tooling**.\n- Strongest durable-adoption signal: **local-first and self-hosted infrastructure**.",
        },
        children: [],
      },
      rankingCard: {
        type: "Card",
        props: { title: "Representative categories", description: "Illustrative fixture output", maxWidth: "full" },
        children: ["rankingMarkdown"],
      },
      rankingMarkdown: {
        type: "RichMarkdown",
        props: {
          content: "| Sample area | Signal | Why it matters |\n| --- | --- | --- |\n| Agent workflows | High recent activity | Teams are connecting models to repeatable work. |\n| MCP integrations | Broad integration coverage | Tool access is moving into more engineering workflows. |\n| Local-first apps | Durable adoption signal | Users continue to value control over data and runtime. |",
        },
        children: [],
      },
      themesCard: {
        type: "Card",
        props: { title: "Themes", maxWidth: "full" },
        children: ["themesMarkdown"],
      },
      themesMarkdown: {
        type: "RichMarkdown",
        props: {
          content: "- The fixture groups AI coding workflows around reusable tools and handoffs.\n- MCP integrations appear across several engineering categories.\n- Local-first and self-hosted tools form a distinct product theme.",
        },
        children: [],
      },
      actionsCard: {
        type: "Card",
        props: { title: "Recommended follow-up", maxWidth: "full" },
        children: ["actionsMarkdown"],
      },
      actionsMarkdown: {
        type: "RichMarkdown",
        props: {
          content: "- Track agent-plugin repositories for integration opportunities.\n- Watch self-hosted productivity tools for durable demand.\n- Re-run the brief weekly and compare theme drift against prior outputs.",
        },
        children: [],
      },
    },
  };
}

function resultManifest(fixture: ReadmeFixture) {
  const trending = fixture.resultKind === "trending-research";
  return {
    schemaVersion: 1 as const,
    sourceRevision: 1,
    outcome: {
      title: trending ? "GitHub Trending engineering brief" : `${fixture.graphType} fixture`,
      summary: trending ? "Brief complete." : "Fixture result ready.",
    },
    readiness: { status: "ready" as const, summary: "Ready" },
    sections: [],
    deliverables: [],
    findings: [],
    decisions: [],
    caveats: [],
    nextActions: [],
    evidence: [],
  };
}

export function createFixturePlanOutput(fixture: ReadmeFixture): PlanOutputState {
  const createdAt = new Date().toISOString();
  const resultNodeId = `${fixture.slug}-${fixture.nodes.at(-1)?.id ?? "result"}`;
  const manifest = resultManifest(fixture);
  const spec = fixture.resultKind === "trending-research" ? trendingResultSpec() : genericResultSpec(fixture);
  assertValidFixtureSpec(spec);
  return {
    manifest,
    finalizedResult: { sourceRevision: 1, manifest, spec, finalizedAt: createdAt },
    finalization: { status: "Ready", sourceRevision: 1, attempt: 1, finalizedAt: createdAt },
    revision: 1,
    updatedAt: createdAt,
    updatedByNodeId: resultNodeId,
  };
}

type TimelineInput = { workspaceId: string; taskId: string; planId: string };

function timelineBase(fixture: ReadmeFixture, input: TimelineInput, at: (secondsAgo: number) => Date) {
  return [
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "plan_generation.completed",
      title: "Plan generation completed",
      body: "Built a research workflow with collection, normalization, analysis, review, and publishing steps.",
      severity: "success",
      status: "completed",
      nodeId: null,
      sortTime: at(240),
      metadata: { planId: input.planId, source: README_FIXTURE_GENERATED_BY },
    },
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "plan_execution.execution_started",
      title: "Execution started",
      body: "Chrona started the accepted research workflow.",
      severity: "info",
      status: "execution_started",
      nodeId: null,
      sortTime: at(180),
      metadata: { planId: input.planId, runtime: README_FIXTURE_RUNTIME },
    },
  ];
}

function waitingTimeline(fixture: ReadmeFixture, input: TimelineInput, at: (secondsAgo: number) => Date) {
  return [
    ...timelineBase(fixture, input, at),
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "plan_execution.node_completed",
      title: "Repository metadata normalized",
      body: "Trending repository metadata is ready for theme analysis.",
      severity: "success",
      status: "completed",
      nodeId: `${fixture.slug}-normalize`,
      sortTime: at(120),
      metadata: { planId: input.planId, source: README_FIXTURE_GENERATED_BY },
    },
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "plan_execution.node_completed",
      title: "Technology themes analyzed",
      body: "AI agent tooling, MCP integrations, and local-first apps were identified as the strongest signals.",
      severity: "success",
      status: "completed",
      nodeId: `${fixture.slug}-analyze`,
      sortTime: at(75),
      metadata: { planId: input.planId, source: README_FIXTURE_GENERATED_BY },
    },
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "checkpoint.waiting_for_input",
      title: "Review notes requested",
      body: "Chrona is waiting for review notes before publishing the brief.",
      severity: "warning",
      status: "waiting_for_input",
      nodeId: `${fixture.slug}-review`,
      sortTime: at(15),
      metadata: { planId: input.planId, source: README_FIXTURE_GENERATED_BY },
    },
  ];
}

function completedTimeline(fixture: ReadmeFixture, input: TimelineInput, at: (secondsAgo: number) => Date) {
  const nodeId = `${fixture.slug}-publish`;
  return [
    ...timelineBase(fixture, input, at),
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "tool.accepted",
      title: "chrona.node.complete",
      body: "AI submitted semantic result contributions through Chrona-owned result state.",
      severity: "success",
      status: "accepted",
      nodeId,
      sortTime: at(90),
      metadata: { resultStatus: "accepted" },
    },
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "plan_execution.node_result_submitted",
      title: "Publish research brief: node_result_submitted",
      body: "Result summary, representative projects, themes, and follow-up actions were saved.",
      severity: "success",
      status: "node_result_submitted",
      nodeId,
      sortTime: at(45),
      metadata: { planId: input.planId, source: README_FIXTURE_GENERATED_BY },
    },
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "plan_execution.execution_completed",
      title: "Execution completed",
      body: "Research brief ready for review and README capture.",
      severity: "success",
      status: "execution_completed",
      nodeId: null,
      sortTime: at(15),
      metadata: { planId: input.planId, source: README_FIXTURE_GENERATED_BY },
    },
  ];
}

export function createFixtureTimelineItems(fixture: ReadmeFixture, input: TimelineInput) {
  if (fixture.resultKind !== "trending-research") return [];
  const baseTime = Date.now();
  const at = (secondsAgo: number) => new Date(baseTime - secondsAgo * 1000);
  return fixture.demoState === "waiting"
    ? waitingTimeline(fixture, input, at)
    : completedTimeline(fixture, input, at);
}
