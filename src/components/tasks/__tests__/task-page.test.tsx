import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskPage } from "@/components/tasks/task-page";

describe("TaskPage", () => {
  it("behaves like a secondary detail surface with links back to Schedule and Work", () => {
    render(
      <TaskPage
        data={{
          task: {
            id: "task_1",
            workspaceId: "ws_1",
            title: "Write projection",
            description: "Plan the read model",
            runtimeModel: "gpt-5.4",
            runtimeConfig: { temperature: 0.2 },
            prompt: null,
            status: "Blocked",
            priority: "High",
            dueAt: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
            scheduleStatus: "Unscheduled",
            scheduleSource: null,
            isRunnable: false,
            runnabilitySummary: "Needs prompt",
            blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
            dependencies: [],
          },
          latestRunSummary: {
            id: "run_1",
            status: "WaitingForApproval",
            startedAt: new Date().toISOString(),
            syncStatus: "healthy",
          },
          scheduleProposals: [
            {
              id: "proposal_1",
              source: "ai",
              proposedBy: "planner-agent",
              summary: "Schedule this tomorrow morning",
              status: "Pending",
              dueAt: null,
              scheduledStartAt: null,
              scheduledEndAt: null,
            },
          ],
          approvals: [],
          artifacts: [],
        }}
      />,
    );

    expect(screen.getByText("Secondary task detail")).toBeInTheDocument();
    expect(screen.getByText("Use the primary surfaces")).toBeInTheDocument();
    expect(screen.getByText("Runtime configuration")).toBeInTheDocument();
    expect(screen.getByText("Planning context")).toBeInTheDocument();
    expect(screen.getAllByText("Needs prompt").length).toBeGreaterThan(0);
    expect(screen.getByText("No prompt saved yet. Configure one in Schedule before execution.")).toBeInTheDocument();
    expect(screen.getByText(/temperature/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Schedule" })).toHaveAttribute("href", "/en/schedule");
    expect(screen.getByRole("link", { name: "Open Workbench" })).toHaveAttribute(
      "href",
      "/en/workspaces/ws_1/work/task_1",
    );
    expect(screen.getByText("Pending Schedule Proposals")).toBeInTheDocument();
    expect(screen.getByText("Schedule this tomorrow morning")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Task Details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Proposal" })).not.toBeInTheDocument();
  });
});
