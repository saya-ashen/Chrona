import type { PlanNodeDataModel, TaskPlanGraphPlan } from "../contract";
import { buildTaskHeaderSpec, type TaskHeaderActionInput, type UiDocument } from "@chrona/ui-protocol";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { TaskPageData } from "../model/task-workspace-types";

type TaskWorkspaceFixturePageOverrides = Omit<Partial<TaskPageData>, "task"> & {
  task?: Partial<TaskPageData["task"]>;
};

export function createTaskWorkspaceFixtureNode(
  input: Partial<PlanNodeDataModel> & { id: string; status: PlanNodeDataModel["status"] },
): PlanNodeDataModel {
  return {
    id: input.id,
    title: input.title ?? input.id,
    objective: input.objective ?? "Complete workspace step",
    phase: input.phase ?? "Execution",
    kind: input.kind,
    type: input.type,
    displayType: input.displayType,
    status: input.status,
    interactionType: input.interactionType,
    intent: input.intent,
    group: input.group,
    summary: input.summary,
    statusLabel: input.statusLabel,
    readiness: input.readiness,
    nextAction: input.nextAction,
    completionSummary: input.completionSummary,
    result: input.result,
    inputFields: input.inputFields,
    resultEvidence: input.resultEvidence,
    checkpoint: input.checkpoint,
    availableActions: input.availableActions,
    interactiveFields: input.interactiveFields,
    requiresHumanInput: input.requiresHumanInput,
    dependencies: input.dependencies,
    requiredInfo: input.requiredInfo,
    executionMode: input.executionMode,
    estimatedMinutes: input.estimatedMinutes,
    priority: input.priority,
    branchLabels: input.branchLabels,
    options: input.options,
    metadata: input.metadata,
  };
}

export function createTaskWorkspaceFixtureGraph(
  nodes: PlanNodeDataModel[],
  currentStepId: string | null = null,
): TaskPlanGraphPlan {
  return {
    state: nodes.length > 0 ? "ready" : "empty",
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `${nodes[index]?.id ?? "node"}-${node.id}`,
      from: nodes[index]?.id,
      to: node.id,
      kind: "sequential",
    })),
    steps: nodes,
    currentStepId,
    analytics: {
      entryNodeIds: nodes[0] ? [nodes[0].id] : [],
      terminalNodeIds: nodes.at(-1) ? [nodes.at(-1)!.id] : [],
      activeNodeIds: nodes.filter((node) => node.status === "active" || node.status === "in_progress").map((node) => node.id),
      reachableFromActiveIds: [],
      criticalPathNodeIds: nodes.map((node) => node.id),
      attentionNodeIds: nodes.filter((node) => node.status === "waiting_for_user" || node.status === "blocked").map((node) => node.id),
      blockedNodeIds: nodes.filter((node) => node.status === "blocked").map((node) => node.id),
      rankByNodeId: Object.fromEntries(nodes.map((node, index) => [node.id, index])),
      laneByNodeId: Object.fromEntries(nodes.map((node) => [node.id, 0])),
      upstreamByNodeId: {},
      downstreamByNodeId: {},
    },
  };
}

function createFixtureCommandCenter(): NonNullable<TaskPageData["commandCenter"]> {
  return {
    documents: {
      now: { root: "root", elements: { root: { type: "Text", props: { text: "Now" } } } },
      output: { root: "root", elements: { root: { type: "Text", props: { text: "Output" } } } },
      trail: { root: "root", elements: { root: { type: "Text", props: { text: "Trail" } } } },
    },
  };
}

// Single source of truth for header-spec test fixtures. Re-exports the
// real `buildTaskHeaderSpec` from `@chrona/ui-protocol` so any test that
// needs a `UiDocument` for the header (page mock, header-card render,
// plan section, etc.) routes through here. Keeps the builder import
// in one place — the engine `getHeaderSpec` is the only other caller.
export function createHeaderSpecFixture(input: {
  title: string;
  status?: "waiting" | "running" | "completed" | "blocked" | "approval-needed";
  priority?: "Low" | "Medium" | "High" | "Urgent";
  progressLabel?: string;
  occurrenceLabel?: string | null;
  actions?: TaskHeaderActionInput[];
} = { title: "Launch task" }): UiDocument {
  const status = input.status ?? "waiting";
  const priority = input.priority ?? "High";
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  return buildTaskHeaderSpec({
    title: input.title,
    status,
    statusLabel,
    progressLabel: input.progressLabel ?? "0 steps · 0 accepted · 0%",
    priorityLabel: priority,
    priorityTone: priority === "Urgent" ? "danger" : priority === "High" ? "warning" : "neutral",
    occurrenceLabel: input.occurrenceLabel ?? null,
    actions: input.actions ?? [
      { id: "generate-plan", label: "Generate plan" },
      { id: "edit", label: "Edit" },
      { id: "delete", label: "Delete Task" },
    ],
  });
}

function createFixtureHeader(task: Partial<TaskPageData["task"]> = {}): NonNullable<TaskPageData["header"]> {
  const title = task.title ?? "Launch task";
  const isRunning = task.status === "Running";
  return {
    spec: createHeaderSpecFixture({
      title,
      status: isRunning ? "running" : task.status === "Completed" ? "completed" : "waiting",
      priority: task.priority === "Low" || task.priority === "Medium" || task.priority === "High" || task.priority === "Urgent"
        ? task.priority
        : "High",
      actions: isRunning
        ? [{ id: "pause", label: "Pause" }, { id: "stop", label: "Stop" }, { id: "edit", label: "Edit" }, { id: "delete", label: "Delete Task" }]
        : undefined,
    }),
  };
}
export function createTaskWorkspaceFixturePageData(overrides: TaskWorkspaceFixturePageOverrides = {}): TaskPageData {
  const { task: taskOverrides = {}, ...pageOverrides } = overrides;

  return {
    defaultExecutionRuntime: "local",
    executionRuntimes: [],
    task: {
      id: "task-1",
      workspaceId: "workspace-1",
      title: "Launch task",
      description: null,
      executionRuntime: "local",
      executionConfig: null,
      autoPlanGeneration: false,
      autoExecute: false,
      autoPlanGenerationTiming: "at_start",
      autoExecuteTiming: "at_start",
      recurrenceRule: null,
      status: "Ready",
      priority: "High",
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: "Unscheduled",
      scheduleSource: null,
      isRunnable: true,
      runnabilitySummary: "Ready to run",
      blockReason: null,
      dependencies: [],
      ...taskOverrides,
    },
    latestRunSummary: null,
    scheduleProposals: [],
    approvals: [],
    artifacts: [],
    commandCenter: createFixtureCommandCenter(),
    header: createFixtureHeader(taskOverrides),
    ...pageOverrides,
  };
}

export const taskWorkspaceStateFixtures = {
  running: {
    pageData: createTaskWorkspaceFixturePageData({ task: { status: "Running" } }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "research", status: "done", completionSummary: "Research complete" }),
      createTaskWorkspaceFixtureNode({ id: "execute", status: "active", statusLabel: "Running" }),
    ], "execute"),
  },
  waiting: {
    pageData: createTaskWorkspaceFixturePageData({ task: { status: "Queued", scheduleStatus: "Scheduled" } }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "queued", status: "waiting", nextAction: "Wait for dependency" }),
    ], "queued"),
  },
  approvalNeeded: {
    pageData: createTaskWorkspaceFixturePageData({
      approvals: [{ id: "approval-1", title: "Approve result", status: "Pending", requestedAt: "2026-05-12T11:00:00.000Z" }],
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "approval", status: "waiting_for_user", requiresHumanInput: true, nextAction: "Approve result" }),
    ], "approval"),
  },
  blocked: {
    pageData: createTaskWorkspaceFixturePageData({
      task: {
        status: "Blocked",
        isRunnable: false,
        runnabilitySummary: "Resolve blocker before running",
        blockReason: { blockType: "blocked", actionRequired: "Review provider timeout" },
      },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "blocked", status: "blocked", nextAction: "Review provider timeout" }),
    ], "blocked"),
  },
  completed: {
    pageData: createTaskWorkspaceFixturePageData({ task: { status: "Done" } }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "complete", status: "done", completionSummary: "Workspace complete" }),
    ], "complete"),
  },
  failed: {
    pageData: createTaskWorkspaceFixturePageData({ task: { status: "Failed", runnabilitySummary: "Retry is available" } }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "failed", status: "blocked", statusLabel: "Failed", nextAction: "Retry failed node" }),
    ], "failed"),
  },
  idle: {
    pageData: createTaskWorkspaceFixturePageData(),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "ready", status: "ready", nextAction: "Start execution when ready" }),
    ], "ready"),
  },
  loading: {
    pageData: createTaskWorkspaceFixturePageData({ task: { status: "Planning" } }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "loading", status: "pending", statusLabel: "Loading" }),
    ], "loading"),
  },
  empty: {
    pageData: createTaskWorkspaceFixturePageData(),
    graphPlan: createTaskWorkspaceFixtureGraph([]),
  },
  artifactPresent: {
    pageData: createTaskWorkspaceFixturePageData({
      artifacts: [{ id: "artifact-1", title: "Report", type: "markdown", uri: "file://report.md" }],
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({
        id: "done",
        status: "done",
      }),
    ], "done"),
  },
  staleError: {
    pageData: createTaskWorkspaceFixturePageData({
      task: { status: "Blocked", isRunnable: false, runnabilitySummary: "Execution data is stale" },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "blocked", status: "blocked", nextAction: "Retry refresh" }),
    ], "blocked"),
  },
  permissionLimited: {
    pageData: createTaskWorkspaceFixturePageData({
      task: { status: "Ready", isRunnable: false, runnabilitySummary: "You can view this task, but cannot run it" },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "view-only", status: "ready", availableActions: [] }),
    ], "view-only"),
  },
  longContentMobile: {
    pageData: createTaskWorkspaceFixturePageData({
      task: {
        title: "Coordinate launch readiness across compliance-review-security-and-operations-without-losing-current-execution-context",
        description: "Long mobile-safe task content used to verify workspace panels wrap instead of forcing horizontal overflow.",
        runnabilitySummary: "Ready to run after compliance-review-security-and-operations sign off",
      },
      artifacts: [{
        id: "artifact-long-title",
        title: "Extremely long artifact title that should wrap inside the execution overview instead of widening the viewport",
        type: "markdown-report-with-long-classification",
        uri: "file://long-report.md",
      }],
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({
        id: "long-current-node",
        title: "Review cross-functional launch evidence and decide whether the workspace can continue safely",
        objective: "Keep active node identity visible on narrow screens with long content.",
        summary: "Long current-node summary should wrap across several lines without hiding actions or causing horizontal scroll.",
        status: "waiting_for_user",
        requiresHumanInput: true,
        nextAction: "Confirm evidence and provide launch approval notes before continuing.",
      }),
    ], "long-current-node"),
  },
};

// ---------------------------------------------------------------------------
// Spec 019 — Plan-state fixtures (4 variants of `aiPlanGenerationStatus`)
// ---------------------------------------------------------------------------
//
// The "Current operation" card redesign (spec 019) has one variant per plan
// state. These fixtures give tests a stable, minimal `TaskPageData` shape for
// each. The `savedPlan` sub-objects below supply only the fields the page
// query actually reads (`id`, `status`, `summary`); the unused graph-shaped
// fields are cast via `as unknown as <Type>` so type-checking passes without
// hand-writing 200+ lines of CompiledPlan/EffectivePlan data per fixture.
//
// See `specs/019-plan-card-and-accept-tests/plan.md` §2.3.

function makeSavedPlanFixture(
  status: "draft" | "accepted" | "superseded" | "archived",
  summary: string,
): TaskPlanReadModel {
  // The page query only reads `savedPlan.id`, `savedPlan.status`, and
  // `savedPlan.summary` (see `task-workspace-query.ts:462-463`). The
  // remaining `TaskPlanReadModel` fields are present so the type-check
  // passes, but their contents are placeholders — tests do not assert on
  // them.
  return {
    id: "plan-1",
    status,
    revision: 1,
    prompt: null,
    summary,
    updatedAt: "2026-06-13T00:00:00.000Z",
    generatedBy: null,
    blueprint: {} as unknown as TaskPlanReadModel["blueprint"],
    compiledPlan: {} as unknown as TaskPlanReadModel["compiledPlan"],
    effectivePlan: {} as unknown as TaskPlanReadModel["effectivePlan"],
  };
}

export const taskWorkspacePlanStateFixtures = {
  planIdle: {
    pageData: createTaskWorkspaceFixturePageData({
      task: { aiPlanGenerationStatus: "idle", savedPlan: null },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([], null),
  },
  planGenerating: {
    pageData: createTaskWorkspaceFixturePageData({
      task: { aiPlanGenerationStatus: "generating", savedPlan: null },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([], null),
  },
  planWaitingAcceptance: {
    pageData: createTaskWorkspaceFixturePageData({
      task: {
        aiPlanGenerationStatus: "waiting_acceptance",
        savedPlan: makeSavedPlanFixture(
          "draft",
          "Research the target user, draft a one-page brief, deliver it to the team channel.",
        ),
      },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "n1", status: "pending" }),
    ], "n1"),
  },
  planAccepted: {
    pageData: createTaskWorkspaceFixturePageData({
      task: {
        aiPlanGenerationStatus: "accepted",
        savedPlan: makeSavedPlanFixture(
          "accepted",
          "Research the target user, draft a one-page brief, deliver it to the team channel.",
        ),
      },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({ id: "n1", status: "pending" }),
    ], "n1"),
  },
};
