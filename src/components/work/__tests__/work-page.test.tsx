import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkPageClient } from "@/components/work/work-page-client";

afterEach(() => {
  cleanup();
});

describe("WorkPageClient", () => {
  it("renders a three-column workbench layout with context and task-plan sidebars", () => {
    render(
      <WorkPageClient
        initialData={{
            taskShell: {
              id: "task_1",
              workspaceId: "ws_1",
              title: "Write projection",
              runtimeModel: "gpt-5.4",
              prompt: null,
              status: "Blocked",
              priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "AtRisk",
            blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
          },
          currentRun: { id: "run_1", status: "WaitingForApproval", pendingInputPrompt: "Need operator guidance" },
          currentIntervention: {
            kind: "approval",
            title: "Resolve approval",
            description: "Allow the agent to edit files.",
            whyNow: "A human decision is required before the next execution step can proceed.",
            actionLabel: "Approve / Reject / Edit",
            evidence: [
              { label: "Pending approval", value: "Approve tool execution", tone: "warning" },
              { label: "Latest output", value: "Latest agent output", tone: "neutral" },
            ],
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
          },
          latestOutput: {
            kind: "message",
            title: "Latest agent output",
            body: "The agent prepared a safe file edit plan.",
            timestamp: "2026-04-16T10:15:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Conversation output",
          },
          scheduleImpact: {
            status: "AtRisk",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            summary: "Execution timing is slipping against the planned window.",
          },
          reliability: {
            refreshedAt: "2026-04-16T10:16:00.000Z",
            lastSyncedAt: "2026-04-16T10:15:00.000Z",
            lastUpdatedAt: "2026-04-16T10:15:00.000Z",
            syncStatus: "healthy",
            isStale: false,
            stuckFor: "1m",
            stopReason: "Approve / Reject / Edit and Approve",
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
          taskPlan: {
            state: "ready",
            revision: "generated",
            generatedBy: "work-plan-agent",
            isMock: true,
            summary: "先澄清目标与背景，再执行首轮产出，并把需要确认的节点收束到右侧任务计划。",
            updatedAt: "2026-04-16T10:16:00.000Z",
            changeSummary: "已基于当前任务背景生成初始占位计划。",
            currentStepId: "execute-task",
            steps: [
              { id: "understand-task", title: "梳理目标与约束", objective: "确认目标与限制。", phase: "理解", status: "done", needsUserInput: false },
              { id: "gather-context", title: "补齐上下文", objective: "收集当前背景。", phase: "准备", status: "done", needsUserInput: false },
              { id: "execute-task", title: "推进首轮产出", objective: "推进当前执行并处理审批节点。", phase: "执行", status: "waiting_for_user", needsUserInput: true },
              { id: "confirm-next-step", title: "确认结果与下一步", objective: "等待结果后确认后续动作。", phase: "确认", status: "pending", needsUserInput: false },
            ],
          },
          workspaceRail: {
            sections: [
              {
                id: "in-progress",
                title: "In progress",
                items: [
                  {
                    taskId: "task_1",
                    title: "Write projection",
                    statusLabel: "WaitingForApproval",
                    tone: "waiting",
                    isCurrent: true,
                  },
                  {
                    taskId: "task_2",
                    title: "Q2 growth recap",
                    statusLabel: "Running",
                    tone: "active",
                    isCurrent: false,
                  },
                ],
              },
              {
                id: "completed",
                title: "Completed",
                items: [
                  {
                    taskId: "task_3",
                    title: "Rewrite homepage copy",
                    statusLabel: "Done",
                    tone: "done",
                    isCurrent: false,
                  },
                ],
              },
            ],
          },
          workstreamItems: [
            {
              id: "evt_1",
              eventType: "approval.requested",
              title: "Approval Requested",
              summary: "command: edit files · scope: repo",
              kind: "approval",
              badge: "Needs approval",
              whyItMatters: "Human approval or review directly affects whether this run can continue.",
              linkedEvidenceLabel: "Linked to Next Action",
              payload: { command: "edit files", scope: "repo" },
              runtimeTs: "2026-04-16T10:14:00.000Z",
            },
          ],
          conversation: [
            {
              id: "msg_agent_1",
              role: "assistant",
              content: "I need approval before editing files.",
              runtimeTs: "2026-04-16T10:13:00.000Z",
            },
            {
              id: "msg_user_1",
              role: "user",
              content: "Use the safer option and keep the change small.",
              runtimeTs: "2026-04-16T10:13:30.000Z",
            },
          ],
          inspector: {
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
            artifacts: [],
            toolCalls: [],
          },
        }}
      />,
    );

    const statusCard = screen.getByRole("heading", { name: "任务状态" }).closest("section");
    const collaborationHeading = screen.getByRole("heading", { name: "对话记录" });
    const inputHeading = screen.getByRole("heading", { name: "输入区" });

    expect(statusCard).not.toBeNull();
    const statusScope = within(statusCard as HTMLElement);

    expect(statusScope.getByRole("heading", { name: "任务状态" })).toBeInTheDocument();
    expect(statusScope.getByText("当前阶段")).toBeInTheDocument();
    expect(statusScope.getByText("当前异常")).toBeInTheDocument();
    expect(statusScope.getByText("进行中")).toBeInTheDocument();
    expect(statusScope.getByText("等待确认")).toBeInTheDocument();
    expect(statusScope.getByText("Approve / Reject / Edit and Approve")).toBeInTheDocument();
    expect(collaborationHeading).toBeInTheDocument();
    expect(inputHeading).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "当前需要你决定" })).not.toBeInTheDocument();
    expect(screen.queryByText("Q2 growth recap")).not.toBeInTheDocument();
    expect(screen.getByText("日程信息")).toBeInTheDocument();
    expect(screen.getByText("任务背景")).toBeInTheDocument();
    expect(screen.getByText("当前阻塞")).toBeInTheDocument();
    expect(screen.getByText("运行信息")).toBeInTheDocument();
    expect(screen.getByText("当前步骤")).toBeInTheDocument();
    expect(screen.getByText("重新规划后继续")).toBeInTheDocument();
    expect(screen.getByText("推进首轮产出")).toBeInTheDocument();
    expect(screen.getAllByText("等待你确认").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "重新规划后继续" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开日程" })).toHaveAttribute(
      "href",
      "/en/schedule",
    );
    expect(screen.getByRole("link", { name: "查看任务详情" })).toHaveAttribute(
      "href",
      "/en/workspaces/ws_1/tasks/task_1",
    );
    expect(screen.getByText("已超时")).toBeInTheDocument();
    expect(screen.getAllByText("Approve tool execution").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Conversation output")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Execution Timeline" })).toBeInTheDocument();
    expect(screen.getAllByRole("group").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Write projection" })).toBeInTheDocument();
    expect(screen.getByText("I need approval before editing files.")).toBeInTheDocument();
    expect(screen.getByText("Use the safer option and keep the change small.")).toBeInTheDocument();
    const agentMessage = screen.getByText("I need approval before editing files.").closest("article");
    const userMessage = screen.getByText("Use the safer option and keep the change small.").closest("article");
    expect(agentMessage?.className).toContain("mr-auto");
    expect(userMessage?.className).toContain("ml-auto");
    expect(screen.getByText("待确认卡")).toBeInTheDocument();
    expect(screen.getByText("最新结果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修改后批准" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /发送给 Agent 的内容/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送补充说明" })).toBeInTheDocument();
    expect(screen.getAllByText("给 Agent 补充要求")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "背景" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "计划" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工具记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "产出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对话往来" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Work draft" })).not.toBeInTheDocument();
  });

  it("shows a collaboration composer while a run is actively running", () => {
    render(
      <WorkPageClient
        initialData={{
          taskShell: {
            id: "task_running",
            workspaceId: "ws_1",
            title: "Monitor rollout",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Running",
            priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "OnTrack",
            blockReason: { actionRequired: "Observe progress" },
          },
          currentRun: {
            id: "run_running",
            status: "Running",
            pendingInputPrompt: null,
          },
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [{ label: "Status", value: "Running", tone: "neutral" }],
          },
          latestOutput: {
            kind: "message",
            title: "Live update",
            body: "Collecting deployment evidence.",
            timestamp: "2026-04-16T10:20:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Conversation output",
          },
          scheduleImpact: {
            status: "OnTrack",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            summary: "Execution is moving inside the planned window.",
          },
          reliability: {
            refreshedAt: "2026-04-16T10:21:00.000Z",
            lastSyncedAt: "2026-04-16T10:20:00.000Z",
            lastUpdatedAt: "2026-04-16T10:20:00.000Z",
            syncStatus: "healthy",
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
          taskPlan: {
            state: "ready",
            revision: "updated",
            generatedBy: "work-plan-agent",
            isMock: true,
            summary: "计划会随着运行状态自动维护。",
            updatedAt: "2026-04-16T10:21:00.000Z",
            changeSummary: "已根据当前状态重新整理占位计划。",
            currentStepId: "execute-task",
            steps: [
              { id: "understand-task", title: "梳理目标与约束", objective: "确认目标。", phase: "理解", status: "done", needsUserInput: false },
              { id: "gather-context", title: "补齐上下文", objective: "整理背景。", phase: "准备", status: "done", needsUserInput: false },
              { id: "execute-task", title: "推进首轮产出", objective: "执行主要工作。", phase: "执行", status: "in_progress", needsUserInput: false },
              { id: "confirm-next-step", title: "确认结果与下一步", objective: "留待结果后处理。", phase: "确认", status: "pending", needsUserInput: false },
            ],
          },
          workstreamItems: [],
          conversation: [
            {
              id: "msg_1",
              role: "user",
              content: "Keep the summary brief unless a rollout risk appears.",
              runtimeTs: "2026-04-16T10:19:00.000Z",
            },
          ],
          inspector: {
            approvals: [],
            artifacts: [],
            toolCalls: [],
          },
        }}
      />,
    );

    expect(screen.getAllByRole("textbox", { name: /发送给 Agent 的内容/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "发送补充说明" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "背景" }).length).toBeGreaterThan(0);
    expect(screen.getByText("任务计划")).toBeInTheDocument();
    expect(screen.getAllByText("进行中").length).toBeGreaterThan(0);
  });

  it("lets operators start the first run directly from the workbench", () => {
    render(
      <WorkPageClient
        initialData={{
            taskShell: {
              id: "task_2",
              workspaceId: "ws_1",
              title: "Draft rollout note",
              runtimeModel: "gpt-5.4",
              prompt: null,
              status: "Ready",
            priority: "Medium",
            dueAt: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
            scheduleStatus: "Unscheduled",
            blockReason: { actionRequired: "Start the first execution pass" },
          },
          currentRun: null,
            currentIntervention: {
              kind: "idle",
              title: "Start execution",
              description: "No run is active yet. Launch one from this workbench once the task is ready in Schedule.",
              whyNow: "There is no active run, so execution cannot progress from this page yet.",
              actionLabel: "Start Run Here",
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
            summary: "No planned window exists yet.",
          },
          reliability: {
            refreshedAt: "2026-04-16T10:16:00.000Z",
            lastSyncedAt: null,
            lastUpdatedAt: null,
            syncStatus: null,
            isStale: false,
            stuckFor: null,
            stopReason: "Start the first execution pass",
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
          taskPlan: {
            state: "empty",
            revision: null,
            generatedBy: null,
            isMock: true,
            summary: null,
            updatedAt: null,
            changeSummary: null,
            currentStepId: null,
            steps: [],
          },
          workstreamItems: [],
          conversation: [],
          inspector: {
            approvals: [],
            artifacts: [],
            toolCalls: [],
          },
        }}
      />,
    );

    const statusCard = screen.getByRole("heading", { name: "任务状态" }).closest("section");
    expect(statusCard).not.toBeNull();
    const statusScope = within(statusCard as HTMLElement);

    expect(screen.getByDisplayValue("继续处理：Draft rollout note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启动并继续" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成占位计划" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "给 Agent 补充要求" })).toBeInTheDocument();
    expect(statusScope.getByRole("heading", { name: "任务状态" })).toBeInTheDocument();
    expect(statusScope.getByText("当前阶段")).toBeInTheDocument();
    expect(statusScope.getByText("待开始")).toBeInTheDocument();
    expect(statusScope.getAllByText("待开始").length).toBeGreaterThan(0);
    expect(screen.getByText("尚未生成结果")).toBeInTheDocument();
    expect(screen.getByText("第一轮任务理解")).toBeInTheDocument();
    expect(screen.getByText("执行建议")).toBeInTheDocument();
  });

  it("renders completed closure actions directly in the main action area", () => {
    render(
      <WorkPageClient
        initialData={{
          taskShell: {
            id: "task_3",
            workspaceId: "ws_1",
            title: "Close rollout checklist",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Completed",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_3",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: {
            kind: "review",
            title: "Review result",
            description: "The run completed. Review the latest output and decide whether follow-up work is needed.",
            whyNow: "The latest result is available and should be reviewed before closing or extending the task.",
            actionLabel: "Review Output",
            evidence: [],
          },
          latestOutput: {
            kind: "artifact",
            title: "Rollout summary",
            body: "Type: report",
            timestamp: "2026-04-20T09:45:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Artifact · report",
          },
          scheduleImpact: {
            status: "Completed",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            summary: "Schedule remains aligned with the current plan.",
          },
          reliability: {
            refreshedAt: "2026-04-20T09:46:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            lastUpdatedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            isStale: false,
            stuckFor: null,
            stopReason: "Run finished and is ready for review",
          },
          closure: {
            resultAccepted: false,
            acceptedAt: null,
            isDone: false,
            doneAt: null,
            canAcceptResult: true,
            canMarkDone: true,
            canCreateFollowUp: true,
            canRetry: true,
            canReopen: false,
            latestFollowUp: null,
          },
          taskPlan: {
            state: "ready",
            revision: "updated",
            generatedBy: "work-plan-agent",
            isMock: true,
            summary: "结果已生成，下一步等待你确认是否收尾或继续。",
            updatedAt: "2026-04-20T09:46:00.000Z",
            changeSummary: "已根据完成状态更新占位计划。",
            currentStepId: "confirm-next-step",
            steps: [
              { id: "understand-task", title: "梳理目标与约束", objective: "确认目标。", phase: "理解", status: "done", needsUserInput: false },
              { id: "gather-context", title: "补齐上下文", objective: "整理背景。", phase: "准备", status: "done", needsUserInput: false },
              { id: "execute-task", title: "推进首轮产出", objective: "完成本轮执行。", phase: "执行", status: "done", needsUserInput: false },
              { id: "confirm-next-step", title: "确认结果与下一步", objective: "等待你确认是否继续。", phase: "确认", status: "waiting_for_user", needsUserInput: true },
            ],
          },
          workstreamItems: [],
          conversation: [],
          inspector: {
            approvals: [],
            artifacts: [],
            toolCalls: [],
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "重新执行" })).toBeInTheDocument();
    expect(screen.queryByText("后续动作")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "标记任务完成" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建后续任务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "后续任务标题" })).not.toBeInTheDocument();
  });
});
