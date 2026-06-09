import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildCommandCenterTrailSpec, type UiDocument } from "@chrona/ui-protocol";
import { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
import { TaskWorkspaceExecutionOverview } from "./task-workspace-execution-overview";

function renderOverview(
  view: ReturnType<typeof createTaskWorkspaceExecutionConsoleView>,
  extra: Partial<React.ComponentProps<typeof TaskWorkspaceExecutionOverview>> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <TaskWorkspaceExecutionOverview
      taskId="task-1"
      progress={view.progress}
      readiness={view.readiness}
      latestResult={view.latestResult}
      attention={view.attention}
      latestCompletedNode={view.latestCompletedNode}
      artifacts={view.artifacts}
      activity={view.activity}
      {...extra}
    />,
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
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

  it("surfaces the action rail alongside the results and activity tabs", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);
    const onAction = vi.fn();
    renderOverview(view, { commandCenter: { documents: { now: nowDocument(), output: nowDocument("Output"), trail: nowDocument("Trail") } }, onAction });

    expect(screen.getAllByLabelText("Execution overview").length).toBeGreaterThan(0);
    // "Now" is no longer a tab — it is a persistent rail above the tabs.
    expect(screen.queryByRole("tab", { name: "Now" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    // Rail content is visible without selecting any tab. (The fixture reuses the
    // same document for the now/output panes, so the text appears more than once.)
    expect(screen.getAllByText("Backend-rendered now tab.").length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

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
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.queryByText("正在读取计划")).not.toBeInTheDocument();

    rerender(
      <TaskWorkspaceExecutionOverview
        taskId="task-1"
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
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

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
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    expect(screen.getByText("Plan generation update")).toBeInTheDocument();
    expect(screen.getByText("Requesting AI provider...")).toBeInTheDocument();
  });


  it("renders the latest completed node result and artifacts in the output tab", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.artifactPresent);
    const onAction = vi.fn();

    renderOverview(view, { onAction });

    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
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

    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
    expect(screen.getByText("No execution result yet.")).toBeInTheDocument();
  });

  it("hides the current operation card when there is nothing to act on", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.completed);

    // No server now document, no attention, and a passive primary action
    // (suppressAttentionCard, no onClick/actionSpec) → the rail collapses.
    renderOverview(view, {
      attention: null,
      runtimeEvents: [],
      primaryAction: {
        kind: "no-operation",
        label: "No current operation",
        description: "The accepted plan is running, but the engine has not returned an actionable checkpoint yet.",
        tone: "neutral",
        suppressAttentionCard: true,
      },
    });

    expect(screen.queryByText("Current operation")).not.toBeInTheDocument();
    expect(screen.queryByText("No current operation")).not.toBeInTheDocument();
  });

  it("hides the current operation card on a completed task even when the engine emits a now document", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.completed);

    // The backend still emits a server `now` document for completed tasks
    // ("Execution complete / No active execution session."). A passive
    // primary action must still collapse the rail — there is no operation.
    renderOverview(view, {
      attention: null,
      runtimeEvents: [],
      commandCenter: { documents: { now: nowDocument("Execution complete"), output: nowDocument("Output"), trail: nowDocument("Trail") } },
      primaryAction: {
        kind: "task-completed",
        label: "Task completed",
        description: "Execution has finished.",
        tone: "success",
        suppressAttentionCard: true,
      },
    });

    expect(screen.queryByText("Current operation")).not.toBeInTheDocument();
    expect(screen.queryByText("Execution complete")).not.toBeInTheDocument();
    expect(screen.queryByText("Backend-rendered now tab.")).not.toBeInTheDocument();
  });

  it("shows the current operation card when an attention item is present", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.completed);

    renderOverview(view, {
      attention: {
        id: "attention-1",
        title: "Needs your input",
        description: "Provide input to continue.",
        tone: "warning",
      } as React.ComponentProps<typeof TaskWorkspaceExecutionOverview>["attention"],
      primaryAction: {
        kind: "no-operation",
        label: "No current operation",
        description: "Passive status.",
        tone: "neutral",
        suppressAttentionCard: true,
      },
    });

    expect(screen.getByText("Current operation")).toBeInTheDocument();
    expect(screen.getByText("Needs your input")).toBeInTheDocument();
  });

  it("keeps the action rail visible regardless of the active tab", () => {
    // The action rail replaces the old auto-switching "Now" tab: attention
    // content is always visible and never traps the user on a tab.
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);
    renderOverview(view, {
      commandCenter: { documents: { now: nowDocument("Needs your approval"), output: nowDocument("Output"), trail: nowDocument("Trail") } },
    });

    // Rail content is shown without selecting any tab.
    expect(screen.getByText("Needs your approval")).toBeInTheDocument();

    // Switching to an archive tab does not hide the rail.
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Needs your approval")).toBeInTheDocument();
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

    // Fixture reuses one document across the now/output panes, so the title renders more than once.
    expect(screen.getAllByText("Execution running").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Retry Sync" })).not.toBeInTheDocument();
    expect(apiNowSpec.elements.root.children).toEqual(["status-card"]);
  });
});
