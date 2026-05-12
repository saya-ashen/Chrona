import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TaskWorkspacePage } from "@/components/tasks/task-workspace-page";
import type { TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph";
import type { TaskPageData, TaskPlanGenerationStatus } from "./task-workspace-types";

const mocks = vi.hoisted(() => ({
  editorTask: null as TaskPageData["task"] | null,
  plan: null as { id: string; status: string } | null,
  graphPlan: null as TaskPlanGraphPlan | null,
  planGenerationStatus: "idle" as TaskPlanGenerationStatus,
  canAcceptPlan: false,
}));

vi.mock("@/components/tasks/use-task-workspace-editor-state", () => ({
  useTaskWorkspaceEditorState: (task: TaskPageData["task"]) => {
    mocks.editorTask = mocks.editorTask ?? task;
    return {
      task: mocks.editorTask,
      setTask: vi.fn(),
      hasUnsavedConfigChanges: false,
      isSaving: false,
      saveError: null,
      setSaveError: vi.fn(),
      saveSuccess: false,
      isEditExpanded: false,
      setIsEditExpanded: vi.fn(),
      taskConfigInitialValues: {},
      draftEditableTask: mocks.editorTask,
      editSummary: [],
      planningTaskDraft: mocks.editorTask,
      assistantBuildCurrentTask: vi.fn(),
      handleTaskConfigDraftStateChange: vi.fn(),
      persistTaskConfig: vi.fn(),
      handleSaveCurrentDraft: vi.fn(),
    };
  },
}));

vi.mock("@/components/tasks/use-task-workspace-plan-state", () => ({
  useTaskWorkspacePlanState: () => ({
    plan: mocks.plan,
    setPlan: vi.fn(),
    fetchPlan: vi.fn(),
    planGenerationStatus: mocks.planGenerationStatus,
    graphPlan: mocks.graphPlan,
    canAcceptPlan: mocks.canAcceptPlan,
    isAcceptingPlan: false,
    acceptPlanError: null,
    setAcceptPlanError: vi.fn(),
    isAiWorkspaceOpen: false,
    setIsAiWorkspaceOpen: vi.fn(),
    requestGenerationKey: 0,
    acceptPlanById: vi.fn(),
    handleAcceptPlan: vi.fn(),
    dispatchExecutionAction: vi.fn(),
    handleOpenAiWorkspace: vi.fn(),
    handleGeneratePlanFromHeader: vi.fn(),
    assistantBuildCurrentPlan: vi.fn(),
  }),
}));

vi.mock("@/components/tasks/use-task-workspace-proposal-flow", () => ({
  useTaskWorkspaceProposalFlow: () => ({
    currentProposal: null,
    setCurrentProposal: vi.fn(),
    isApplying: false,
    handleApplyProposal: vi.fn(),
    handleProposal: vi.fn(),
    handleCancelProposal: vi.fn(),
  }),
}));

vi.mock("@/components/tasks/use-task-workspace-delete-flow", () => ({
  useTaskWorkspaceDeleteFlow: () => ({
    showDeleteConfirm: false,
    setShowDeleteConfirm: vi.fn(),
    isDeleting: false,
    handleDelete: vi.fn(),
  }),
}));

vi.mock("@/components/tasks/task-workspace-header-card", () => ({
  TaskWorkspaceHeaderCard: ({ task, progress, currentNodeTitle, nextAction, children }: { task: TaskPageData["task"]; progress: { label: string; percentComplete: number }; currentNodeTitle?: string | null; nextAction?: string | null; children: ReactNode }) => (
    <header>
      <h1>{task.title}</h1>
      <p>{progress.label}</p>
      <p>{progress.percentComplete}% complete</p>
      <p>schedule:{task.scheduleStatus}</p>
      <p>current:{currentNodeTitle ?? "none"}</p>
      <p>next:{nextAction ?? "none"}</p>
      {children}
    </header>
  ),
}));

vi.mock("@/components/tasks/task-workspace-edit-section", () => ({
  TaskWorkspaceEditSection: () => <section>Edit section</section>,
}));

vi.mock("@/components/tasks/task-workspace-plan-section", () => ({
  TaskWorkspacePlanSection: ({ topContent, pageData, plan, planGenerationStatus, canAcceptPlan, graphPlan }: { topContent: ReactNode; pageData: TaskPageData; plan: { status?: string } | null; planGenerationStatus: TaskPlanGenerationStatus; canAcceptPlan: boolean; graphPlan: TaskPlanGraphPlan | null }) => (
    <section aria-label="workspace plan section">
      {topContent}
      <p>task:{pageData.task.title}</p>
      <p>generation:{planGenerationStatus}</p>
      <p>plan:{plan?.status ?? "none"}</p>
      <p>accept:{canAcceptPlan ? "enabled" : "disabled"}</p>
      <p>nodes:{graphPlan?.nodes.length ?? 0}</p>
      <p>approvals:{pageData.approvals.length}</p>
      <p>artifacts:{pageData.artifacts.length}</p>
      <p>latest-run:{pageData.latestRunSummary?.status ?? "none"}</p>
    </section>
  ),
}));

vi.mock("@/components/tasks/task-workspace-ai-section", () => ({
  TaskWorkspaceAiSection: ({ generationStatus }: { generationStatus: TaskPlanGenerationStatus }) => <aside>ai:{generationStatus}</aside>,
}));

afterEach(() => {
  cleanup();
  mocks.editorTask = null;
  mocks.plan = null;
  mocks.graphPlan = null;
  mocks.planGenerationStatus = "idle";
  mocks.canAcceptPlan = false;
});

function taskData(): TaskPageData {
  return {
    defaultExecutionRuntime: "local",
    executionRuntimes: [],
    task: {
      id: "task-1",
      workspaceId: "workspace-1",
      title: "Plan migration",
      description: null,
      executionRuntime: "local",
      executionConfig: null,
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
    },
    latestRunSummary: null,
    scheduleProposals: [],
    approvals: [],
    artifacts: [],
  };
}

function graphPlan(status: TaskPlanGenerationStatus): TaskPlanGraphPlan {
  return {
    state: "ready",
    currentStepId: "step-1",
    nodes: [
      {
        id: "step-1",
        title: "Draft plan",
        objective: "Create execution outline",
        nextAction: "Start drafting",
        phase: "planning",
        status: status === "accepted" ? "done" : "ready",
      },
    ],
    steps: [
      {
        id: "step-1",
        title: "Draft plan",
        objective: "Create execution outline",
        nextAction: "Start drafting",
        phase: "planning",
        status: status === "accepted" ? "done" : "ready",
      },
    ],
    edges: [],
    analytics: {
      entryNodeIds: ["step-1"],
      terminalNodeIds: ["step-1"],
      activeNodeIds: [],
      reachableFromActiveIds: ["step-1"],
      criticalPathNodeIds: ["step-1"],
      attentionNodeIds: [],
      blockedNodeIds: [],
      rankByNodeId: { "step-1": 0 },
      laneByNodeId: { "step-1": 0 },
      upstreamByNodeId: { "step-1": [] },
      downstreamByNodeId: { "step-1": [] },
    },
  };
}

describe("TaskWorkspacePage", () => {
  it("renders the no-plan state with empty progress", () => {
    render(<TaskWorkspacePage data={taskData()} />);

    expect(screen.getByText("Plan migration")).toBeInTheDocument();
    expect(screen.getByText("No plan yet")).toBeInTheDocument();
    expect(screen.getByText("current:none")).toBeInTheDocument();
    expect(screen.getByText("next:none")).toBeInTheDocument();
    expect(screen.getByText("generation:idle")).toBeInTheDocument();
    expect(screen.getByText("plan:none")).toBeInTheDocument();
  });

  it("passes generating-plan state through the console regions", () => {
    mocks.planGenerationStatus = "generating";
    mocks.plan = { id: "plan-1", status: "draft" };
    mocks.graphPlan = graphPlan("generating");

    render(<TaskWorkspacePage data={taskData()} />);

    expect(screen.getByText("generation:generating")).toBeInTheDocument();
    expect(screen.getByText("ai:generating")).toBeInTheDocument();
    expect(screen.getByText("nodes:1")).toBeInTheDocument();
    expect(screen.getByText("current:Draft plan")).toBeInTheDocument();
    expect(screen.getByText("next:Start drafting")).toBeInTheDocument();
  });

  it("passes scheduled-ready current work into the header", () => {
    mocks.planGenerationStatus = "accepted";
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = graphPlan("waiting_acceptance");
    const data = taskData();
    data.task.scheduleStatus = "Scheduled";

    render(<TaskWorkspacePage data={data} />);

    expect(screen.getByText("schedule:Scheduled")).toBeInTheDocument();
    expect(screen.getByText("current:Draft plan")).toBeInTheDocument();
    expect(screen.getByText("next:Start drafting")).toBeInTheDocument();
  });

  it("keeps generated plans reviewable before acceptance", () => {
    mocks.planGenerationStatus = "waiting_acceptance";
    mocks.plan = { id: "plan-1", status: "draft" };
    mocks.graphPlan = graphPlan("waiting_acceptance");
    mocks.canAcceptPlan = true;

    render(<TaskWorkspacePage data={taskData()} />);

    expect(screen.getByText("generation:waiting_acceptance")).toBeInTheDocument();
    expect(screen.getByText("accept:enabled")).toBeInTheDocument();
    expect(screen.getByText("0/1 steps complete")).toBeInTheDocument();
  });

  it("renders accepted plans with completed progress", () => {
    mocks.planGenerationStatus = "accepted";
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = graphPlan("accepted");

    render(<TaskWorkspacePage data={taskData()} />);

    expect(screen.getByText("generation:accepted")).toBeInTheDocument();
    expect(screen.getByText("plan:accepted")).toBeInTheDocument();
    expect(screen.getByText("1/1 steps complete")).toBeInTheDocument();
    expect(screen.getByText("100% complete")).toBeInTheDocument();
  });

  it("passes human-review data through the workspace page", () => {
    const data = taskData();
    data.latestRunSummary = {
      id: "run-1",
      status: "WaitingForApproval",
      startedAt: "2026-05-12T11:00:00.000Z",
      syncStatus: "fresh",
    };
    data.approvals = [{
      id: "approval-1",
      title: "Approve generated patch",
      status: "Pending",
      riskLevel: "medium",
      requestedAt: "2026-05-12T11:05:00.000Z",
    }];
    data.artifacts = [{ id: "artifact-1", title: "Generated patch", type: "patch", uri: "file://patch.diff" }];

    render(<TaskWorkspacePage data={data} />);

    expect(screen.getByText("latest-run:WaitingForApproval")).toBeInTheDocument();
    expect(screen.getByText("approvals:1")).toBeInTheDocument();
    expect(screen.getByText("artifacts:1")).toBeInTheDocument();
  });
});
