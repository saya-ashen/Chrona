import { createPlanGraphFromCompiledPlan } from "@chrona/graph-runtime";
import type { CompiledEdge, CompiledNode, CompiledPlan, PlanGraph } from "@chrona/graph-runtime";
import { Prisma, PrismaClient, TaskPlanStatus, TaskPriority, WorkspaceStatus } from "../packages/db/src/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import {
  createFixturePlanOutput,
  createFixturePlanRun,
  createFixtureRuntimeEvidence,
  createFixtureTimelineItems,
  fixtureTaskStatus,
  fixtureTaskTitle,
  README_FIXTURE_GENERATED_BY,
} from "./readme-demo-fixtures";
import type {
  ReadmeFixture as Fixture,
  ReadmeFixtureEdge as FixtureEdge,
  ReadmeFixtureNode as FixtureNode,
} from "./readme-demo-fixtures";

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
const GENERATED_BY = README_FIXTURE_GENERATED_BY;
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
    taskTitle: "Prepare a GitHub Trending engineering brief",
    planTitle: "GitHub Trending research workflow",
    demoState: "waiting",
    resultKind: "trending-research",
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

const interactiveResearchFixture = fixtures.find((fixture) => fixture.slug === "inactive-branch-tail");
if (!interactiveResearchFixture) throw new Error("Missing README research fixture");
fixtures.push({
  ...interactiveResearchFixture,
  slug: "completed-research-brief",
  taskTitle: "Review the completed GitHub Trending brief",
  planTitle: "Completed GitHub Trending research workflow",
  demoState: "completed",
});

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
    title: fixture.planTitle ?? `[Graph: ${fixture.graphType}] ${fixture.description}`,
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
      status: WorkspaceStatus.Active,
    },
    create: {
      id: DEFAULT_WORKSPACE_ID,
      name: "Default Workspace",
      description: "Auto-created primary workspace for graph layout evaluation",
      status: WorkspaceStatus.Active,
    },
    select: { id: true },
  });

  return workspace.id;
}

async function resetReadmeFixtureState(
  tx: Prisma.TransactionClient,
  fixture: Fixture,
  taskId: string,
) {
  if (fixture.resultKind !== "trending-research") return;
  await tx.task.updateMany({
    where: { id: taskId },
    data: {
      latestRunId: null,
      latestEventId: null,
      latestRawEventId: null,
      blockedByEventId: null,
      blockedByRawEventId: null,
    },
  });
  await tx.event.deleteMany({ where: { taskId } });
  await tx.rawEventLog.deleteMany({ where: { taskId } });
  await tx.executionSession.deleteMany({ where: { taskId } });
  await tx.run.deleteMany({ where: { taskId } });
  await tx.taskProjection.deleteMany({ where: { taskId } });
}

function fixtureGraphStatus(fixture: Fixture, fallback: PlanGraph["status"]) {
  if (fixture.demoState === "completed") return "completed" as const;
  if (fixture.demoState === "running" || fixture.demoState === "waiting") return "active" as const;
  return fallback;
}

async function seedFixture(fixture: Fixture, workspaceId: string) {
  const taskId = `graph-fixture-${fixture.slug}`;
  const compiledPlan = buildCompiledPlan(fixture);
  const graph = applyInactiveEdges(
    createPlanGraphFromCompiledPlan({ taskId, compiledPlan }),
    fixture,
  );
  const runtimeEvidence = createFixtureRuntimeEvidence(fixture, graph);
  const planRunRecord = {
    planRun: createFixturePlanRun(compiledPlan, fixture),
    mutableGraph: {
      graph: {
        ...graph,
        status: fixtureGraphStatus(fixture, graph.status),
      },
      attempts: runtimeEvidence.attempts,
      results: runtimeEvidence.results,
      executionContextSnapshots: [],
      planOutput: createFixturePlanOutput(fixture),
    },
  };

  await prisma.$transaction(async (tx) => {
    await resetReadmeFixtureState(tx, fixture, taskId);
    await tx.task.upsert({
      where: { id: taskId },
      update: {
        workspaceId,
        title: fixtureTaskTitle(fixture),
        description: fixture.description,
        status: fixtureTaskStatus(fixture),
        priority: fixture.resultKind ? TaskPriority.Medium : TaskPriority.Low,
        executionConfig: {},
        latestRunId: null,
        latestEventId: null,
        latestRawEventId: null,
        blockedByEventId: null,
        blockedByRawEventId: null,
        blockReason: Prisma.JsonNull,
        completedAt: fixture.demoState === "completed" ? new Date() : null,
      },
      create: {
        id: taskId,
        workspaceId,
        title: fixtureTaskTitle(fixture),
        description: fixture.description,
        status: fixtureTaskStatus(fixture),
        priority: fixture.resultKind ? TaskPriority.Medium : TaskPriority.Low,
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

  return { taskId, title: fixtureTaskTitle(fixture) };
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
