import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchedulePage } from "@/components/schedule/schedule-page";

describe("SchedulePage", () => {
  it("renders the schedule planning sections for blocks, queue, proposals, and risks", () => {
    render(
        <SchedulePage
          selectedDay="2026-04-16"
          selectedTaskId="task_scheduled"
          data={{
            summary: {
              scheduledCount: 1,
            unscheduledCount: 1,
            proposalCount: 1,
            riskCount: 1,
          },
          scheduled: [
            {
              taskId: "task_scheduled",
              workspaceId: "ws_1",
              title: "Ship projection cleanup",
              priority: "High",
              ownerType: "human",
              assigneeAgentId: null,
              persistedStatus: "Ready",
              actionRequired: null,
              approvalPendingCount: 0,
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
              priority: "Medium",
              ownerType: "human",
              assigneeAgentId: null,
              persistedStatus: "Ready",
              actionRequired: "Schedule task",
              approvalPendingCount: 0,
              dueAt: null,
              latestRunStatus: null,
              scheduleProposalCount: 1,
            },
          ],
          proposals: [
            {
              proposalId: "proposal_1",
              taskId: "task_unscheduled",
              workspaceId: "ws_1",
              title: "Queue follow-up docs",
              priority: "Medium",
              ownerType: "human",
              assigneeAgentId: null,
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
              priority: "Urgent",
              ownerType: "human",
              assigneeAgentId: null,
              persistedStatus: "Blocked",
              scheduleStatus: "Overdue",
              actionRequired: "Reschedule task",
              approvalPendingCount: 0,
              latestRunStatus: null,
              dueAt: new Date("2026-04-15T18:00:00.000Z"),
              scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
              scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scheduled Timeline" })).toBeInTheDocument();
    expect(screen.getByText("Week Overview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unscheduled Queue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI Proposals" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conflicts / Overdue Risks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Planning Guide" })).toBeInTheDocument();
    expect(screen.getByText("Committed blocks on the current plan.")).toBeInTheDocument();
    expect(screen.getAllByText("Ship projection cleanup")).toHaveLength(2);
    expect(screen.getByText("Full-day timeline · scroll inside")).toBeInTheDocument();
    expect(screen.getByText(/quiet hours compressed/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Task Details" })).toBeInTheDocument();
    expect(screen.getAllByText("Queue follow-up docs")).toHaveLength(2);
    expect(screen.getByText("Recover overdue adapter run")).toBeInTheDocument();
    expect(screen.getByText("Default workspace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute("href", "/schedule?day=2026-04-16");
    expect(
      screen
        .getAllByRole("link", { name: "Open Work" })
        .some((link) => link.getAttribute("href") === "/workspaces/ws_1/work/task_scheduled"),
    ).toBe(true);
  });
});
