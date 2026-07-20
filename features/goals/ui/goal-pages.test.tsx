import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { GoalListPage } from "./goal-list-page";
import { GoalWorkspacePage } from "./goal-workspace-page";
import { CreateGoalFromResultDialog } from "./create-goal-from-result-dialog";
import type { GoalCopy, GoalData } from "../model/goal-types";

const { promoteTaskToGoalMock } = vi.hoisted(() => ({
  promoteTaskToGoalMock: vi.fn(async () => ({ id: "goal-promoted" })),
}));
vi.mock("../browser-api", () => ({
  runGoalAction: vi.fn(async () => ({})),
  promoteTaskToGoal: promoteTaskToGoalMock,
}));
vi.mock("@chrona/i18n/react", () => ({ useLocale: () => "en" }));

const copy: GoalCopy = {
  title: "Goals", subtitle: "Durable outcomes", emptyTitle: "No goals", emptyDescription: "Create one", openGoal: "Open Goal", backToGoals: "All Goals", outcome: "Outcome", successCriteria: "Success criteria", progress: "Progress", boundedTasks: "Bounded tasks", acceptedResults: "Accepted results", assets: "Goal assets", nextReview: "Next review", noReview: "No review", noTasks: "No tasks", noAssets: "No assets", sourceEvidence: "Source evidence", currentVersion: "Current version", pause: "Pause Goal", resume: "Resume Goal", stop: "Stop pursuing", achieve: "Confirm achieved", confirmAchievement: "Confirm achieved?", confirmAchievementDescription: "Task completion is not enough", confirmationLabel: "Confirmation", confirmationPlaceholder: "Evidence", cancel: "Cancel", confirming: "Confirming", actionError: "Failed", status: { Draft: "Draft", Active: "Active", Paused: "Paused", Achieved: "Achieved", Stopped: "Stopped" }, activity: { idle: "Idle", work_active: "Work active", review_due: "Review due" }, attention: { none: "None", needs_input: "Needs input", blocked: "Blocked", failed: "Failed" }, nextAction: { none: "No action", review: "Review", resolve_attention: "Resolve", resume: "Resume", confirm_outcome: "Confirm outcome" }, criteriaProgress: "{completed}/{total}", taskProgress: "{completed}/{total}", achievedAt: "Achieved", immutableResult: "Immutable accepted result", openTask: "Open task",
  createFromResult: "Create Goal and continue", createFromResultTitle: "Continue as Goal", createFromResultDescription: "Preview promotion", goalTitleLabel: "Goal title", goalDescriptionLabel: "Description", goalDescriptionPlaceholder: "Describe outcome", criterionLabel: "Success criterion", criterionPlaceholder: "Confirm outcome", selectedAssets: "Selected assets", selectedAssetsRequired: "Select an asset", proposedFollowUp: "Proposed follow-up", proposedFollowUpDescription: "Create bounded work", createAndContinue: "Create Goal and continue", creatingGoal: "Creating", promotionError: "Promotion failed",
};

const baseGoal: GoalData = {
  id: "goal-1", workspaceId: "ws-1", title: "Reach durable outcome", description: "Across bounded tasks", status: "Active", nextReviewAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", achievedAt: null, stoppedAt: null,
  successCriteria: [{ id: "criterion", kind: "user_confirmed", description: "User confirms outcome", satisfied: false, confirmedAt: null }],
  projection: { lifecycle: "Active", activity: "idle", attention: "none", nextAction: "none", completedTaskCount: 0, totalTaskCount: 0, criteriaSatisfiedCount: 0, criteriaTotalCount: 1 },
  tasks: [], assets: [],
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
    const goal = { ...baseGoal, projection: { ...baseGoal.projection, activity: "review_due" as const, attention: "needs_input" as const, nextAction: "resolve_attention" as const } };
    renderInRouter(<GoalListPage goals={[goal]} copy={copy} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Needs input")).toBeInTheDocument();
    expect(screen.getByText("Resolve")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Goal/ })).toHaveAttribute("href", "/en/goals/goal-1");
  });

  it("shows accepted result provenance and linked task", () => {
    const artifact = { id: "artifact-1", title: "Final result", type: "summary", uri: "chrona://result", contentPreview: "Final immutable outcome", createdAt: "2026-07-01T00:00:00.000Z" };
    const goal = { ...baseGoal, tasks: [{ id: "task-1", title: "Bounded step", description: null, status: "Completed", priority: "High", kind: "single", dueAt: null, updatedAt: "2026-07-01T00:00:00.000Z", attention: null, latestAcceptedResult: { runId: "run-1", completedAt: "2026-07-01T00:00:00.000Z", artifacts: [artifact] } }], assets: [{ id: "asset-1", label: "Outcome evidence", role: "evidence", status: "Approved", createdAt: artifact.createdAt, updatedAt: artifact.createdAt, sourceArtifact: artifact, currentArtifact: artifact }] };
    renderInRouter(<GoalWorkspacePage goal={goal} copy={copy} />);
    expect(screen.getByText("Final immutable outcome")).toBeInTheDocument();
    expect(screen.getByText("Source evidence: Final result")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open task/ })).toHaveAttribute("href", "/en/tasks/task-1");
  });

  it("requires explicit confirmation before achievement", async () => {
    renderInRouter(<GoalWorkspacePage goal={baseGoal} copy={copy} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Confirm achieved" })[0]);
    const confirmation = screen.getByRole("textbox", { name: "Confirmation" });
    const submit = screen.getAllByRole("button", { name: "Confirm achieved" }).at(-1)!;
    expect(submit).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "Outcome evidence confirmed" } });
    expect(submit).toBeEnabled();
  });

  it("shows paused state with a reversible primary action", () => {
    const goal = { ...baseGoal, status: "Paused" as const, projection: { ...baseGoal.projection, lifecycle: "Paused" as const, nextAction: "resume" as const } };
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
    expect(within(dialog).getByText("Proposed follow-up")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Success criterion" }), {
      target: { value: "User confirms the durable outcome" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Goal and continue" }));

    await waitFor(() => expect(promoteTaskToGoalMock).toHaveBeenCalledWith("task-1", expect.objectContaining({
      workspaceId: "ws-1",
      acceptedRunId: "run-1",
      artifactIds: ["artifact-1"],
      title: "Accepted task",
    })));
    await waitFor(() => expect(router.state.location.pathname).toBe("/en/goals/goal-promoted"));
  });
});
