import type { TaskPlanNode, TaskPlanEdge } from "@chrona/contracts/ai";
import { db } from "@chrona/db";
import { MemoryScope, MemorySourceType, MemoryStatus } from "@chrona/db/generated/prisma/client";

// ───────────────────────────────────────────────────
// Execution-orchestration fixture types
// ───────────────────────────────────────────────────

export interface FixturePlanNode extends Omit<TaskPlanNode, "type"> {
  type: TaskPlanNode["type"];
  dependencies?: string[];
  requiredInfo?: string[];
  executionClassification?: "automatic_chainable" | "automatic_standalone" | "human_dependent" | "review_gate";
  nextAction?: string | null;
  readiness?: "ready" | "blocked" | "waiting";
}

export interface FixturePlanGraph {
  id: string;
  taskId: string;
  status: "draft" | "accepted" | "superseded" | "archived";
  revision: number;
  source: "ai" | "user" | "mixed";
  summary: string;
  nodes: FixturePlanNode[];
  edges: TaskPlanEdge[];
}

export interface FixtureWorkBlock {
  id: string;
  taskId: string;
  workspaceId: string;
  planId: string | null;
  title: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  trigger: "scheduled" | "manual";
}

export interface FixtureExecutionSession {
  id: string;
  taskId: string;
  workspaceId: string;
  workBlockId: string | null;
  planId: string;
  status: "active" | "paused" | "completed" | "abandoned";
  currentNodeId: string | null;
  pauseReason: string | null;
  completedNodeIds: string[];
  startedAt: Date;
}

export interface FixtureReviewOutcome {
  nodeId: string;
  outcome: "accept" | "reject" | "request_changes";
  feedback: string | null;
}

// ───────────────────────────────────────────────────
// Sample plan graphs with rich execution metadata
// ───────────────────────────────────────────────────

/**
 * A balanced plan mixing automatic and human-dependent steps.
 * Represents a "write blog post" scenario.
 */
export const SAMPLE_PLAN_PRODUCT_LAUNCH: FixturePlanGraph = {
  id: "plan-product-launch",
  taskId: "",
  status: "accepted",
  revision: 1,
  source: "ai",
  summary: "Write and publish a product launch blog post",
  nodes: [
    {
      id: "n1-research",
      type: "task",
      title: "Research competitor launch posts",
      objective: "Find and analyze 3-5 competitor launch blog posts for structure and messaging patterns",
      description: "Use web search to find recent product launch announcements",
      status: "pending",
      phase: "research",
      estimatedMinutes: 15,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: [],
      requiredInfo: [],
      executionClassification: "automatic_chainable",
      nextAction: "auto-start research",
      readiness: "ready",
    },
    {
      id: "n2-outline",
      type: "task",
      title: "Draft blog post outline",
      objective: "Create a structured outline for the launch post based on research",
      description: "Generate outline with sections: intro, key features, benefits, call to action",
      status: "pending",
      phase: "planning",
      estimatedMinutes: 15,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: true,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n1-research"],
      requiredInfo: [],
      executionClassification: "review_gate",
      nextAction: "generate outline then wait for review",
      readiness: "blocked",
    },
    {
      id: "n3-user-input",
      type: "checkpoint",
      title: "Provide product details",
      objective: "Collect specific product features, pricing, and availability details from user",
      description: "User must supply concrete product information before the AI can write content",
      status: "pending",
      phase: "preparation",
      estimatedMinutes: 5,
      priority: "Urgent",
      executionMode: "manual",
      requiresHumanInput: true,
      requiresHumanApproval: false,
      autoRunnable: false,
      blockingReason: "needs_user_input",
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: [],
      requiredInfo: ["product_features", "pricing_tiers", "launch_date", "target_audience"],
      executionClassification: "human_dependent",
      nextAction: "wait for user input on product details",
      readiness: "ready",
    },
    {
      id: "n4-draft",
      type: "task",
      title: "Write first draft",
      objective: "Write the complete first draft of the blog post",
      description: "Combine outline, research, and product details into a polished draft",
      status: "pending",
      phase: "execution",
      estimatedMinutes: 30,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n2-outline", "n3-user-input"],
      requiredInfo: [],
      executionClassification: "automatic_standalone",
      nextAction: "generate draft when outline approved and input received",
      readiness: "blocked",
    },
    {
      id: "n5-review",
      type: "checkpoint",
      title: "Review final draft",
      objective: "User reviews and approves the final blog post draft",
      description: "Present the draft for human review before publishing",
      status: "pending",
      phase: "review",
      estimatedMinutes: 10,
      priority: "High",
      executionMode: "manual",
      requiresHumanInput: false,
      requiresHumanApproval: true,
      autoRunnable: false,
      blockingReason: "needs_approval",
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n4-draft"],
      requiredInfo: [],
      executionClassification: "review_gate",
      nextAction: "wait for human review of final draft",
      readiness: "blocked",
    },
    {
      id: "n6-publish",
      type: "task",
      title: "Format and publish",
      objective: "Format the approved draft and publish to the blog platform",
      description: "Apply markdown formatting, SEO metadata, and publish",
      status: "pending",
      phase: "execution",
      estimatedMinutes: 5,
      priority: "Medium",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n5-review"],
      requiredInfo: [],
      executionClassification: "automatic_chainable",
      nextAction: "auto-publish after review approval",
      readiness: "blocked",
    },
  ],
  edges: [
    { id: "e1", fromNodeId: "n1-research", toNodeId: "n2-outline", type: "sequential", metadata: null },
    { id: "e2", fromNodeId: "n2-outline", toNodeId: "n4-draft", type: "sequential", metadata: null },
    { id: "e3", fromNodeId: "n3-user-input", toNodeId: "n4-draft", type: "depends_on", metadata: null },
    { id: "e4", fromNodeId: "n4-draft", toNodeId: "n5-review", type: "sequential", metadata: null },
    { id: "e5", fromNodeId: "n5-review", toNodeId: "n6-publish", type: "sequential", metadata: null },
  ],
};

/**
 * An all-automatic plan with no human-dependent steps.
 * Represents a "data pipeline" scenario.
 */
export const SAMPLE_PLAN_COMPETITOR_RESEARCH: FixturePlanGraph = {
  id: "plan-competitor-research",
  taskId: "",
  status: "accepted",
  revision: 1,
  source: "ai",
  summary: "Research top 5 competitors and generate a comparison report",
  nodes: [
    {
      id: "n1-identify",
      type: "task",
      title: "Identify top competitors",
      objective: "Search and identify the top 5 competitors in the target market",
      description: "Use web search to find leading companies",
      status: "pending",
      phase: "research",
      estimatedMinutes: 10,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: [],
      requiredInfo: [],
      executionClassification: "automatic_chainable",
      nextAction: "auto-identify competitors",
      readiness: "ready",
    },
    {
      id: "n2-analyze",
      type: "task",
      title: "Analyze each competitor",
      objective: "For each competitor, analyze pricing, features, market position, and strengths/weaknesses",
      description: "Gather detailed competitive intelligence",
      status: "pending",
      phase: "analysis",
      estimatedMinutes: 25,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n1-identify"],
      requiredInfo: [],
      executionClassification: "automatic_chainable",
      nextAction: "auto-analyze each competitor in sequence",
      readiness: "blocked",
    },
    {
      id: "n3-compare",
      type: "task",
      title: "Generate comparison matrix",
      objective: "Create a structured comparison table across all competitors",
      description: "Tabulate features, pricing, and positioning",
      status: "pending",
      phase: "analysis",
      estimatedMinutes: 15,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n2-analyze"],
      requiredInfo: [],
      executionClassification: "automatic_chainable",
      nextAction: "auto-generate comparison matrix",
      readiness: "blocked",
    },
    {
      id: "n4-report",
      type: "task",
      title: "Write final report",
      objective: "Compile findings into a structured executive summary report",
      description: "Generate report with executive summary, detailed analysis, and recommendations",
      status: "pending",
      phase: "execution",
      estimatedMinutes: 15,
      priority: "Medium",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n3-compare"],
      requiredInfo: [],
      executionClassification: "automatic_standalone",
      nextAction: "auto-generate final report",
      readiness: "blocked",
    },
  ],
  edges: [
    { id: "e1", fromNodeId: "n1-identify", toNodeId: "n2-analyze", type: "sequential", metadata: null },
    { id: "e2", fromNodeId: "n2-analyze", toNodeId: "n3-compare", type: "sequential", metadata: null },
    { id: "e3", fromNodeId: "n3-compare", toNodeId: "n4-report", type: "sequential", metadata: null },
  ],
};

/**
 * A plan with a blocking condition that evaluates based on external state.
 */
export const SAMPLE_PLAN_WITH_CONDITION: FixturePlanGraph = {
  id: "plan-with-condition",
  taskId: "",
  status: "accepted",
  revision: 1,
  source: "ai",
  summary: "Deploy feature flag rollout with conditional gating",
  nodes: [
    {
      id: "n1-build",
      type: "task",
      title: "Build and test feature",
      objective: "Implement the feature behind a feature flag",
      description: "Code, test, and verify the feature works",
      status: "pending",
      phase: "execution",
      estimatedMinutes: 60,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: [],
      requiredInfo: [],
      executionClassification: "automatic_chainable",
      nextAction: "auto-build feature",
      readiness: "ready",
    },
    {
      id: "n2-evaluate",
      type: "condition",
      title: "Check test coverage threshold",
      objective: "Verify test coverage meets 80% threshold before rollout",
      description: "Condition: test coverage >= 80%",
      status: "pending",
      phase: "validation",
      estimatedMinutes: 5,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: { condition: "coverage >= 80%", branches: ["rollout", "improve_tests"] },
      dependencies: ["n1-build"],
      requiredInfo: [],
      executionClassification: "automatic_standalone",
      nextAction: "auto-evaluate coverage threshold",
      readiness: "blocked",
    },
    {
      id: "n3-rollout",
      type: "task",
      title: "Rollout to 10% of users",
      objective: "Enable the feature flag for 10% of production traffic",
      description: "Gradual rollout with monitoring",
      status: "pending",
      phase: "execution",
      estimatedMinutes: 10,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: true,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n2-evaluate"],
      requiredInfo: [],
      executionClassification: "review_gate",
      nextAction: "request approval for 10% rollout",
      readiness: "blocked",
    },
    {
      id: "n4-monitor",
      type: "task",
      title: "Monitor error rates for 30 minutes",
      objective: "Observe production metrics for errors after rollout",
      description: "Check error rates, latency, and user feedback",
      status: "pending",
      phase: "monitoring",
      estimatedMinutes: 30,
      priority: "Medium",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n3-rollout"],
      requiredInfo: [],
      executionClassification: "automatic_standalone",
      nextAction: "auto-monitor after rollout approved",
      readiness: "blocked",
    },
  ],
  edges: [
    { id: "e1", fromNodeId: "n1-build", toNodeId: "n2-evaluate", type: "sequential", metadata: null },
    { id: "e2", fromNodeId: "n2-evaluate", toNodeId: "n3-rollout", type: "sequential", metadata: null },
    { id: "e3", fromNodeId: "n3-rollout", toNodeId: "n4-monitor", type: "sequential", metadata: null },
  ],
};

/**
 * A plan where a node is blocked due to an external dependency.
 */
export const SAMPLE_PLAN_BLOCKED_STEP: FixturePlanGraph = {
  id: "plan-blocked-step",
  taskId: "",
  status: "accepted",
  revision: 1,
  source: "ai",
  summary: "Database migration with external dependency",
  nodes: [
    {
      id: "n1-backup",
      type: "task",
      title: "Create database backup",
      objective: "Take a snapshot backup before migration",
      description: "Run pg_dump or equivalent backup command",
      status: "done",
      phase: "preparation",
      estimatedMinutes: 5,
      priority: "Urgent",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: "Backup completed successfully at /backups/migration-2026-05-03.sql",
      metadata: null,
      dependencies: [],
      requiredInfo: [],
      executionClassification: "automatic_chainable",
      nextAction: null,
      readiness: "ready",
    },
    {
      id: "n2-migrate",
      type: "task",
      title: "Run schema migration",
      objective: "Apply the database schema migration",
      description: "Run prisma migrate deploy",
      status: "blocked",
      phase: "execution",
      estimatedMinutes: 10,
      priority: "Urgent",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: false,
      blockingReason: "external_dependency",
      linkedTaskId: null,
      completionSummary: null,
      metadata: { blockedBy: "dba-approval-required", blockedSince: "2026-05-03T08:00:00Z" },
      dependencies: ["n1-backup"],
      requiredInfo: ["dba_approval_token"],
      executionClassification: "automatic_standalone",
      nextAction: "waiting for DBA approval before migration can proceed",
      readiness: "blocked",
    },
    {
      id: "n3-verify",
      type: "task",
      title: "Verify migration integrity",
      objective: "Run integrity checks on the migrated database",
      description: "Check data consistency, indexes, and foreign keys",
      status: "pending",
      phase: "validation",
      estimatedMinutes: 10,
      priority: "High",
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
      linkedTaskId: null,
      completionSummary: null,
      metadata: null,
      dependencies: ["n2-migrate"],
      requiredInfo: [],
      executionClassification: "automatic_chainable",
      nextAction: "auto-verify after migration completes",
      readiness: "blocked",
    },
  ],
  edges: [
    { id: "e1", fromNodeId: "n1-backup", toNodeId: "n2-migrate", type: "sequential", metadata: null },
    { id: "e2", fromNodeId: "n2-migrate", toNodeId: "n3-verify", type: "sequential", metadata: null },
  ],
};

// ───────────────────────────────────────────────────
// Sample work blocks
// ───────────────────────────────────────────────────

export const SAMPLE_WORK_BLOCK_SCHEDULED: FixtureWorkBlock = {
  id: "wb-scheduled-1",
  taskId: "",
  workspaceId: "",
  planId: "plan-product-launch",
  title: "Morning writing session",
  status: "scheduled",
  scheduledStartAt: new Date("2026-05-04T09:00:00Z"),
  scheduledEndAt: new Date("2026-05-04T10:30:00Z"),
  startedAt: null,
  completedAt: null,
  trigger: "scheduled",
};

export const SAMPLE_WORK_BLOCK_ACTIVE: FixtureWorkBlock = {
  id: "wb-active-1",
  taskId: "",
  workspaceId: "",
  planId: "plan-competitor-research",
  title: "Afternoon analysis session",
  status: "active",
  scheduledStartAt: new Date("2026-05-03T14:00:00Z"),
  scheduledEndAt: new Date("2026-05-03T16:00:00Z"),
  startedAt: new Date("2026-05-03T14:05:00Z"),
  completedAt: null,
  trigger: "manual",
};

// ───────────────────────────────────────────────────
// Sample execution sessions
// ───────────────────────────────────────────────────

export const SAMPLE_EXECUTION_SESSION_ACTIVE: FixtureExecutionSession = {
  id: "es-active-1",
  taskId: "",
  workspaceId: "",
  workBlockId: "wb-active-1",
  planId: "plan-competitor-research",
  status: "active",
  currentNodeId: "n2-analyze",
  pauseReason: null,
  completedNodeIds: ["n1-identify"],
  startedAt: new Date("2026-05-03T14:05:00Z"),
};

export const SAMPLE_EXECUTION_SESSION_PAUSED_INPUT: FixtureExecutionSession = {
  id: "es-paused-1",
  taskId: "",
  workspaceId: "",
  workBlockId: "wb-scheduled-1",
  planId: "plan-product-launch",
  status: "paused",
  currentNodeId: "n3-user-input",
  pauseReason: "needs_user_input",
  completedNodeIds: ["n1-research", "n2-outline"],
  startedAt: new Date("2026-05-04T09:00:00Z"),
};

export const SAMPLE_EXECUTION_SESSION_PAUSED_APPROVAL: FixtureExecutionSession = {
  id: "es-paused-2",
  taskId: "",
  workspaceId: "",
  workBlockId: null,
  planId: "plan-product-launch",
  status: "paused",
  currentNodeId: "n5-review",
  pauseReason: "needs_approval",
  completedNodeIds: ["n1-research", "n2-outline", "n3-user-input", "n4-draft"],
  startedAt: new Date("2026-05-04T10:00:00Z"),
};

// ───────────────────────────────────────────────────
// Sample review outcomes
// ───────────────────────────────────────────────────

export const SAMPLE_REVIEW_ACCEPT: FixtureReviewOutcome = {
  nodeId: "n5-review",
  outcome: "accept",
  feedback: "Draft looks great, proceed to publish",
};

export const SAMPLE_REVIEW_REJECT: FixtureReviewOutcome = {
  nodeId: "n2-outline",
  outcome: "reject",
  feedback: "Missing competitor pricing comparison section",
};

export const SAMPLE_REVIEW_REQUEST_CHANGES: FixtureReviewOutcome = {
  nodeId: "n4-draft",
  outcome: "request_changes",
  feedback: "Please add a section on migration strategy from the old platform",
};

// ───────────────────────────────────────────────────
// Fixture persistence helpers
// ───────────────────────────────────────────────────

export async function persistPlanFixture(
  taskId: string,
  workspaceId: string,
  fixture: FixturePlanGraph,
  status: "draft" | "accepted" = "accepted",
) {
  const serialized = JSON.stringify({
    type: "task_plan_graph_v1",
    status,
    revision: fixture.revision,
    source: fixture.source,
    generatedBy: "execution-orchestration-fixture",
    prompt: fixture.summary,
    summary: fixture.summary,
    changeSummary: null,
    nodes: fixture.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      objective: n.objective,
      description: n.description,
      status: n.status,
      phase: n.phase,
      estimatedMinutes: n.estimatedMinutes,
      priority: n.priority,
      executionMode: n.executionMode,
      requiresHumanInput: n.requiresHumanInput,
      requiresHumanApproval: n.requiresHumanApproval,
      autoRunnable: n.autoRunnable,
      blockingReason: n.blockingReason,
      linkedTaskId: n.linkedTaskId,
      completionSummary: n.completionSummary,
      metadata: {
        ...(n.metadata ?? {}),
        dependencies: n.dependencies ?? [],
        requiredInfo: n.requiredInfo ?? [],
        executionClassification: n.executionClassification ?? null,
        nextAction: n.nextAction ?? null,
      },
    })),
    edges: fixture.edges,
  });

  const memory = await db.memory.create({
    data: {
      workspaceId,
      taskId,
      content: serialized,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: status === "accepted" ? 1 : 0.7,
    },
  });

  return { planId: memory.id, memoryId: memory.id };
}

/**
 * Returns the set of "ready" node IDs (no dependencies, no blocking reason, auto-runnable).
 */
export function getReadyNodeIds(fixture: FixturePlanGraph): string[] {
  return fixture.nodes
    .filter((n) => n.readiness === "ready" && n.autoRunnable)
    .map((n) => n.id);
}

/**
 * Returns node IDs that are blocked by direct dependencies on the given completed set.
 */
export function getNextEligibleNodeIds(
  fixture: FixturePlanGraph,
  completedNodeIds: Set<string>,
): string[] {
  return fixture.nodes.filter((n) => {
    if (completedNodeIds.has(n.id)) return false;
    if (n.blockingReason) return false;
    const deps = n.dependencies ?? [];
    if (deps.length === 0) return true;
    return deps.every((d) => completedNodeIds.has(d));
  }).map((n) => n.id);
}
