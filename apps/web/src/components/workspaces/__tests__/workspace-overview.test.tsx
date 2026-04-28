import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "components.workspaceOverview.runningTasks": "Running Tasks",
        "components.workspaceOverview.waitingForApproval": "Waiting for Approval",
        "components.workspaceOverview.blockedOrFailed": "Blocked / Failed Tasks",
        "components.workspaceOverview.scheduleRisks": "Schedule Risks",
        "components.workspaceOverview.upcomingDeadlines": "Upcoming Deadlines",
        "components.workspaceOverview.recentlyUpdated": "Recently Updated Tasks",
        "components.workspaceOverview.sectionDescription": "Overview section",
        "components.workspaceOverview.noItems": "No items",
        "components.workspaceOverview.noRunYet": "No run yet",
        "components.workspaceOverview.openTask": "Open task",
        "components.workspaceOverview.noActivityYet": "No activity yet",
        "common.openTask": "Open Task",
        "common.openWorkbench": "Open Workbench",
        "common.startWork": "Start Work",
      };
      return map[key] ?? key;
    },
  }),
}));

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
