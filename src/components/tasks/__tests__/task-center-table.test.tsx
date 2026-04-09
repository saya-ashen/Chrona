import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskCenterTable } from "@/components/tasks/task-center-table";

describe("TaskCenterTable", () => {
  it("offers direct entry into the work page without forcing task-page navigation first", () => {
    render(
      <TaskCenterTable
        rows={[
          {
            taskId: "task_1",
            title: "Write projection",
            persistedStatus: "Running",
            displayState: "Running",
            latestRunStatus: "Running",
            actionRequired: "Observe timeline",
            scheduleStatus: "InProgress",
            dueAt: new Date("2026-04-20T18:00:00.000Z"),
            updatedAt: new Date("2026-04-20T10:00:00.000Z"),
            workspaceId: "ws_1",
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Open Work" })).toHaveAttribute(
      "href",
      "/workspaces/ws_1/work/task_1",
    );
    expect(screen.getByRole("link", { name: "Open Task" })).toHaveAttribute(
      "href",
      "/workspaces/ws_1/tasks/task_1",
    );
    expect(
      screen.getByText("Open task for planning details, or jump straight into work."),
    ).toBeInTheDocument();
  });
});
