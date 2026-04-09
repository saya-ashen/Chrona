import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceOverview } from "@/components/workspaces/workspace-overview";

describe("WorkspaceOverview", () => {
  it("shows the triage sections required by the spec", () => {
    render(
      <WorkspaceOverview
        data={{
          running: [],
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
  });
});
