import { createPlanGraphFromCompiledPlan } from "@chrona/graph-runtime";
import type { CompiledEdge, CompiledNode, CompiledPlan, PlanGraph } from "@chrona/graph-runtime";
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
    evaluationBy: "system",
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
    description: "短直线流程，用来判断基础上下/横向紧凑度。",
    nodes: [
      task("scope", "确认目标"),
      task("design", "设计方案"),
      task("build", "执行实现"),
      checkpoint("review", "确认交付"),
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
    description: "长直线流程，用来判断 snake/分行压缩是否生效。",
    nodes: Array.from({ length: 9 }, (_, index) => task(`step-${index + 1}`, `直线步骤 ${index + 1}`)),
    edges: Array.from({ length: 8 }, (_, index) => ({ from: `step-${index + 1}`, to: `step-${index + 2}` })),
  },
  {
    slug: "condition-merge",
    graphType: "Condition Branch + Merge",
    description: "一个条件分支后汇合，用来观察 true/false 分支与合流点。",
    nodes: [
      task("start", "收集上下文"),
      condition("choice", "是否需要修改代码", [
        { label: "true", nextNodeId: "patch" },
        { label: "false", nextNodeId: "explain" },
      ]),
      task("patch", "生成补丁"),
      task("explain", "解释原因"),
      checkpoint("merge", "确认下一步"),
      task("finish", "整理结果"),
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
    graphType: "Inactive Branch + Dominant Tail",
    description: "类似刚才问题任务：条件节点有未通过分支，主路径后面还有人工确认与写入尾部。",
    nodes: [
      checkpoint("need", "确认需求"),
      task("design", "确定规格"),
      task("build", "创建脚本"),
      task("verify", "验证脚本"),
      condition("choice", "判断验证结果", [
        { label: "true", nextNodeId: "deliver" },
        { label: "false", nextNodeId: "blocked-summary" },
      ]),
      task("blocked-summary", "整理阻塞事项"),
      task("deliver", "整理交付内容"),
      checkpoint("confirm-write", "确认写入范围", "input"),
      task("write", "写入或更新文件"),
    ],
    edges: [
      { from: "need", to: "design" },
      { from: "design", to: "build" },
      { from: "build", to: "verify" },
      { from: "verify", to: "choice" },
      { from: "choice", to: "blocked-summary", label: "false", active: false },
      { from: "choice", to: "deliver", label: "true" },
      { from: "deliver", to: "confirm-write" },
      { from: "confirm-write", to: "write" },
    ],
  },
  {
    slug: "parallel-diamond",
    graphType: "Parallel Diamond Fan-out/Fan-in",
    description: "一个入口拆成三条并行任务后汇合。",
    nodes: [
      task("start", "准备输入"),
      task("api", "实现 API"),
      task("ui", "实现 UI"),
      task("docs", "更新文档"),
      checkpoint("join", "并行结果验收"),
      task("ship", "发布结果"),
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
    description: "宽分支压力测试，用来判断横向空间、边交叉与边界。",
    nodes: [
      task("start", "分析输入"),
      task("branch-a", "分支 A"),
      task("branch-b", "分支 B"),
      task("branch-c", "分支 C"),
      task("branch-d", "分支 D"),
      task("branch-e", "分支 E"),
      checkpoint("join", "汇总五条分支"),
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
    description: "分支里继续分支，用来判断局部槽位递归复杂度。",
    nodes: [
      task("start", "读取需求"),
      condition("choice-a", "是否缺少信息", [
        { label: "true", nextNodeId: "ask" },
        { label: "false", nextNodeId: "choice-b" },
      ]),
      checkpoint("ask", "补充缺失信息", "input"),
      condition("choice-b", "是否需要实现", [
        { label: "true", nextNodeId: "implement" },
        { label: "false", nextNodeId: "document" },
      ]),
      task("implement", "实现修改"),
      task("document", "只更新说明"),
      checkpoint("join", "确认分支结果"),
      task("finish", "最终回复"),
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
    description: "主执行路径穿插 approval、input、wait 节点，用来观察 sidecar/人工节点。",
    nodes: [
      task("draft", "生成草稿"),
      checkpoint("approve", "人工审批草稿"),
      task("revise", "按审批结果修订"),
      checkpoint("input", "补充发布参数", "input"),
      wait("wait-window", "等待发布时间窗"),
      task("publish", "发布结果"),
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
    description: "不是树的 DAG：多个中间节点互相形成额外依赖，观察交叉边。",
    nodes: [
      task("start", "准备基础数据"),
      task("model", "设计数据模型"),
      task("api", "实现接口"),
      task("ui", "实现页面"),
      task("integration", "联调集成"),
      checkpoint("review", "最终检查"),
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
    description: "混合长主路径、条件分支、人工输入、等待和汇合，作为综合压力用例。",
    nodes: [
      task("intake", "理解用户问题"),
      task("inspect", "检查代码现状"),
      condition("risk", "是否需要人工确认", [
        { label: "true", nextNodeId: "confirm" },
        { label: "false", nextNodeId: "implement" },
      ]),
      checkpoint("confirm", "确认风险范围"),
      task("implement", "实施修改"),
      task("tests", "运行测试"),
      condition("test-result", "测试是否通过", [
        { label: "true", nextNodeId: "summarize" },
        { label: "false", nextNodeId: "fix" },
      ]),
      task("fix", "修复失败测试"),
      wait("wait-ci", "等待外部校验"),
      task("summarize", "总结交付"),
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
      where: { taskId_planId: { taskId, planId: compiledPlan.editablePlanId } },
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
