import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { GoalListPage } from "./goal-list-page";
import { GoalWorkspacePage } from "./goal-workspace-page";
import { CreateGoalFromResultDialog } from "./create-goal-from-result-dialog";
import type { GoalArtifactData, GoalCopy, GoalData } from "../model/goal-types";

const { promoteTaskToGoalMock } = vi.hoisted(() => ({
  promoteTaskToGoalMock: vi.fn(async () => ({ id: "goal-promoted" })),
}));
vi.mock("../browser-api", () => ({
  runGoalAction: vi.fn(async () => ({})),
  createGoalTask: vi.fn(async () => ({ taskId: "task-created", goal: {} })),
  promoteTaskToGoal: promoteTaskToGoalMock,
  updateGoalBrief: vi.fn(async () => ({})),
  updateGoalWorkingSet: vi.fn(async () => ({})),
}));
vi.mock("@chrona/i18n/react", () => ({ useLocale: () => "en" }));

const copy: GoalCopy = {
  title: "Goals",
  subtitle: "Durable outcomes",
  emptyTitle: "No goals",
  emptyDescription: "Create one",
  openGoal: "Open Goal",
  backToGoals: "All Goals",
  ongoingWorkspace: "Ongoing Workspace",
  outcomeArchive: "Outcome Archive",
  archiveDescription: "Retained outcome record",
  workspaceDescription: "Bounded ongoing work",
  controlPlane: "Goal Control Plane",
  workbench: "Goal Workbench",
  operationalBrief: "Operational brief",
  outcomeLabel: "Intended outcome",
  currentFocus: "Current focus",
  strategy: "Current strategy",
  constraints: "Constraints",
  editBrief: "Edit brief",
  saveBrief: "Save brief",
  saving: "Saving",
  workingSet: "Working set",
  workingSetDescription: "Explicit task context",
  editWorkingSet: "Choose context",
  saveWorkingSet: "Save working set",
  noWorkingSet: "No context selected",
  focusQueue: "Focus queue",
  needsYou: "Needs you",
  inProgress: "In progress",
  newResults: "New results",
  upNext: "Up next",
  composer: "Compose bounded work",
  expectedOutcome: "Expected outcome",
  expectedOutcomePlaceholder: "Observable result",
  selectedContext: "Selected context",
  actionPreview: "Action preview",
  createBoundedTaskPreview: "Create one bounded task with frozen context.",
  taskInspector: "Task inspector",
  returnToGoal: "Return to Goal",
  overview: "Overview",
  tasksSection: "Tasks",
  resultsAssets: "Results & Assets",
  history: "Activity",
  outcome: "Outcome",
  primaryResult: "Final outcome",
  noPrimaryResult: "No final result",
  successCriteria: "Success criteria",
  progress: "Progress",
  boundedTasks: "Bounded tasks",
  acceptedResults: "Accepted results",
  assets: "Goal assets",
  nextReview: "Next review",
  noReview: "No review",
  noTasks: "No tasks",
  noAssets: "No assets",
  noAcceptedResults: "No accepted results",
  sourceEvidence: "Source evidence",
  currentVersion: "Current version",
  provenance: "Provenance",
  provenanceUnchanged: "Original accepted artifact",
  sourceTask: "Source task",
  role: "Role",
  assetStatus: "Asset status",
  pause: "Pause Goal",
  resume: "Resume Goal",
  stop: "Stop pursuing",
  achieve: "Confirm achieved",
  startReview: "Start Goal review",
  addTask: "Add task",
  reviewTaskTitle: "Review Goal progress",
  reviewTaskDescription: "Review evidence and next actions",
  addTaskTitle: "Add bounded task",
  taskTitleLabel: "Task title",
  taskDescriptionLabel: "Task instructions",
  taskTitlePlaceholder: "Bounded work",
  taskDescriptionPlaceholder: "Context and outcome",
  createTask: "Create task",
  creatingTask: "Creating task",
  confirmAchievement: "Confirm achieved?",
  confirmAchievementDescription: "Task completion is not enough",
  confirmationLabel: "Confirmation",
  confirmationPlaceholder: "Evidence",
  evidenceLabel: "Evidence used for confirmation",
  evidenceDescription: "Select retained evidence",
  evidenceRequired: "Select evidence",
  confirmedBy: "Confirmed by",
  confirmationNote: "Achievement confirmation",
  cancel: "Cancel",
  confirming: "Confirming…",
  actionError: "Action failed",
  status: { Draft: "Draft", Active: "Active", Paused: "Paused", Achieved: "Achieved", Stopped: "Stopped" },
  activity: { idle: "Idle", work_active: "Work active", review_due: "Review due" },
  attention: { none: "No attention", needs_input: "Needs input", blocked: "Blocked", failed: "Failed" },
  nextAction: { none: "No action", review: "Review", resolve_attention: "Resolve", resume: "Resume", confirm_outcome: "Confirm outcome" },
  taskGroups: { attention: "Needs attention", active: "Active", planned: "Planned", completed: "Completed" },
  taskStatus: { Completed: "Completed", Ready: "Ready" },
  assetRoles: { Evidence: "Evidence", PrimaryOutcome: "Primary outcome" },
  assetStatuses: { Approved: "Approved" },
  criteriaProgress: "{completed} of {total} confirmed",
  taskProgress: "{completed} of {total} tasks completed",
  achievedAt: "Achieved",
  acceptedAt: "Accepted",
  immutableResult: "Immutable accepted result",
  openTask: "Open task",
  open: "Open",
  copy: "Copy",
  copied: "Copied",
  download: "Download",
  showDetails: "Details",
  hideDetails: "Collapse",
  createFromResult: "Create Goal and continue",
  createFromResultTitle: "Continue as Goal",
  createFromResultDescription: "Preview promotion",
  goalTitleLabel: "Goal title",
  goalDescriptionLabel: "Description",
  goalDescriptionPlaceholder: "Describe outcome",
  criterionLabel: "Success criterion",
  criterionPlaceholder: "Confirm outcome",
  selectedAssets: "Selected assets",
  selectedAssetsRequired: "Select an asset",
  proposedFollowUp: "Proposed follow-up",
  proposedFollowUpDescription: "Create bounded work",
  createAndContinue: "Create Goal and continue",
  creatingGoal: "Creating",
  promotionError: "Promotion failed",
};

const artifact: GoalArtifactData = {
  id: "artifact-1",
  taskId: "task-1",
  title: "Final result",
  type: "summary",
  uri: "chrona://result",
  contentPreview: "Final immutable outcome",
  createdAt: "2026-07-01T00:00:00.000Z",
  operations: { canOpen: true, canCopy: true, canDownload: false, downloadHref: null },
};

const baseGoal: GoalData = {
  id: "goal-1",
  workspaceId: "ws-1",
  title: "Reach durable outcome",
  description: "Across bounded tasks",
  status: "Active",
  mode: "workspace",
  nextReviewAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  achievedAt: null,
  stoppedAt: null,
  successCriteria: [{ id: "criterion", kind: "user_confirmed", description: "User confirms outcome", satisfied: false, confirmedAt: null }],
  projection: { lifecycle: "Active", activity: "idle", attention: "none", nextAction: "confirm_outcome", completedTaskCount: 0, totalTaskCount: 0, criteriaSatisfiedCount: 0, criteriaTotalCount: 1 },
  primaryAction: { kind: "confirm_outcome", taskId: null },
  outcome: {
    primaryResult: null,
    confirmation: null,
    criteria: [{ id: "criterion", kind: "user_confirmed", description: "User confirms outcome", satisfied: false, confirmedAt: null, evidenceArtifactIds: [] }],
  },
  taskGroups: { attention: [], active: [], planned: [], completed: [] },
  tasks: [],
  acceptedResults: [],
  workbench: {
    brief: {
      outcome: "Reach durable outcome",
      currentFocus: "Confirm next bounded step",
      strategy: "Use accepted evidence",
      constraints: ["Retain provenance"],
    },
    briefRevisionCount: 1,
    workingSet: [],
    focus: { needsYou: [], inProgress: [], newResults: [], upNext: [] },
  },
  assets: [{
    id: "asset-1",
    label: "Outcome evidence",
    role: "Evidence",
    status: "Approved",
    createdAt: artifact.createdAt,
    updatedAt: artifact.createdAt,
    sourceArtifact: artifact,
    currentArtifact: artifact,
    provenance: { sourceTaskId: "task-1", sourceRunId: "run-1", sourceArtifactId: artifact.id, currentArtifactId: artifact.id, unchanged: true },
  }],
  activity: [],
};

function renderInRouter(node: React.ReactNode) {
  const router = createMemoryRouter([{ path: "*", element: node }], { initialEntries: ["/en/goals"] });
  return { ...render(<RouterProvider router={router} />), router };
}

describe("Goal pages", () => {
  it("shows the empty list state", () => {
    renderInRouter(<GoalListPage goals={[]} copy={copy} />);
    expect(screen.getByText("No goals")).toBeInTheDocument();
  });

  it("shows lifecycle, attention, and one primary next action", () => {
    const goal: GoalData = {
      ...baseGoal,
      projection: { ...baseGoal.projection, activity: "review_due", attention: "needs_input", nextAction: "resolve_attention" },
    };
    renderInRouter(<GoalListPage goals={[goal]} copy={copy} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Needs input")).toBeInTheDocument();
    expect(screen.getByText("Resolve")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Goal/ })).toHaveAttribute("href", "/en/goals/goal-1");
  });

  it("puts the final outcome before archive details and exposes provenance", () => {
    const acceptedResult = { runId: "run-1", acceptedAt: artifact.createdAt, completedAt: artifact.createdAt, summary: "Accepted result summary", artifacts: [artifact] };
    const completedTask = { id: "task-1", title: "Bounded step", description: null, status: "Completed", priority: "High", kind: "single", dueAt: null, updatedAt: artifact.createdAt, attention: null, group: "completed" as const, acceptedResult };
    const goal: GoalData = {
      ...baseGoal,
      status: "Achieved",
      mode: "archive",
      achievedAt: artifact.createdAt,
      projection: { ...baseGoal.projection, lifecycle: "Achieved", nextAction: "none", completedTaskCount: 1, totalTaskCount: 1, criteriaSatisfiedCount: 1 },
      primaryAction: { kind: "none", taskId: null },
      outcome: { primaryResult: artifact, confirmation: { note: "Offer accepted", actorType: "user", actorId: "acceptance-user", confirmedAt: artifact.createdAt, evidenceArtifactIds: [artifact.id] }, criteria: [{ ...baseGoal.outcome.criteria[0], satisfied: true, confirmedAt: artifact.createdAt, evidenceArtifactIds: [artifact.id] }] },
      tasks: [completedTask],
      taskGroups: { attention: [], active: [], planned: [], completed: [completedTask] },
      acceptedResults: [{ ...acceptedResult, taskId: completedTask.id, taskTitle: completedTask.title }],
    };
    const router = createMemoryRouter([{ path: "*", element: <GoalWorkspacePage goal={goal} copy={copy} /> }], { initialEntries: ["/en/goals/goal-1?section=results"] });
    render(<RouterProvider router={router} />);
    expect(screen.getAllByText("Final immutable outcome").length).toBeGreaterThan(0);
    expect(screen.getByText("Offer accepted")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Results & Assets" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Outcome evidence")).toBeInTheDocument();
    expect(screen.getByText(/Original accepted artifact/)).toBeInTheDocument();
  });

  it("shows the active Goal control plane, workbench, and frozen-context composer", () => {
    const goal: GoalData = {
      ...baseGoal,
      primaryAction: { kind: "none", taskId: null },
      taskGroups: { ...baseGoal.taskGroups, attention: [{
        id: "attention-1",
        title: "Approve research statement",
        description: "Review before submission",
        status: "WaitingForApproval",
        priority: "Urgent",
        kind: "single",
        dueAt: null,
        updatedAt: artifact.createdAt,
        attention: "approval_required",
        group: "attention",
        acceptedResult: null,
      }] },
      tasks: [],
      workbench: {
        ...baseGoal.workbench,
        workingSet: [{
          id: "ws-1",
          subjectType: "criterion",
          subjectId: "criterion-1",
          label: "Approved application package",
          snapshot: { satisfied: false },
          rank: 0,
          createdAt: artifact.createdAt,
          updatedAt: artifact.createdAt,
        }],
      },
    };
    renderInRouter(<GoalWorkspacePage goal={goal} copy={copy} />);
    expect(screen.getByText("Goal Control Plane")).toBeInTheDocument();
    expect(screen.getByText("Confirm next bounded step")).toBeInTheDocument();
    expect(screen.getByText("Approved application package")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(screen.getByText("Action preview")).toBeInTheDocument();
    expect(screen.getByText("Selected context")).toBeInTheDocument();
  });

  it("requires confirmation and retained evidence before achievement", () => {
    renderInRouter(<GoalWorkspacePage goal={baseGoal} copy={copy} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Confirm achieved" })[0]);
    const confirmation = screen.getByRole("textbox", { name: "Confirmation" });
    const submit = screen.getAllByRole("button", { name: "Confirm achieved" }).at(-1)!;
    fireEvent.change(confirmation, { target: { value: "Outcome evidence confirmed" } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Final result/ }));
    expect(submit).toBeEnabled();
  });

  it("shows paused state with a reversible primary action", () => {
    const goal: GoalData = {
      ...baseGoal,
      status: "Paused",
      projection: { ...baseGoal.projection, lifecycle: "Paused", nextAction: "resume" },
      primaryAction: { kind: "resume", taskId: null },
    };
    renderInRouter(<GoalWorkspacePage goal={goal} copy={copy} />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume Goal" })).toBeInTheDocument();
  });

  it("previews selected accepted assets and opens the promoted Goal", async () => {
    const { router } = renderInRouter(
      <CreateGoalFromResultDialog
        taskId="task-1"
        workspaceId="ws-1"
        acceptedRunId="run-1"
        taskTitle="Accepted task"
        taskDescription="Accepted result description"
        artifacts={[{ id: "artifact-1", title: "Final result", type: "markdown" }]}
        copy={copy}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Goal and continue" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("Accepted task")).toBeInTheDocument();
    expect(within(dialog).getByText("Final result")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Success criterion" }), { target: { value: "User confirms the durable outcome" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Goal and continue" }));
    await waitFor(() => expect(promoteTaskToGoalMock).toHaveBeenCalledWith("task-1", expect.objectContaining({ workspaceId: "ws-1", acceptedRunId: "run-1", artifactIds: ["artifact-1"], title: "Accepted task" })));
    await waitFor(() => expect(router.state.location.pathname).toBe("/en/goals/goal-promoted"));
  });
});
