import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildCommandCenterTrailSpec, type UiDocument } from "@chrona/ui-protocol";
import { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
import { TaskWorkspaceExecutionOverview } from "./task-workspace-execution-overview";

function renderOverview(
  view: ReturnType<typeof createTaskWorkspaceExecutionConsoleView>,
  extra: Partial<React.ComponentProps<typeof TaskWorkspaceExecutionOverview>> = {},
) {
  return render(
    <TaskWorkspaceExecutionOverview
      progress={view.progress}
      readiness={view.readiness}
      latestResult={view.latestResult}
      attention={view.attention}
      latestCompletedNode={view.latestCompletedNode}
      artifacts={view.artifacts}
      activity={view.activity}
      {...extra}
    />,
  );
}

function nowDocument(title = "Current operation"): UiDocument {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: { gap: "sm" }, children: ["status-card"] },
      "status-card": {
        type: "WorkspaceSummaryCard",
        props: {
          eyebrow: "Current operation",
          title,
          description: "Backend-rendered now tab.",
          statusLabel: "started",
          tone: "info",
          icon: "sparkles",
        },
      },
    },
  };
}


describe("TaskWorkspaceExecutionOverview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the now, output, and trail tabs", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);
    const onAction = vi.fn();
    renderOverview(view, { commandCenter: { documents: { now: nowDocument(), output: nowDocument("Output"), trail: nowDocument("Trail") } }, onAction });

    expect(screen.getAllByLabelText("Execution overview").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Now" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Output" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trail" })).toBeInTheDocument();
    expect(screen.getByText("Backend-rendered now tab.")).toBeInTheDocument();
  });

  it("renders live runtime events in the now tab", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);
    renderOverview(view, {
      commandCenter: { documents: { now: nowDocument("Execution running"), output: nowDocument("Output"), trail: nowDocument("Trail") } },
      runtimeEvents: [{
        type: "runtime_event",
        action: "start_manual",
        nodeId: "execute",
        nodeTitle: "execute",
        runtimeName: "hermes",
        provider: "hermes",
        runId: "run-1",
        sequence: 1,
        timestamp: "2026-05-12T10:01:00.000Z",
        event: { type: "tool_started", toolName: "chrona_plan_read", label: "正在读取计划" },
      }],
    });

    expect(screen.getByText("Execution running")).toBeInTheDocument();
    expect(screen.queryByText("Tool: 正在读取计划")).not.toBeInTheDocument();
  });


  it("renders persisted server-driven Trail items once", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);
    const commandCenter = {
      documents: {
        now: nowDocument("Execution running"),
        output: nowDocument("Output"),
        trail: buildCommandCenterTrailSpec({
          activity: [{
            id: "persisted-plan-status",
            kind: "task",
            title: "Plan generation update",
            summary: "Requesting AI provider...",
            description: "Requesting AI provider...",
            tone: "info",
            timestamp: "2026-05-12T10:00:00.000Z",
          }],
          savedCount: 1,
          toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" },
        }),
      },
    };

    renderOverview(view, { commandCenter });
    fireEvent.click(screen.getByRole("tab", { name: "Trail" }));

    expect(screen.getByText("Plan generation update")).toBeInTheDocument();
    expect(screen.getByText("Requesting AI provider...")).toBeInTheDocument();
    expect(screen.getAllByText("1 shown · 0 live · 1 saved")).toHaveLength(1);
    expect(screen.queryByText("0 shown · 0 live · 0 saved")).not.toBeInTheDocument();
  });

  it("streams live runtime events into a server-driven Trail document", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);
    const commandCenter = { documents: { now: nowDocument("Execution running"), output: nowDocument("Output"), trail: buildCommandCenterTrailSpec({ activity: [], savedCount: 0, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }) } };
    const liveEvent = {
      type: "runtime_event" as const,
      action: "start_manual" as const,
      nodeId: "execute",
      nodeTitle: "execute",
      runtimeName: "hermes",
      provider: "hermes",
      runId: "run-1",
      sequence: 1,
      timestamp: "2026-05-12T10:01:00.000Z",
      event: { type: "tool_started" as const, toolName: "chrona_plan_read", label: "正在读取计划" },
    };

    const { rerender } = renderOverview(view, { commandCenter, runtimeEvents: [] });
    fireEvent.click(screen.getByRole("tab", { name: "Trail" }));
    expect(screen.queryByText("正在读取计划")).not.toBeInTheDocument();

    rerender(
      <TaskWorkspaceExecutionOverview
        progress={view.progress}
        readiness={view.readiness}
        latestResult={view.latestResult}
        attention={view.attention}
        latestCompletedNode={view.latestCompletedNode}
        artifacts={view.artifacts}
        activity={view.activity}
        commandCenter={commandCenter}
        runtimeEvents={[liveEvent]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Trail" }));

    return waitFor(() => expect(screen.getByText("正在读取计划")).toBeInTheDocument());
  });

  it("streams live workspace events into a server-driven Trail document", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);
    const commandCenter = { documents: { now: nowDocument("Execution running"), output: nowDocument("Output"), trail: buildCommandCenterTrailSpec({ activity: [], savedCount: 0, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }) } };

    renderOverview(view, {
      commandCenter,
      liveActivity: [{
        id: "event-plan-status-1",
        kind: "task",
        title: "Plan generation update",
        summary: "Requesting AI provider...",
        description: "Requesting AI provider...",
        tone: "info",
        timestamp: "2026-05-12T10:00:00.000Z",
      }],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Trail" }));

    expect(screen.getByText("Plan generation update")).toBeInTheDocument();
    expect(screen.getByText("Requesting AI provider...")).toBeInTheDocument();
  });


  it("renders the latest completed node result and artifacts in the output tab", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.artifactPresent);
    const onAction = vi.fn();

    renderOverview(view, { onAction });

    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    expect(screen.getByText("summary")).toBeInTheDocument();
    expect(screen.queryByText(/runtimeRunRef/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Locate source node" }));
    expect(onAction).toHaveBeenCalledWith("done");
    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByText("file://report.md")).toBeInTheDocument();
  });

  it("renders a command center primary action in the now tab", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);
    const onClick = vi.fn();
    renderOverview(view, {
      commandCenter: { documents: { now: nowDocument("Execution running"), output: nowDocument("Output"), trail: nowDocument("Trail") } },
      primaryAction: {
        kind: "generate",
        label: "Generate plan",
        description: "Create an execution plan before starting task work.",
        statusLabel: "idle",
        tone: "info",
        onClick,
      },
    });

    expect(screen.getByText("Execution running")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate plan" })).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders an empty output state when no node has completed", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);

    renderOverview(view);

    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    expect(screen.getByText("No execution result yet.")).toBeInTheDocument();
  });

  it("auto-switches to the now tab when attention first appears", () => {
    const calm = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);
    const attentive = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);

    const { rerender } = render(
      <TaskWorkspaceExecutionOverview
        progress={calm.progress}
        readiness={calm.readiness}
        latestResult={calm.latestResult}
        attention={null}
        latestCompletedNode={calm.latestCompletedNode}
        artifacts={calm.artifacts}
        activity={calm.activity}
      />,
    );

    // User moves to the Trail tab while nothing needs attention.
    fireEvent.click(screen.getByRole("tab", { name: "Trail" }));
    expect(screen.getByRole("tab", { name: "Trail" })).toHaveAttribute("aria-selected", "true");

    // Attention appears: the console pulls focus back to Now exactly once.
    rerender(
      <TaskWorkspaceExecutionOverview
        progress={attentive.progress}
        readiness={attentive.readiness}
        latestResult={attentive.latestResult}
        attention={attentive.attention}
        latestCompletedNode={attentive.latestCompletedNode}
        artifacts={attentive.artifacts}
        activity={attentive.activity}
      />,
    );
    expect(screen.getByRole("tab", { name: "Now" })).toHaveAttribute("aria-selected", "true");
  });

  it("lets the user leave the now tab while attention persists", () => {
    // Regression: a blocked/attention state must not trap the user on Now.
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);

    renderOverview(view);

    expect(screen.getByRole("tab", { name: "Now" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Trail" }));
    expect(screen.getByRole("tab", { name: "Trail" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    expect(screen.getByRole("tab", { name: "Output" })).toHaveAttribute("aria-selected", "true");
  });
  it("renders API-provided now documents without frontend augmentation", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);
    const apiNowSpec: UiDocument = {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "sm" }, children: ["status-card"] },
        "status-card": {
          type: "WorkspaceSummaryCard",
          props: {
            eyebrow: "Current operation",
            title: "Execution running",
            description: "No active execution session.",
            statusLabel: "started",
            tone: "info",
            icon: "sparkles",
          },
        },
      },
    };

    renderOverview(view, {
      commandCenter: { documents: { now: apiNowSpec, output: apiNowSpec, trail: apiNowSpec } },
      primaryAction: {
        kind: "task-primary-action",
        label: "Retry Sync",
        description: "Retry sync or repair this node before continuing execution.",
        statusLabel: "Degraded",
        tone: "critical",
        onClick: vi.fn(),
      },
    });

    expect(screen.getByText("Execution running")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry Sync" })).not.toBeInTheDocument();
    expect(apiNowSpec.elements.root.children).toEqual(["status-card"]);
  });
});
