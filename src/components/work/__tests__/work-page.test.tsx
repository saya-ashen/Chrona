import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkPageClient } from "@/components/work/work-page-client";

describe("WorkPageClient", () => {
  it("renders a workbench-first layout with secondary activity details", () => {
    render(
      <WorkPageClient
        initialData={{
          taskShell: {
            id: "task_1",
            workspaceId: "ws_1",
            title: "Write projection",
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
          conversation: [],
          inspector: {
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
            artifacts: [],
            toolCalls: [],
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Next Action" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shared Output" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Execution Workstream" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run Snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByText("Why now")).toBeInTheDocument();
    expect(screen.getAllByText("Evidence").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "Open Schedule" })).toHaveAttribute(
      "href",
      "/schedule",
    );
    expect(screen.getByRole("link", { name: "Open Task" })).toHaveAttribute(
      "href",
      "/workspaces/ws_1/tasks/task_1",
    );
    expect(screen.getByText("AtRisk")).toBeInTheDocument();
    expect(screen.getAllByText("Approve tool execution").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Used by next action")).toBeInTheDocument();
    expect(screen.getByText("Conversation output")).toBeInTheDocument();
    expect(screen.getByText("Needs approval")).toBeInTheDocument();
    expect(screen.getByText("Linked to Next Action")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit and Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workstream" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conversation" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Work draft" })).not.toBeInTheDocument();
  });

  it("lets operators start the first run directly from the workbench", () => {
    render(
      <WorkPageClient
        initialData={{
          taskShell: {
            id: "task_2",
            workspaceId: "ws_1",
            title: "Draft rollout note",
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
            description: "No run is active yet. Launch one from this workbench or the task page when the plan is ready.",
            whyNow: "There is no active run, so execution cannot progress from this page yet.",
            actionLabel: "Open Task",
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

    expect(screen.getByRole("textbox", { name: "Run prompt" })).toHaveValue("Continue working on: Draft rollout note");
    expect(screen.getByRole("button", { name: "Start Run Here" })).toBeInTheDocument();
    expect(screen.getByText("No active run yet")).toBeInTheDocument();
  });
});
