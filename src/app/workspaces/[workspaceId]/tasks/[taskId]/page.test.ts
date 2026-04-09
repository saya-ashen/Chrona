import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/modules/queries/get-task-page", () => ({
  getTaskPage: vi.fn(),
}));

import { notFound } from "next/navigation";
import TaskDetailPage from "@/app/workspaces/[workspaceId]/tasks/[taskId]/page";
import { getTaskPage } from "@/modules/queries/get-task-page";

describe("TaskDetailPage", () => {
  it("rejects routes whose workspace id does not match the task workspace", async () => {
    vi.mocked(getTaskPage).mockResolvedValue({
      task: {
        id: "task_1",
        workspaceId: "ws_real",
        title: "Write projection",
        description: null,
        status: "Blocked",
        priority: "High",
        dueAt: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        blockReason: null,
        dependencies: [],
      },
      latestRunSummary: null,
      approvals: [],
      artifacts: [],
    });

    await expect(
      TaskDetailPage({
        params: Promise.resolve({ workspaceId: "ws_wrong", taskId: "task_1" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(vi.mocked(notFound)).toHaveBeenCalled();
  });
});
