import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {} }),
}));

import { ExecutionTimeline } from "@/components/work/execution-timeline";

afterEach(() => {
  cleanup();
});

describe("ExecutionTimeline", () => {
  it("prioritizes key milestones and collapses background progress records by default", () => {
    render(
      <ExecutionTimeline
        events={[
          {
            id: "progress_1",
            eventType: "task.plan_updated",
            title: "Plan updated",
            summary: "整理页面骨架",
            kind: "progress",
            badge: "进展",
            whyItMatters: "同步当前推进位置。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:19:00.000Z",
          },
          {
            id: "approval_1",
            eventType: "run.approval_requested",
            title: "等待审批",
            summary: "需要确认是否允许继续改动。",
            kind: "approval",
            badge: "待审批",
            whyItMatters: "审批前无法继续。",
            linkedEvidenceLabel: "关联到下一步",
            payload: {},
            runtimeTs: "2026-04-20T09:20:00.000Z",
          },
          {
            id: "progress_2",
            eventType: "task.synced",
            title: "Synced",
            summary: "已同步最新事件。",
            kind: "progress",
            badge: "进展",
            whyItMatters: "仅供追踪。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:21:00.000Z",
          },
          {
            id: "output_1",
            eventType: "run.output_generated",
            title: "产出更新",
            summary: "生成了首轮方案草稿。",
            kind: "output",
            badge: "新产出",
            whyItMatters: "可直接用于下一步决策。",
            linkedEvidenceLabel: "关联到最新结果",
            payload: {},
            runtimeTs: "2026-04-20T09:22:00.000Z",
          },
        ]}
      />, 
    );

    expect(screen.getByText("需要优先查看")).toBeInTheDocument();
    expect(screen.getByText("等待审批")).toBeInTheDocument();
    expect(screen.getByText("产出更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开其余 2 条背景记录" })).toBeInTheDocument();
    expect(screen.queryByText("Plan updated")).not.toBeInTheDocument();
    expect(screen.queryByText("Synced")).not.toBeInTheDocument();
  });

  it("reveals collapsed background records on demand", async () => {
    const user = userEvent.setup();

    render(
      <ExecutionTimeline
        events={[
          {
            id: "progress_1",
            eventType: "task.plan_updated",
            title: "Plan updated",
            summary: "整理页面骨架",
            kind: "progress",
            badge: "进展",
            whyItMatters: "同步当前推进位置。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:19:00.000Z",
          },
          {
            id: "output_1",
            eventType: "run.output_generated",
            title: "产出更新",
            summary: "生成了首轮方案草稿。",
            kind: "output",
            badge: "新产出",
            whyItMatters: "可直接用于下一步决策。",
            linkedEvidenceLabel: "关联到最新结果",
            payload: {},
            runtimeTs: "2026-04-20T09:22:00.000Z",
          },
        ]}
      />, 
    );

    await user.click(screen.getByRole("button", { name: "展开其余 1 条背景记录" }));

    const backgroundSection = screen.getByRole("region", { name: "背景记录" });
    expect(within(backgroundSection).getByText("Plan updated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起背景记录" })).toBeInTheDocument();
  });

  it("sorts records by newest timestamp first before grouping", () => {
    render(
      <ExecutionTimeline
        events={[
          {
            id: "older_output",
            eventType: "run.output_generated",
            title: "较早产出",
            summary: "先生成的草稿。",
            kind: "output",
            badge: "新产出",
            whyItMatters: "较早事件。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:18:00.000Z",
          },
          {
            id: "newer_output",
            eventType: "run.output_generated",
            title: "最新产出",
            summary: "后生成的草稿。",
            kind: "output",
            badge: "新产出",
            whyItMatters: "更新事件。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:22:00.000Z",
          },
        ]}
      />,
    );

    const prioritizedSection = screen.getByRole("region", { name: "需要优先查看" });
    const titles = within(prioritizedSection)
      .getAllByText(/最新产出|较早产出/)
      .map((node) => node.textContent);

    expect(titles).toEqual(["最新产出", "较早产出"]);
  });

  it("groups records by run when run identifiers are available", async () => {
    const user = userEvent.setup();

    render(
      <ExecutionTimeline
        currentRunId="run_current"
        events={[
          {
            id: "task_context",
            eventType: "task.plan_updated",
            title: "任务级规划更新",
            summary: "先整理任务结构。",
            kind: "progress",
            badge: "进展",
            whyItMatters: "帮助理解整体上下文。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:10:00.000Z",
          },
          {
            id: "prior_run_output",
            runId: "run_previous",
            eventType: "run.output_generated",
            title: "上一轮首稿",
            summary: "生成了首轮草稿。",
            kind: "output",
            badge: "新产出",
            whyItMatters: "可作为后续参考。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:15:00.000Z",
          },
          {
            id: "current_run_input",
            runId: "run_current",
            eventType: "run.input_requested",
            title: "等待补充约束",
            summary: "需要你确认不可变范围。",
            kind: "input",
            badge: "待补充",
            whyItMatters: "不补充无法继续。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:21:00.000Z",
          },
          {
            id: "current_run_progress",
            runId: "run_current",
            eventType: "task.synced",
            title: "同步完成",
            summary: "记录当前执行状态。",
            kind: "progress",
            badge: "进展",
            whyItMatters: "仅供追踪。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:20:00.000Z",
          },
        ]}
      />,
    );

    const currentRunSection = screen.getByRole("region", { name: "当前运行" });
    const previousRunSection = screen.getByRole("region", { name: "历史运行 1" });
    const taskContextSection = screen.getByRole("region", { name: "任务上下文" });

    expect(within(currentRunSection).getByText("等待补充约束")).toBeInTheDocument();
    expect(within(previousRunSection).getByText("上一轮首稿")).toBeInTheDocument();
    expect(within(taskContextSection).getByText("任务级规划更新")).toBeInTheDocument();
    expect(within(currentRunSection).getByRole("button", { name: "展开其余 1 条背景记录" })).toBeInTheDocument();

    await user.click(within(currentRunSection).getByRole("button", { name: "展开其余 1 条背景记录" }));

    expect(within(currentRunSection).getByText("同步完成")).toBeInTheDocument();
  });

  it("shows progress records directly when no key milestone exists", () => {
    render(
      <ExecutionTimeline
        events={[
          {
            id: "progress_1",
            eventType: "task.plan_updated",
            title: "Plan updated",
            summary: "整理页面骨架",
            kind: "progress",
            badge: "进展",
            whyItMatters: "同步当前推进位置。",
            linkedEvidenceLabel: null,
            payload: {},
            runtimeTs: "2026-04-20T09:19:00.000Z",
          },
        ]}
      />, 
    );

    expect(screen.getAllByText("Plan updated").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /背景记录/ })).not.toBeInTheDocument();
    expect(screen.queryByText("需要优先查看")).not.toBeInTheDocument();
  });
});
