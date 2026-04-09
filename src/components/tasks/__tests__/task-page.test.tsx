import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskPage } from "@/components/tasks/task-page";

describe("TaskPage", () => {
  it("shows planning controls plus entry points into the work surface", () => {
    render(
      <TaskPage
        data={{
          task: {
            id: "task_1",
            workspaceId: "ws_1",
            title: "Write projection",
            description: "Plan the read model",
            status: "Blocked",
            priority: "High",
            dueAt: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
            scheduleStatus: "Unscheduled",
            scheduleSource: null,
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

    expect(screen.getByRole("button", { name: "Start Run" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Work Page" })).toHaveAttribute(
      "href",
      "/workspaces/ws_1/work/task_1",
    );
    expect(screen.getByRole("link", { name: "Open Schedule" })).toHaveAttribute(
      "href",
      "/schedule",
    );
    expect(screen.getByText("Block Reason")).toBeInTheDocument();
    expect(screen.getByText("Pending Schedule Proposals")).toBeInTheDocument();
    expect(screen.getByText("Schedule this tomorrow morning")).toBeInTheDocument();
  });
});
