import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/modules/queries/get-task-page", () => ({
  getTaskPage: vi.fn(),
}));

vi.mock("@/i18n/get-dictionary", () => ({
  getDictionary: vi.fn().mockResolvedValue({
    components: {
      taskPage: {},
    },
  }),
}));

import { redirect } from "next/navigation";
import TaskDetailPage from "@/app/workspaces/[workspaceId]/tasks/[taskId]/page";
import { getTaskPage } from "@/modules/queries/get-task-page";

describe("TaskDetailPage", () => {
  it("redirects routes whose workspace id does not match the task workspace", async () => {
    vi.mocked(getTaskPage).mockResolvedValue({
      task: {
        id: "task_1",
        workspaceId: "ws_real",
        title: "Write projection",
        description: null,
        runtimeModel: "gpt-5.4",
        prompt: "Run the task",
        runtimeConfig: null,
        status: "Blocked",
        priority: "High",
        dueAt: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        scheduleStatus: "Unscheduled",
        scheduleSource: null,
        blockReason: null,
        dependencies: [],
      },
      latestRunSummary: null,
      scheduleProposals: [],
      approvals: [],
      artifacts: [],
    });

    await expect(
      TaskDetailPage({
        params: Promise.resolve({ workspaceId: "ws_wrong", taskId: "task_1" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/en/workspaces/ws_real/tasks/task_1");
  });
});
