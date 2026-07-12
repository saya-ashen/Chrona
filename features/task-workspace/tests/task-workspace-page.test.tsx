import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TaskWorkspacePage } from "../ui/task-workspace-page";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph";
import { createHeaderSpecFixture, taskWorkspaceStateFixtures } from "@features/task-workspace/test-support/task-workspace-test-fixtures";
import { createTaskWorkspaceUiFixture } from "@/components/tasks/workspace/test/task-workspace-ui-fixtures";
import type { UiDocument } from "@chrona/ui-protocol";
import type { TaskPageData, TaskPlanGenerationStatus } from "./task-workspace-model";

const mocks = vi.hoisted(() => ({
  editorTask: null as TaskPageData["task"] | null,
  plan: null as { id: string; status: string } | null,
  graphPlan: null as TaskPlanGraphPlan | null,
  planGenerationStatus: "idle" as TaskPlanGenerationStatus,
  canAcceptPlan: false,
  setPageContext: vi.fn(),
  navigate: vi.fn(),
  // Per-test overrides for the `/execution/can-*` state paths the
  // mock header card consults to compute the visible primary action.
  executionState: {} as Record<string, unknown>,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/components/assistant-surface/assistant-surface-provider", () => ({
  useAssistantSurface: () => ({
    registerHandlers: vi.fn(() => vi.fn()),
    setPageContext: mocks.setPageContext,
  }),
}));


vi.mock("@/components/tasks/workspace/hooks/use-task-workspace-editor-state", () => ({
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

vi.mock("@/components/tasks/workspace/hooks/use-task-workspace-page-state", () => ({
  useTaskWorkspacePageState: (data: TaskPageData) => ({
    pageData: data,
    commandCenter: data.commandCenter,
    setTask: vi.fn(),
    refreshWorkspace: vi.fn(async () => undefined),
    isRefreshing: false,
    workspaceEvents: [],
    headerSpec: data.header?.spec ?? createHeaderSpecFixture({ title: data.task.title }),
    // Per-test overrides for the `/execution/can-*` state paths the
    // mock header card consults to compute the visible primary action.
    // Tests that want to assert a particular "running" / "completed"
    // state can seed these via `mocks.executionState = { ... }`.
    executionState: {} as Record<string, unknown>,
    headerStore: {
      get: (path: string) => mocks.executionState[path],
      set: vi.fn(),
      update: vi.fn(),
      getSnapshot: () => mocks.executionState,
      getServerSnapshot: () => mocks.executionState,
      subscribe: () => vi.fn(),
    },
  }),
}));

vi.mock("@/components/tasks/workspace/hooks/use-task-workspace-plan-state", () => ({
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
    requestGenerationKey: 0,
    runtimeEvents: [],
    latestActivitySummary: null,
    acceptPlanById: vi.fn(),
    handleAcceptPlan: vi.fn(),
    dispatchExecutionAction: vi.fn(),
    handleGeneratePlanFromHeader: vi.fn(),
    assistantBuildCurrentPlan: vi.fn(),
  }),
}));

vi.mock("@/components/tasks/workspace/hooks/use-task-workspace-proposal-flow", () => ({
  useTaskWorkspaceProposalFlow: () => ({
    currentProposal: null,
    setCurrentProposal: vi.fn(),
    isApplying: false,
    handleApplyProposal: vi.fn(),
    handleProposal: vi.fn(),
    handleCancelProposal: vi.fn(),
  }),
}));

vi.mock("@/components/tasks/workspace/hooks/use-task-workspace-delete-flow", () => ({
  useTaskWorkspaceDeleteFlow: () => ({
    showDeleteConfirm: false,
    setShowDeleteConfirm: vi.fn(),
    isDeleting: false,
    handleDelete: vi.fn(),
  }),
}));

vi.mock("../ui/task-workspace-header-card", () => ({
  TaskWorkspaceHeaderCard: ({ task, spec, store }: { task: TaskPageData["task"]; spec: UiDocument; store?: { get: (path: string) => unknown } }) => {
    const elements = spec.elements;
    const statusText = elements["badge:primary-state"]?.props?.text;
    const actionEntries = Object.entries(elements).filter(([key]) => key.startsWith("action:"));
    // In the state-driven header architecture every execution action
    // element exists in the spec — visibility is bound to `/execution/can-*`
    // state paths that the renderer consults via the store. The mock
    // re-implements that resolution locally so the test can assert the
    // "primary" action the user would actually see for the current
    // state, instead of just the first element in the spec.
    const isActionVisible = (element: { visible?: unknown }): boolean => {
      const v = element.visible;
      if (!v || typeof v !== "object") return true;
      const ref = (v as { $state?: string }).$state;
      if (!ref) return true;
      return Boolean(store?.get(ref));
    };
    const visibleActions = actionEntries.filter(([, element]) => isActionVisible(element));
    const firstVisibleLabel = visibleActions
      .map(([, element]) => element.props?.label)
      .find((label): label is string => typeof label === "string") ?? "none";
    const hasOverflow = Boolean(elements["header-overflow"]);
    return (
      <header>
        <h1>{task.title}</h1>
        <section aria-label="Workspace state">
          <p>Current state</p>
          <p>{typeof statusText === "string" ? statusText : "unknown"}</p>
        </section>
        <p>header-status:{task.status}</p>
        <p>workspace-status:{typeof statusText === "string" ? statusText.toLowerCase() : "unknown"}</p>
        <p>primary-action:{firstVisibleLabel}</p>
        {visibleActions.map(([key, element]) => {
          const label = element.props?.label;
          return <button key={key} type="button" disabled={Boolean(element.props?.disabled)}>{typeof label === "string" ? label : key}</button>;
        })}
        {hasOverflow ? <button type="button">...</button> : null}
      </header>
    );
  },
}));

vi.mock("@/components/tasks/workspace/sections/task-workspace-edit-section", () => ({
  TaskWorkspaceEditSection: () => <section>Edit section</section>,
}));

vi.mock("@/components/tasks/workspace/sections/task-workspace-plan-section", async () => {
  const React = await import("react");
  const { createTaskWorkspaceExecutionConsoleView } = await import("./task-workspace-model");

  return {
    TaskWorkspacePlanSection: ({ pageData, plan, planGenerationStatus, canAcceptPlan, graphPlan, onApplyPlan }: { pageData: TaskPageData; plan: { id?: string; status?: string } | null; planGenerationStatus: TaskPlanGenerationStatus; canAcceptPlan: boolean; graphPlan: TaskPlanGraphPlan | null; onApplyPlan?: (plan: { id?: string; status?: string }) => void }) => {
      const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
      const selectedNode = graphPlan?.nodes.find((node) => node.id === selectedNodeId) ?? null;
      const consoleView = createTaskWorkspaceExecutionConsoleView({ pageData, graphPlan, selectedNode });

      return (
        <section aria-label="workspace plan section">
          <p>task:{pageData.task.title}</p>
          <p>generation:{planGenerationStatus}</p>
          <p>plan:{plan?.status ?? "none"}</p>
          <p>accept:{canAcceptPlan ? "enabled" : "disabled"}</p>
          <p>nodes:{graphPlan?.nodes.length ?? 0}</p>
          <p>approvals:{pageData.approvals.length}</p>
          <p>artifacts:{pageData.artifacts.length}</p>
          <p>latest-run:{pageData.latestRunSummary?.status ?? "none"}</p>
          <p>detail-title:{consoleView.nodeDetail.title}</p>
          <p>detail-status:{consoleView.nodeDetail.status ?? "none"}</p>
          <p>detail-step:{consoleView.nodeDetail.stepPosition}</p>
          <p>detail-refresh:{consoleView.nodeDetail.autoRefreshEnabled ? "on" : "off"}</p>
          <p>detail-disabled:{consoleView.nodeDetail.disabledActionReason ?? "none"}</p>
          <p>workspace-treatment:{consoleView.states.treatment.label}</p>
          <p>workspace-guidance:{consoleView.states.treatment.guidance}</p>
          <button type="button" disabled={planGenerationStatus === "generating"}>{planGenerationStatus === "generating" ? "Generating..." : plan ? "Regenerate plan" : "Generate plan"}</button>
          {canAcceptPlan && plan ? <button type="button" onClick={() => onApplyPlan?.(plan)}>Apply Plan</button> : null}
          <section aria-label="Execution flow" />
          <section aria-label="Current node details" />
          <aside aria-label="Execution overview" />
          {(graphPlan?.nodes ?? []).map((node) => (
            <button key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)}>
              Select {node.title}
            </button>
          ))}
        </section>
      );
    },
  };
});

afterEach(() => {
  cleanup();
  mocks.editorTask = null;
  mocks.plan = null;
  mocks.graphPlan = null;
  mocks.planGenerationStatus = "idle";
  mocks.canAcceptPlan = false;
  mocks.executionState = {};
  mocks.setPageContext.mockClear();
  mocks.navigate.mockClear();
});
function testCommandCenter(): NonNullable<TaskPageData["commandCenter"]> {
  return {
    documents: {
      now: { root: "root", elements: { root: { type: "Text", props: { text: "Now" } } } },
      output: { root: "root", elements: { root: { type: "Text", props: { text: "Output" } } } },
      trail: { root: "root", elements: { root: { type: "Text", props: { text: "Trail" } } } },
    },
  };
}

function testHeader(title: string): NonNullable<TaskPageData["header"]> {
  return {
    spec: createHeaderSpecFixture({ title }),
  };
}

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
      autoPlanGeneration: false,
      autoExecute: false,
      autoPlanGenerationTiming: "at_start",
      autoExecuteTiming: "at_start",
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
    commandCenter: testCommandCenter(),
    header: testHeader("Plan migration"),
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
    expect(screen.getByText("header-status:Ready")).toBeInTheDocument();
    expect(screen.getByText("workspace-status:waiting")).toBeInTheDocument();
    expect(screen.getByText("generation:idle")).toBeInTheDocument();
    expect(screen.getByText("plan:none")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "..." })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Generate plan" }).length).toBeGreaterThan(0);

  });


  it("passes generating-plan state through the console regions", () => {
    mocks.planGenerationStatus = "generating";
    mocks.plan = { id: "plan-1", status: "draft" };
    mocks.graphPlan = graphPlan("generating");

    render(<TaskWorkspacePage data={taskData()} />);

    expect(screen.getByText("generation:generating")).toBeInTheDocument();
    expect(screen.getByText("nodes:1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generating..." })).toBeDisabled();
  });

  it("passes scheduled-ready current work into the header", () => {
    mocks.planGenerationStatus = "accepted";
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = graphPlan("waiting_acceptance");
    const data = taskData();
    data.task.scheduleStatus = "Scheduled";

    render(<TaskWorkspacePage data={data} />);

    expect(screen.getByText("header-status:Ready")).toBeInTheDocument();
    expect(screen.getByText("workspace-status:waiting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeInTheDocument();
  });

  it("renders dominant task identity, state treatment, and ranked primary action", () => {
    const fixture = taskWorkspaceStateFixtures.running;
    mocks.planGenerationStatus = "accepted";
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = fixture.graphPlan;
    // Mirror the SSE state snapshot the engine would push for a
    // running task: Pause and Stop are visible, Start is not.
    mocks.executionState = {
      "/execution/can-start": false,
      "/execution/can-pause": true,
      "/execution/can-stop": true,
      "/execution/show-accept-plan": false,
      "/execution/show-generate-plan": false,
      "/execution/start-disabled": true,
      "/execution/start-disabled-reason": "Task is already running.",
      "/execution/status": "running",
    };

    render(<TaskWorkspacePage data={fixture.pageData} />);

    expect(screen.getByRole("region", { name: "Workspace state" })).toBeInTheDocument();
    expect(screen.getByText("Current state")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("primary-action:Pause")).toBeInTheDocument();
  });

  it("keeps generated plans reviewable before acceptance", () => {
    mocks.planGenerationStatus = "waiting_acceptance";
    mocks.plan = { id: "plan-1", status: "draft" };
    mocks.graphPlan = graphPlan("waiting_acceptance");
    mocks.canAcceptPlan = true;
    // Plan exists but is not yet accepted, so the state-driven
    // primary action is "Accept plan" (not "Generate plan" and not
    // "Start" — those are hidden).
    mocks.executionState = {
      "/execution/can-start": false,
      "/execution/can-pause": false,
      "/execution/can-stop": false,
      "/execution/show-accept-plan": true,
      "/execution/show-generate-plan": false,
      "/execution/start-disabled": true,
      "/execution/start-disabled-reason": "Accept the generated plan before starting execution.",
      "/execution/status": "ready",
    };

    render(<TaskWorkspacePage data={taskData()} />);

    expect(screen.getByText("generation:waiting_acceptance")).toBeInTheDocument();
    expect(screen.getByText("accept:enabled")).toBeInTheDocument();
    expect(screen.getByText("workspace-status:waiting")).toBeInTheDocument();
    expect(screen.getByText("primary-action:Accept plan")).toBeInTheDocument();
  });

  it("renders accepted plans with completed progress", () => {
    mocks.planGenerationStatus = "accepted";
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = graphPlan("accepted");

    render(<TaskWorkspacePage data={taskData()} />);

    expect(screen.getByText("generation:accepted")).toBeInTheDocument();
    expect(screen.getByText("plan:accepted")).toBeInTheDocument();
    expect(screen.getByText("workspace-status:waiting")).toBeInTheDocument();
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

  it("passes latest persisted activity to the assistant surface", () => {
    const data = taskData();
    data.activityTimeline = [{
      id: "provider-run-completed",
      kind: "provider_run",
      title: "Hermes reported blocked",
      summary: "Node 7 blocked on weather API timeout",
      description: "Node 7 blocked on weather API timeout",
      tone: "warning",
      timestamp: "2026-05-20T14:43:08.000Z",
    }];

    render(<TaskWorkspacePage data={data} />);

    expect(mocks.setPageContext).toHaveBeenCalled();
    const context = mocks.setPageContext.mock.calls.at(-1)?.[0];
    expect(context.highlights).toContainEqual(expect.objectContaining({
      label: "Activity",
      value: "Node 7 blocked on weather API timeout",
    }));
  });

  it("renders running task header progress with task-level actions", () => {
    const fixture = taskWorkspaceStateFixtures.running;
    mocks.planGenerationStatus = "accepted";
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = fixture.graphPlan;
    // The state-driven header for a running task exposes Pause and
    // Stop; Start is hidden.
    mocks.executionState = {
      "/execution/can-start": false,
      "/execution/can-pause": true,
      "/execution/can-stop": true,
      "/execution/show-accept-plan": false,
      "/execution/show-generate-plan": false,
      "/execution/start-disabled": true,
      "/execution/start-disabled-reason": "Task is already running.",
      "/execution/status": "running",
    };

    render(<TaskWorkspacePage data={fixture.pageData} />);

    expect(screen.getByRole("heading", { name: "Launch task" })).toBeInTheDocument();
    expect(screen.getByText("header-status:Running")).toBeInTheDocument();
    expect(screen.getByText("workspace-status:running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "..." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
  });

  it("renders waiting task progress without losing schedule context", () => {
    const fixture = taskWorkspaceStateFixtures.waiting;
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = fixture.graphPlan;

    render(<TaskWorkspacePage data={fixture.pageData} />);

    expect(screen.getByText("header-status:Queued")).toBeInTheDocument();
    expect(screen.getByText("workspace-status:waiting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeInTheDocument();
  });

  it("renders empty task state with disabled progress totals", () => {
    const fixture = taskWorkspaceStateFixtures.empty;
    mocks.graphPlan = fixture.graphPlan;

    render(<TaskWorkspacePage data={fixture.pageData} />);

    expect(screen.getByText("workspace-status:waiting")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Generate plan" }).length).toBeGreaterThan(0);
  });

  it("renders loading, empty, and error workspace page treatments", () => {
    const cases = [
      { fixture: taskWorkspaceStateFixtures.loading, planStatus: "generating", label: "Idle" },
      { fixture: taskWorkspaceStateFixtures.empty, planStatus: "idle", label: "No plan yet" },
      {
        fixture: {
          ...taskWorkspaceStateFixtures.staleError,
          pageData: {
            ...taskWorkspaceStateFixtures.staleError.pageData,
            latestRunSummary: { id: "run-1", status: "Running", startedAt: null, syncStatus: "stale" },
          },
        },
        planStatus: "accepted",
        label: "Sync stale",
      },
    ] as const;

    for (const testCase of cases) {
      mocks.planGenerationStatus = testCase.planStatus;
      mocks.plan = testCase.planStatus === "idle" ? null : { id: `plan-${testCase.label}`, status: "accepted" };
      mocks.graphPlan = testCase.fixture.graphPlan;

      render(<TaskWorkspacePage data={testCase.fixture.pageData} />);

      expect(screen.getByText(`workspace-treatment:${testCase.label}`)).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Workspace state" })).toBeInTheDocument();

      cleanup();
      mocks.plan = null;
      mocks.graphPlan = null;
      mocks.planGenerationStatus = "idle";
    }
  });

  it("keeps task-level actions visible for permission-limited workspaces", () => {
    const fixture = taskWorkspaceStateFixtures.permissionLimited;
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = fixture.graphPlan;
    // The fixture is in the "Ready" state with a plan accepted but
    // never started; the state-driven primary action is "Start".
    mocks.executionState = {
      "/execution/can-start": true,
      "/execution/can-pause": false,
      "/execution/can-stop": false,
      "/execution/show-accept-plan": false,
      "/execution/show-generate-plan": false,
      "/execution/start-disabled": true,
      "/execution/start-disabled-reason": "You can view this task, but cannot run it",
      "/execution/status": "ready",
    };

    render(<TaskWorkspacePage data={fixture.pageData} />);

    expect(screen.getByText("header-status:Ready")).toBeInTheDocument();
    expect(screen.getByText("workspace-status:waiting")).toBeInTheDocument();
    expect(screen.getByText("primary-action:Start")).toBeInTheDocument();
  });

  it("does not expose Stop as the header primary action for blocked failed executions", () => {
    const fixture = createTaskWorkspaceUiFixture("failed");
    mocks.plan = { id: "plan-failed", status: "accepted" };
    mocks.graphPlan = fixture.graphPlan;
    mocks.executionState = {
      "/execution/can-start": false,
      "/execution/can-pause": false,
      "/execution/can-stop": false,
      "/execution/show-accept-plan": false,
      "/execution/show-generate-plan": false,
      "/execution/start-disabled": false,
      "/execution/start-disabled-reason": null,
      "/execution/status": "failed",
    };

    render(<TaskWorkspacePage data={fixture.pageData} />);

    expect(screen.getByText("primary-action:none")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("keeps long mobile fixture content visible without dropping workspace regions", () => {
    const fixture = taskWorkspaceStateFixtures.longContentMobile;
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = fixture.graphPlan;

    render(<TaskWorkspacePage data={fixture.pageData} />);

    expect(screen.getByText(fixture.pageData.task.title)).toBeInTheDocument();
    expect(screen.getByText("workspace-treatment:Review required")).toBeInTheDocument();
    expect(screen.getAllByText(/Confirm evidence and provide launch approval notes/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Execution flow")).toBeInTheDocument();
    expect(screen.getByLabelText("Current node details")).toBeInTheDocument();
    expect(screen.getByLabelText("Execution overview")).toBeInTheDocument();
  });

  it("updates node detail context when a different plan node is selected", () => {
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = {
      ...taskWorkspaceStateFixtures.running.graphPlan,
      nodes: [
        ...taskWorkspaceStateFixtures.running.graphPlan.nodes,
        {
          id: "approve",
          title: "Approve output",
          objective: "Review generated output",
          phase: "Review",
          status: "waiting_for_user",
          nextAction: "Approve or request changes",
          requiresHumanInput: true,
          availableActions: [],
        },
      ],
      steps: [
        ...taskWorkspaceStateFixtures.running.graphPlan.steps,
        {
          id: "approve",
          title: "Approve output",
          objective: "Review generated output",
          phase: "Review",
          status: "waiting_for_user",
          nextAction: "Approve or request changes",
          requiresHumanInput: true,
          availableActions: [],
        },
      ],
    };

    render(<TaskWorkspacePage data={taskWorkspaceStateFixtures.running.pageData} />);

    expect(screen.getByText("detail-title:execute")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Approve output" }));

    expect(screen.getByText("detail-title:Approve output")).toBeInTheDocument();
    expect(screen.getByText("detail-status:input-needed")).toBeInTheDocument();
    expect(screen.getByText("detail-step:3/3")).toBeInTheDocument();
    expect(screen.getByText("detail-refresh:on")).toBeInTheDocument();
    expect(screen.getByText("detail-disabled:No actions are available for this node.")).toBeInTheDocument();
  });

  it("keeps flow, node detail, and overview regions reachable in the workspace page", () => {
    mocks.plan = { id: "plan-1", status: "accepted" };
    mocks.graphPlan = taskWorkspaceStateFixtures.running.graphPlan;

    render(<TaskWorkspacePage data={taskWorkspaceStateFixtures.running.pageData} />);

    expect(screen.getByLabelText("Execution flow")).toBeInTheDocument();
    expect(screen.getByLabelText("Current node details")).toBeInTheDocument();
    expect(screen.getByLabelText("Execution overview")).toBeInTheDocument();
  });

  it("renders fixture-backed loading, planning, execution, blocked, failed, completed, and retry states", () => {
    const states = [
      "loading",
      "empty",
      "planning",
      "executing",
      "blocked",
      "failed",
      "completed",
      "retry",
    ] as const;

    for (const state of states) {
      const fixture = createTaskWorkspaceUiFixture(state);
      mocks.planGenerationStatus = state === "loading" || state === "planning" ? "generating" : "accepted";
      mocks.plan = { id: `plan-${state}`, status: state === "loading" || state === "planning" ? "draft" : "accepted" };
      mocks.graphPlan = fixture.graphPlan;

      render(<TaskWorkspacePage data={fixture.pageData} />);

      expect(screen.getByText(`task:${fixture.pageData.task.title}`)).toBeInTheDocument();
      expect(screen.getByText("nodes:1")).toBeInTheDocument();
      expect(screen.getByText(`detail-title:${fixture.graphPlan.nodes[0]?.title ?? "No node selected"}`)).toBeInTheDocument();
      expect(screen.getByLabelText("Execution flow")).toBeInTheDocument();
      expect(screen.getByLabelText("Current node details")).toBeInTheDocument();
      expect(screen.getByLabelText("Execution overview")).toBeInTheDocument();

      cleanup();
      mocks.editorTask = null;
      mocks.plan = null;
      mocks.graphPlan = null;
      mocks.planGenerationStatus = "idle";
      mocks.canAcceptPlan = false;
    }
  });
});
