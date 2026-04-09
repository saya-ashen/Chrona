import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchedulePage } from "@/components/schedule/schedule-page";

describe("SchedulePage", () => {
  it("renders the schedule planning sections for blocks, queue, proposals, and risks", () => {
    render(
      <SchedulePage
        data={{
          scheduled: [
            {
              taskId: "task_scheduled",
              workspaceId: "ws_1",
              title: "Ship projection cleanup",
              scheduleStatus: "Scheduled",
              scheduleSource: "human",
              dueAt: new Date("2026-04-16T18:00:00.000Z"),
              scheduledStartAt: new Date("2026-04-16T09:00:00.000Z"),
              scheduledEndAt: new Date("2026-04-16T11:00:00.000Z"),
              latestRunStatus: null,
            },
          ],
          unscheduled: [
            {
              taskId: "task_unscheduled",
              workspaceId: "ws_1",
              title: "Queue follow-up docs",
              persistedStatus: "Ready",
              actionRequired: "Schedule task",
              scheduleProposalCount: 1,
            },
          ],
          proposals: [
            {
              proposalId: "proposal_1",
              taskId: "task_unscheduled",
              workspaceId: "ws_1",
              title: "Queue follow-up docs",
              source: "ai",
              proposedBy: "planner-agent",
              summary: "Plan this for tomorrow morning",
              dueAt: new Date("2026-04-17T18:00:00.000Z"),
              scheduledStartAt: new Date("2026-04-17T09:00:00.000Z"),
              scheduledEndAt: new Date("2026-04-17T10:30:00.000Z"),
            },
          ],
          risks: [
            {
              taskId: "task_risk",
              workspaceId: "ws_1",
              title: "Recover overdue adapter run",
              persistedStatus: "Blocked",
              scheduleStatus: "Overdue",
              actionRequired: "Reschedule task",
              dueAt: new Date("2026-04-15T18:00:00.000Z"),
              scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Scheduled Blocks")).toBeInTheDocument();
    expect(screen.getByText("Unscheduled Queue")).toBeInTheDocument();
    expect(screen.getByText("AI Proposals")).toBeInTheDocument();
    expect(screen.getByText("Conflicts / Overdue Risks")).toBeInTheDocument();
    expect(screen.getByText("Ship projection cleanup")).toBeInTheDocument();
    expect(screen.getAllByText("Queue follow-up docs")).toHaveLength(2);
    expect(screen.getByText("Recover overdue adapter run")).toBeInTheDocument();
  });
});
