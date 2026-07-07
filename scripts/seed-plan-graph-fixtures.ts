import { createPlanGraphFromCompiledPlan } from "@chrona/graph-runtime";
import type { CompiledEdge, CompiledNode, CompiledPlan, PlanGraph } from "@chrona/graph-runtime";
import type { PlanOutputState } from "@chrona/contracts/ai";
import { Prisma, PrismaClient, TaskPlanStatus, TaskPriority, TaskStatus, WorkspaceStatus } from "../packages/db/src/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";

type FixtureNode = {
  id: string;
  title: string;
  type?: CompiledNode["type"];
  executor?: CompiledNode["executor"];
  mode?: CompiledNode["mode"];
  priority?: CompiledNode["priority"];
  estimatedMinutes?: number;
  config?: CompiledNode["config"];
};

type FixtureEdge = {
  from: string;
  to: string;
  label?: string;
  active?: boolean;
};

type Fixture = {
  slug: string;
  graphType: string;
  description: string;
  nodes: FixtureNode[];
  edges: FixtureEdge[];
  entryNodeIds?: string[];
};

type FixtureCompiledPlan = CompiledPlan & {
  title: string;
  goal: string;
  assumptions: string[];
  terminalNodeIds: string[];
  topologicalOrder: string[];
  completionPolicy: { type: "all_tasks_completed" };
  validationWarnings: string[];
};

const DEFAULT_WORKSPACE_ID = "ws_default";
const DEFAULT_RUNTIME = "hermes";
const GENERATED_BY = "graph-layout-fixtures";
const DATABASE_URL = process.env.DATABASE_URL || "file:./prisma/dev.db";

const adapter = new PrismaBunSqlite({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const task = (id: string, title: string, config: FixtureNode["config"] = {}) => ({
  id,
  title,
  type: "task" as const,
  executor: "ai" as const,
  mode: "auto" as const,
  estimatedMinutes: 10,
  priority: "Medium" as const,
  config,
});

const checkpoint = (id: string, title: string, checkpointType: "approve" | "input" = "approve") => ({
  id,
  title,
  type: "checkpoint" as const,
  executor: "user" as const,
  mode: "manual" as const,
  estimatedMinutes: 5,
  priority: "High" as const,
  config: {
    checkpointType,
    prompt: title,
    required: true,
    inputFields: checkpointType === "input"
      ? [{ name: "answer", label: "Input", type: "textarea", required: true }]
      : undefined,
  },
});

const condition = (id: string, title: string, branches: Array<{ label: string; nextNodeId: string }>) => ({
  id,
  title,
  type: "condition" as const,
  executor: "system" as const,
  mode: "auto" as const,
  estimatedMinutes: 2,
  priority: "Medium" as const,
  config: {
    condition: title,
    evaluationBy: "ai" as const,
    branches,
    defaultNextNodeId: branches[0]?.nextNodeId,
  },
});

const wait = (id: string, title: string) => ({
  id,
  title,
  type: "wait" as const,
  executor: "system" as const,
  mode: "auto" as const,
  estimatedMinutes: 15,
  priority: "Medium" as const,
  config: {
    waitFor: title,
    timeout: { minutes: 30, onTimeout: "continue" },
  },
});

const fixtures: Fixture[] = [
  {
    slug: "linear-4",
    graphType: "Linear 4-step",
    description: "Short release-readiness workflow for checking compact graph spacing.",
    nodes: [
      task("scope", "Confirm release goal"),
      task("design", "Draft rollout plan"),
      task("build", "Prepare release changes"),
      checkpoint("review", "Approve release package"),
    ],
    edges: [
      { from: "scope", to: "design" },
      { from: "design", to: "build" },
      { from: "build", to: "review" },
    ],
  },
  {
    slug: "long-linear-9",
    graphType: "Long Linear 9-step",
    description: "Long release checklist for checking snake layout and row wrapping.",
    nodes: Array.from({ length: 9 }, (_, index) => task(`step-${index + 1}`, `Release checklist step ${index + 1}`)),
    edges: Array.from({ length: 8 }, (_, index) => ({ from: `step-${index + 1}`, to: `step-${index + 2}` })),
  },
  {
    slug: "condition-merge",
    graphType: "Condition Branch + Merge",
    description: "Branch and merge workflow for deciding whether a release note needs code changes.",
    nodes: [
      task("start", "Collect release context"),
      condition("choice", "Does this require a code change?", [
        { label: "true", nextNodeId: "patch" },
        { label: "false", nextNodeId: "explain" },
      ]),
      task("patch", "Prepare patch"),
      task("explain", "Document no-code decision"),
      checkpoint("merge", "Confirm next step"),
      task("finish", "Finalize release note"),
    ],
    edges: [
      { from: "start", to: "choice" },
      { from: "choice", to: "patch", label: "true" },
      { from: "choice", to: "explain", label: "false" },
      { from: "patch", to: "merge", label: "resume" },
      { from: "explain", to: "merge", label: "resume" },
      { from: "merge", to: "finish" },
    ],
  },
  {
    slug: "inactive-branch-tail",
    graphType: "Trending Research Brief",
    description: "Research GitHub Trending and prepare an engineering brief with evidence, themes, and next actions.",
    nodes: [
      checkpoint("scope", "Confirm research scope"),
      task("collect", "Fetch GitHub Trending repositories"),
      task("normalize", "Normalize repository metadata"),
      task("analyze", "Analyze technology themes"),
      condition("choice", "Is the dataset complete?", [
        { label: "true", nextNodeId: "draft" },
        { label: "false", nextNodeId: "backfill" },
      ]),
      task("backfill", "Backfill missing repository details"),
      task("draft", "Draft executive brief"),
      checkpoint("review", "Review evidence and recommendations", "input"),
      task("publish", "Publish research brief"),
    ],
    edges: [
      { from: "scope", to: "collect" },
      { from: "collect", to: "normalize" },
      { from: "normalize", to: "analyze" },
      { from: "analyze", to: "choice" },
      { from: "choice", to: "backfill", label: "false", active: false },
      { from: "choice", to: "draft", label: "true" },
      { from: "draft", to: "review" },
      { from: "review", to: "publish" },
    ],
  },
  {
    slug: "parallel-diamond",
    graphType: "Parallel Diamond Fan-out/Fan-in",
    description: "Parallel release work that fans out into API, UI, and docs tracks before review.",
    nodes: [
      task("start", "Prepare release input"),
      task("api", "Verify API surface"),
      task("ui", "Refresh UI screenshots"),
      task("docs", "Update release docs"),
      checkpoint("join", "Review parallel outputs"),
      task("ship", "Ship release package"),
    ],
    edges: [
      { from: "start", to: "api" },
      { from: "start", to: "ui" },
      { from: "start", to: "docs" },
      { from: "api", to: "join", label: "resume" },
      { from: "ui", to: "join", label: "resume" },
      { from: "docs", to: "join", label: "resume" },
      { from: "join", to: "ship" },
    ],
  },
  {
    slug: "wide-fanout",
    graphType: "Wide Fan-out 5 branches",
    description: "Wide release validation fan-out for checking horizontal space, crossings, and bounds.",
    nodes: [
      task("start", "Analyze release input"),
      task("branch-a", "Check Linux build"),
      task("branch-b", "Check macOS build"),
      task("branch-c", "Check Windows build"),
      task("branch-d", "Check docs"),
      task("branch-e", "Check provider setup"),
      checkpoint("join", "Summarize validation"),
    ],
    edges: [
      { from: "start", to: "branch-a" },
      { from: "start", to: "branch-b" },
      { from: "start", to: "branch-c" },
      { from: "start", to: "branch-d" },
      { from: "start", to: "branch-e" },
      { from: "branch-a", to: "join", label: "resume" },
      { from: "branch-b", to: "join", label: "resume" },
      { from: "branch-c", to: "join", label: "resume" },
      { from: "branch-d", to: "join", label: "resume" },
      { from: "branch-e", to: "join", label: "resume" },
    ],
  },
  {
    slug: "nested-conditions",
    graphType: "Nested Conditions",
    description: "Nested release decisions for checking recursive branch layout.",
    nodes: [
      task("start", "Read release request"),
      condition("choice-a", "Is more information missing?", [
        { label: "true", nextNodeId: "ask" },
        { label: "false", nextNodeId: "choice-b" },
      ]),
      checkpoint("ask", "Collect missing information", "input"),
      condition("choice-b", "Does the release need implementation?", [
        { label: "true", nextNodeId: "implement" },
        { label: "false", nextNodeId: "document" },
      ]),
      task("implement", "Implement release fix"),
      task("document", "Update release notes only"),
      checkpoint("join", "Confirm branch result"),
      task("finish", "Send final release summary"),
    ],
    edges: [
      { from: "start", to: "choice-a" },
      { from: "choice-a", to: "ask", label: "true" },
      { from: "choice-a", to: "choice-b", label: "false" },
      { from: "ask", to: "choice-b", label: "resume" },
      { from: "choice-b", to: "implement", label: "true" },
      { from: "choice-b", to: "document", label: "false" },
      { from: "implement", to: "join", label: "resume" },
      { from: "document", to: "join", label: "resume" },
      { from: "join", to: "finish" },
    ],
  },
  {
    slug: "human-sidecars",
    graphType: "Human Approval/Input/Wait",
    description: "Main release path with approval, input, and wait nodes for sidecar layout checks.",
    nodes: [
      task("draft", "Draft release notes"),
      checkpoint("approve", "Approve release notes"),
      task("revise", "Revise from approval"),
      checkpoint("input", "Add publish parameters", "input"),
      wait("wait-window", "Wait for release window"),
      task("publish", "Publish release"),
    ],
    edges: [
      { from: "draft", to: "approve" },
      { from: "approve", to: "revise" },
      { from: "revise", to: "input" },
      { from: "input", to: "wait-window" },
      { from: "wait-window", to: "publish" },
    ],
  },
  {
    slug: "cross-dependency",
    graphType: "Cross Dependency DAG",
    description: "DAG release workflow with cross-track dependencies for edge crossing checks.",
    nodes: [
      task("start", "Prepare baseline data"),
      task("model", "Validate data model"),
      task("api", "Validate API routes"),
      task("ui", "Validate UI flow"),
      task("integration", "Run integration checks"),
      checkpoint("review", "Final release review"),
    ],
    edges: [
      { from: "start", to: "model" },
      { from: "start", to: "api" },
      { from: "model", to: "api", label: "dependency" },
      { from: "model", to: "ui" },
      { from: "api", to: "integration" },
      { from: "ui", to: "integration" },
      { from: "integration", to: "review" },
    ],
  },
  {
    slug: "mixed-realistic",
    graphType: "Mixed Realistic Workflow",
    description: "Realistic release workflow with a long main path, risk branch, input, wait, and merge.",
    nodes: [
      task("intake", "Understand release request"),
      task("inspect", "Inspect current product state"),
      condition("risk", "Does this require human confirmation?", [
        { label: "true", nextNodeId: "confirm" },
        { label: "false", nextNodeId: "implement" },
      ]),
      checkpoint("confirm", "Confirm release risk scope"),
      task("implement", "Apply release changes"),
      task("tests", "Run release checks"),
      condition("test-result", "Did tests pass?", [
        { label: "true", nextNodeId: "summarize" },
        { label: "false", nextNodeId: "fix" },
      ]),
      task("fix", "Fix failing checks"),
      wait("wait-ci", "Wait for external CI"),
      task("summarize", "Summarize release outcome"),
    ],
    edges: [
      { from: "intake", to: "inspect" },
      { from: "inspect", to: "risk" },
      { from: "risk", to: "confirm", label: "true" },
      { from: "risk", to: "implement", label: "false" },
      { from: "confirm", to: "implement", label: "resume" },
      { from: "implement", to: "tests" },
      { from: "tests", to: "test-result" },
      { from: "test-result", to: "summarize", label: "true" },
      { from: "test-result", to: "fix", label: "false" },
      { from: "fix", to: "tests", label: "retry", active: false },
      { from: "summarize", to: "wait-ci" },
      { from: "wait-ci", to: "summarize", label: "resume", active: false },
    ],
  },
];

function edgeId(edge: FixtureEdge) {
  return `edge-${edge.from}-${edge.to}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildCompiledPlan(fixture: Fixture): FixtureCompiledPlan {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const node of fixture.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of fixture.edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }

  const nodes = fixture.nodes.map((node): CompiledNode => ({
    id: `${fixture.slug}-${node.id}`,
    localId: node.id,
    type: node.type ?? "task",
    title: node.title,
    config: node.config ?? { expectedOutput: node.title },
    dependencies: (incoming.get(node.id) ?? []).map((id) => `${fixture.slug}-${id}`),
    dependents: (outgoing.get(node.id) ?? []).map((id) => `${fixture.slug}-${id}`),
    executor: node.executor ?? "ai",
    mode: node.mode ?? "auto",
    estimatedMinutes: node.estimatedMinutes ?? 10,
    priority: node.priority ?? "Medium",
  }));
  const edges = fixture.edges.map((edge): CompiledEdge => ({
    id: `${fixture.slug}-${edgeId(edge)}`,
    from: `${fixture.slug}-${edge.from}`,
    to: `${fixture.slug}-${edge.to}`,
    label: edge.label,
  }));
  const terminalNodeIds = fixture.nodes
    .filter((node) => (outgoing.get(node.id) ?? []).length === 0)
    .map((node) => `${fixture.slug}-${node.id}`);
  const entryNodeIds = (fixture.entryNodeIds ?? fixture.nodes.filter((node) => (incoming.get(node.id) ?? []).length === 0).map((node) => node.id))
    .map((id) => `${fixture.slug}-${id}`);

  return {
    id: `compiled-${fixture.slug}`,
    editablePlanId: `plan-graph-fixture-${fixture.slug}`,
    sourceVersion: 1,
    title: `[Graph: ${fixture.graphType}] ${fixture.description}`,
    goal: fixture.description,
    assumptions: ["Generated by scripts/seed-plan-graph-fixtures.ts for visual layout evaluation."],
    nodes,
    edges,
    entryNodeIds,
    terminalNodeIds,
    topologicalOrder: nodes.map((node) => node.id),
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function applyInactiveEdges(graph: PlanGraph, fixture: Fixture) {
  const inactiveEdgeIds = new Set(
    fixture.edges.filter((edge) => edge.active === false).map((edge) => `${fixture.slug}-${edgeId(edge)}`),
  );
  if (inactiveEdgeIds.size === 0) return graph;

  return {
    ...graph,
    edges: graph.edges.map((edge) => inactiveEdgeIds.has(edge.id) ? { ...edge, active: false } : edge),
  };
}

function createEmptyPlanRun(compiledPlan: FixtureCompiledPlan) {
  const createdAt = new Date().toISOString();
  return {
    id: `plan-run-${compiledPlan.editablePlanId}`,
    compiledPlanId: compiledPlan.id,
    editablePlanId: compiledPlan.editablePlanId,
    sourceVersion: compiledPlan.sourceVersion,
    status: "pending",
    nodeStates: Object.fromEntries(compiledPlan.nodes.map((node) => [node.id, { nodeId: node.id, status: "pending", attempts: 0 }])),
    checkpointResponses: [],
    artifactRefs: [],
    attempts: [],
    createdAt,
  };
}

function createFixturePlanOutput(fixture: Fixture): PlanOutputState {
  const createdAt = new Date().toISOString();
  const resultNodeId = `${fixture.slug}-${fixture.nodes.at(-1)?.id ?? "result"}`;

  if (fixture.slug !== "inactive-branch-tail") {
    return {
      spec: {
        root: "root",
        elements: {
          root: { type: "Stack", props: { gap: "md" }, children: ["summary", "details"] },
          summary: {
            type: "ResultSummary",
            props: { text: `${fixture.graphType} fixture ready for documentation capture.` },
            children: [],
          },
          details: {
            type: "Markdown",
            props: { content: `### ${fixture.graphType} result\n\n- Fixture seeded for README and graph layout screenshots.\n- Workflow uses English release-readiness labels.` },
            children: [],
          },
        },
      },
      revision: 1,
      updatedAt: createdAt,
      updatedByNodeId: resultNodeId,
      history: [{
        id: `fixture-output-${fixture.slug}`,
        nodeId: resultNodeId,
        summary: `${fixture.graphType} fixture result`,
        patches: [],
        createdAt,
      }],
    };
  }

  return {
    spec: {
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
            text: "GitHub Trending brief complete: AI agents, MCP tooling, and self-hosted apps dominate today’s developer attention.",
            copyText: "Top signals: AI coding workflows, MCP integrations, browser automation, security testing, and local-first self-hosted tools.",
          },
          children: [],
        },
        overviewCard: {
          type: "Card",
          props: { title: "Research snapshot", description: "Daily GitHub Trending sample", maxWidth: "full" },
          children: ["overviewMarkdown"],
        },
        overviewMarkdown: {
          type: "Markdown",
          props: {
            content: "- Reviewed **21 trending repositories** from the daily all-language feed.\n- Highest single-day growth: **AIDC-AI/codex-plugin-cc** with **1,532 stars today**.\n- Strongest total-star signal: **immich-app/immich** with **82k+ stars**.",
          },
          children: [],
        },
        rankingCard: {
          type: "Card",
          props: { title: "Representative projects", description: "Condensed from the dev database sample", maxWidth: "full" },
          children: ["rankingMarkdown"],
        },
        rankingMarkdown: {
          type: "Markdown",
          props: {
            content: "| Project | Signal | Why it matters |\n| --- | --- | --- |\n| Zackriya-Solutions/meeting-minutes | 1,409 stars today | Local AI meeting notes and workflow automation. |\n| AIDC-AI/codex-plugin-cc | 1,532 stars today | Codex/Claude skill bridge for agentic coding. |\n| immich-app/immich | 82k+ total stars | Self-hosted photo management keeps broad developer demand. |",
          },
          children: [],
        },
        themesCard: {
          type: "Card",
          props: { title: "Themes", maxWidth: "full" },
          children: ["themesMarkdown"],
        },
        themesMarkdown: {
          type: "Markdown",
          props: {
            content: "- AI coding workflows are moving from one-off prompts to plugin ecosystems and multi-agent handoffs.\n- MCP integrations are spreading into Unity, Kubernetes, browser automation, and other vertical engineering loops.\n- Local-first and self-hosted tools remain durable developer demand signals.",
          },
          children: [],
        },
        actionsCard: {
          type: "Card",
          props: { title: "Recommended follow-up", maxWidth: "full" },
          children: ["actionsMarkdown"],
        },
        actionsMarkdown: {
          type: "Markdown",
          props: {
            content: "- Track agent-plugin repositories for integration opportunities.\n- Watch self-hosted productivity tools for durable demand.\n- Re-run the brief weekly and compare theme drift against prior outputs.",
          },
          children: [],
        },
      },
    },
    revision: 1,
    updatedAt: createdAt,
    updatedByNodeId: resultNodeId,
    history: [{
      id: `fixture-output-${fixture.slug}`,
      nodeId: resultNodeId,
      summary: "GitHub Trending engineering brief",
      patches: [],
      createdAt,
    }],
  };
}

function createFixtureTimelineItems(fixture: Fixture, input: { workspaceId: string; taskId: string; planId: string }) {
  if (fixture.slug !== "inactive-branch-tail") return [];

  const baseTime = Date.now();
  const at = (secondsAgo: number) => new Date(baseTime - secondsAgo * 1000);
  const nodeId = `${fixture.slug}-publish`;

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
      metadata: { planId: input.planId, source: GENERATED_BY },
    },
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "plan_execution.execution_started",
      title: "Execution started",
      body: "Chrona started the accepted research plan with Hermes runtime.",
      severity: "info",
      status: "execution_started",
      nodeId: null,
      sortTime: at(180),
      metadata: { planId: input.planId, runtime: DEFAULT_RUNTIME },
    },
    {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: "tool.accepted",
      title: "chrona.plan.output",
      body: "AI submitted the visible Trending brief through Chrona-owned result state.",
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
      metadata: { planId: input.planId, source: GENERATED_BY },
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
      metadata: { planId: input.planId, source: GENERATED_BY },
    },
  ];
}


async function resolveDefaultWorkspaceId() {
  const activeWorkspace = await prisma.workspace.findFirst({
    where: { status: WorkspaceStatus.Active },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  if (activeWorkspace) {
    return activeWorkspace.id;
  }

  const workspace = await prisma.workspace.upsert({
    where: { id: DEFAULT_WORKSPACE_ID },
    update: {
      name: "Default Workspace",
      description: "Auto-created primary workspace for graph layout evaluation",
      defaultRuntime: DEFAULT_RUNTIME,
      status: WorkspaceStatus.Active,
    },
    create: {
      id: DEFAULT_WORKSPACE_ID,
      name: "Default Workspace",
      description: "Auto-created primary workspace for graph layout evaluation",
      defaultRuntime: DEFAULT_RUNTIME,
      status: WorkspaceStatus.Active,
    },
    select: { id: true },
  });

  return workspace.id;
}

async function seedFixture(fixture: Fixture, workspaceId: string) {
  const taskId = `graph-fixture-${fixture.slug}`;
  const compiledPlan = buildCompiledPlan(fixture);
  const graph = applyInactiveEdges(
    createPlanGraphFromCompiledPlan({ taskId, compiledPlan }),
    fixture,
  );
  const planRunRecord = {
    planRun: createEmptyPlanRun(compiledPlan),
    mutableGraph: {
      graph,
      attempts: [],
      results: [],
      executionContextSnapshots: [],
      planOutput: createFixturePlanOutput(fixture),
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.task.upsert({
      where: { id: taskId },
      update: {
        workspaceId,
        title: `[Graph: ${fixture.graphType}] ${fixture.description}`,
        description: fixture.description,
        status: TaskStatus.Ready,
        priority: TaskPriority.Low,
        executionRuntime: DEFAULT_RUNTIME,
        executionConfig: {},
      },
      create: {
        id: taskId,
        workspaceId,
        title: `[Graph: ${fixture.graphType}] ${fixture.description}`,
        description: fixture.description,
        status: TaskStatus.Ready,
        priority: TaskPriority.Low,
        executionRuntime: DEFAULT_RUNTIME,
        executionConfig: {},
      },
    });

    await tx.taskPlan.upsert({
      where: { planId: compiledPlan.editablePlanId },
      create: {
        id: `task-plan-record-${fixture.slug}`,
        workspaceId,
        taskId,
        planId: compiledPlan.editablePlanId,
        revision: compiledPlan.sourceVersion,
        status: TaskPlanStatus.Accepted,
        prompt: fixture.description,
        summary: fixture.description,
        generatedBy: GENERATED_BY,
        compiledPlan: compiledPlan as unknown as Prisma.InputJsonValue,
        editablePlan: Prisma.JsonNull,
      },
      update: {
        workspaceId,
        taskId,
        revision: compiledPlan.sourceVersion,
        status: TaskPlanStatus.Accepted,
        prompt: fixture.description,
        summary: fixture.description,
        generatedBy: GENERATED_BY,
        compiledPlan: compiledPlan as unknown as Prisma.InputJsonValue,
        editablePlan: Prisma.JsonNull,
      },
    });

    await tx.taskPlanRun.upsert({
      where: { id: `task-plan-run-${fixture.slug}` },
      create: {
        id: `task-plan-run-${fixture.slug}`,
        workspaceId,
        taskId,
        planId: compiledPlan.editablePlanId,
        planRun: planRunRecord as unknown as Prisma.InputJsonValue,
      },
      update: {
        workspaceId,
        taskId,
        planId: compiledPlan.editablePlanId,
        planRun: planRunRecord as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.graphVersion.upsert({
      where: { taskId_version: { taskId, version: 1 } },
      create: {
        id: `graph-version-${fixture.slug}-v1`,
        workspaceId,
        taskId,
        version: 1,
        graph: graph as unknown as Prisma.InputJsonValue,
        createdBy: GENERATED_BY,
      },
      update: {
        workspaceId,
        graph: graph as unknown as Prisma.InputJsonValue,
        createdBy: GENERATED_BY,
      },
    });

    const timelineItems = createFixtureTimelineItems(fixture, {
      workspaceId,
      taskId,
      planId: compiledPlan.editablePlanId,
    });
    if (timelineItems.length > 0) {
      await tx.taskTimelineItem.deleteMany({ where: { taskId } });
      await tx.taskTimelineItem.createMany({
        data: timelineItems.map((item) => ({
          ...item,
          metadata: item.metadata as Prisma.InputJsonValue,
        })),
      });
    }
  });

  return { taskId, title: `[Graph: ${fixture.graphType}] ${fixture.description}` };
}

async function main() {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");

  const workspaceId = await resolveDefaultWorkspaceId();

  const seeded = [];
  for (const fixture of fixtures) {
    seeded.push(await seedFixture(fixture, workspaceId));
  }

  console.log(`Seeded ${seeded.length} graph layout fixture tasks into ${DATABASE_URL} workspace ${workspaceId}`);
  for (const item of seeded) {
    console.log(`${item.taskId} ${item.title}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
