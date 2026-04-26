import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceOverview } from "@/components/workspaces/workspace-overview";

describe("WorkspaceOverview", () => {
  it("shows the triage sections required by the spec", () => {
    render(
      <WorkspaceOverview
        data={{
          running: [
            {
              taskId: "task_1",
              workspaceId: "ws_1",
              title: "Ship workspace nav",
              latestRunStatus: "Running",
            },
          ],
          waitingForApproval: [],
          blockedOrFailed: [],
          scheduleRisks: [],
          upcomingDeadlines: [],
          recentlyUpdated: [],
        }}
      />,
    );

    expect(screen.getByText("Running Tasks")).toBeInTheDocument();
    expect(screen.getByText("Waiting for Approval")).toBeInTheDocument();
    expect(screen.getByText("Blocked / Failed Tasks")).toBeInTheDocument();
    expect(screen.getByText("Schedule Risks")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Deadlines")).toBeInTheDocument();
    expect(screen.getByText("Recently Updated Tasks")).toBeInTheDocument();
    expect(screen.getByText("Ship workspace nav")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Task" })).toHaveAttribute(
      "href",
      "/en/workspaces/ws_1/tasks/task_1",
    );
    expect(screen.getByRole("link", { name: "Open Workbench" })).toHaveAttribute(
      "href",
      "/en/workspaces/ws_1/work/task_1",
    );
  });
});
