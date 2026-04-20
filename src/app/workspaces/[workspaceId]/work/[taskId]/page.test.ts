import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/modules/queries/get-work-page", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/queries/get-work-page")>();

  return {
    ...actual,
    getWorkPage: vi.fn(),
  };
});

vi.mock("@/i18n/get-dictionary", () => ({
  getDictionary: vi.fn().mockResolvedValue({ queries: { workPage: {} } }),
}));

import { notFound, redirect } from "next/navigation";
import WorkPage from "@/app/workspaces/[workspaceId]/work/[taskId]/page";
import { getWorkPage, WorkPageTaskNotFoundError } from "@/modules/queries/get-work-page";

describe("WorkPage", () => {
  it("redirects routes whose workspace id does not match the task workspace", async () => {
    vi.mocked(getWorkPage).mockResolvedValue({
      taskShell: {
        id: "task_1",
        workspaceId: "ws_real",
        title: "Write projection",
        runtimeModel: "gpt-5.4",
        prompt: "Run the task",
        status: "Blocked",
        priority: "High",
        dueAt: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        scheduleStatus: "Unscheduled",
        blockReason: null,
      },
      currentRun: null,
      currentIntervention: {
        kind: "idle",
        title: "Check run state",
        description: "Review the latest output and inspector state before acting.",
        actionLabel: "Inspect Run",
        whyNow: "The run state needs inspection before the next action is clear.",
        evidence: [],
      },
      latestOutput: {
        kind: "empty",
        title: "No mapped output yet",
        body: "The latest artifact or agent result will appear here first.",
        timestamp: null,
        href: null,
        empty: true,
        sourceLabel: "No output source",
      },
      scheduleImpact: {
        status: "Unscheduled",
        dueAt: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        summary: "No planned window exists yet. Place or adjust the task from Schedule.",
      },
      reliability: {
        refreshedAt: new Date().toISOString(),
        lastSyncedAt: null,
        lastUpdatedAt: null,
        syncStatus: null,
        isStale: false,
        stuckFor: null,
        stopReason: null,
      },
      closure: {
        resultAccepted: false,
        acceptedAt: null,
        isDone: false,
        doneAt: null,
        canAcceptResult: false,
        canMarkDone: false,
        canCreateFollowUp: false,
        canRetry: false,
        canReopen: false,
        latestFollowUp: null,
      },
      workstreamItems: [],
      conversation: [],
      inspector: {
        approvals: [],
        artifacts: [],
        toolCalls: [],
      },
      taskPlan: { state: "empty" as const, revision: null, generatedBy: null, isMock: false, summary: null, updatedAt: null, changeSummary: null, currentStepId: null, steps: [], edges: [] },
      workspaceRail: { sections: [] },
      composerValue: "",
    });

    await expect(
      WorkPage({
        params: Promise.resolve({ workspaceId: "ws_wrong", taskId: "task_1" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/en/workspaces/ws_real/work/task_1");
  });

  it("renders not-found when the task no longer exists", async () => {
    vi.mocked(getWorkPage).mockRejectedValue(new WorkPageTaskNotFoundError("task_missing"));

    await expect(
      WorkPage({
        params: Promise.resolve({ workspaceId: "ws_1", taskId: "task_missing" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(vi.mocked(notFound)).toHaveBeenCalled();
  });
});
