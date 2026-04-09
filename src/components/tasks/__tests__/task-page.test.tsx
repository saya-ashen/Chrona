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
            blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
            dependencies: [],
          },
          latestRunSummary: {
            id: "run_1",
            status: "WaitingForApproval",
            startedAt: new Date().toISOString(),
            syncStatus: "healthy",
          },
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
    expect(screen.getByText("Block Reason")).toBeInTheDocument();
  });
});
