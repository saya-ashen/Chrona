import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildCommandCenterTrailSpec, validateChronaSpec, type UiDocument } from "@chrona/ui-protocol";
import { createTaskWorkspaceExecutionConsoleView } from "../../task-workspace";
import { taskWorkspaceStateFixtures } from "../../../apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures";
import { TaskWorkspaceExecutionOverview } from "../ui/task-workspace-execution-overview";
import { buildCommandCenterOutputTabSpec, buildCommandCenterTrailTabSpec } from "../ui/build-execution-overview-spec";

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

  it("renders Results as primary content and keeps Activity secondary", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);
    renderOverview(view, { commandCenter: { documents: { now: nowDocument(), output: nowDocument("Output"), trail: nowDocument("Trail") } } });

    expect(screen.getAllByLabelText("Execution overview").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: "Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Results" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("AI generated")).toBeInTheDocument();
    expect(screen.getAllByText("Runtime state").length).toBeGreaterThan(0);
  });

  it("renders Activity as a side timeline in compact plan mode", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);
    renderOverview(view, {
      activityLayout: "side",
      commandCenter: { documents: { now: nowDocument(), output: nowDocument("Output"), trail: buildCommandCenterTrailSpec({ activity: [{ id: "tool", kind: "tool_completed", title: "Tool completed", summary: "Read plan", description: "Read plan", tone: "success", tool: { label: "Read plan", state: "completed", durationMs: 128 } }], savedCount: 1, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }) } },
    });

    const activity = screen.getByRole("region", { name: "Activity" });
    expect(activity).toHaveClass("border-l");
    expect(screen.getByText("done · 128ms")).toBeInTheDocument();
    expect(screen.queryByText("▸ Activity")).not.toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
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

    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Plan generation update")).toBeInTheDocument();
    expect(screen.getByText("Requesting AI provider...")).toBeInTheDocument();
    expect(screen.getAllByText("1 shown · 0 live · 1 saved")).toHaveLength(1);
    expect(screen.queryByText("0 shown · 0 live · 0 saved")).not.toBeInTheDocument();
  });

  it("shows a live status strip above Results while a runtime event is active", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);
    const liveEvent = {
      type: "runtime_event" as const,
      action: "start_manual" as const,
      nodeId: "execute",
      nodeTitle: "Generate report",
      runtimeName: "hermes",
      provider: "hermes",
      runId: "run-1",
      sequence: 1,
      timestamp: "2026-05-12T10:01:00.000Z",
      event: { type: "tool_started" as const, toolName: "chrona_report_write", label: "Writing report" },
    };

    renderOverview(view, {
      commandCenter: { documents: { now: nowDocument("Execution running"), output: nowDocument("Output"), trail: buildCommandCenterTrailSpec({ activity: [], savedCount: 0, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }) } },
      runtimeEvents: [liveEvent],
      currentExecution: { status: "running" },
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Running now");
    expect(status).toHaveTextContent("Writing report");
  });

  it("hides live status strip before execution has active runtime activity", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);

    renderOverview(view, {
      commandCenter: { documents: { now: nowDocument("Execution ready"), output: nowDocument("Output"), trail: buildCommandCenterTrailSpec({ activity: [], savedCount: 0, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }) } },
      currentExecution: { status: "started" },
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("Running now")).not.toBeInTheDocument();
  });


  it("hides live status strip after completion even when stale activity looks active", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.completed);
    const staleStarted = {
      id: "stale-tool-started",
      kind: "tool_started" as const,
      title: "Tool started",
      summary: "Writing report",
      description: "Writing report",
      tone: "info" as const,
      timestamp: "2026-05-12T10:01:00.000Z",
      tool: { name: "chrona_report_write", label: "Writing report", state: "started" as const },
    };

    renderOverview(view, {
      commandCenter: { documents: { now: nowDocument("Execution completed"), output: nowDocument("Output"), trail: buildCommandCenterTrailSpec({ activity: [staleStarted], savedCount: 1, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }) } },
      currentExecution: { status: "completed" },
      activity: [staleStarted],
    });

    expect(screen.queryByText("Running now")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Latest activity running")).not.toBeInTheDocument();
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
    expect(screen.getByText("Activity")).toBeInTheDocument();
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
    expect(screen.getByText("Activity")).toBeInTheDocument();

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
    expect(screen.getByText("Activity")).toBeInTheDocument();

    expect(screen.getByText("Plan generation update")).toBeInTheDocument();
    expect(screen.getByText("Requesting AI provider...")).toBeInTheDocument();
  });


  it("renders shared plan output and artifacts as primary results content", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.artifactPresent);

    renderOverview(view, { commandCenter: { documents: { now: nowDocument("Execution running"), output: nowDocument("Plan output"), trail: nowDocument("Trail") } } });

    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByText("Plan output")).toBeInTheDocument();
    expect(screen.queryByText("summary")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Locate source node" })).not.toBeInTheDocument();
    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByText("file://report.md")).toBeInTheDocument();
  });

  it("does not render command center primary actions inside the execution panel", () => {
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

    expect(screen.queryByText("Execution running")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate plan" })).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders an empty output state when no node has completed", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);

    renderOverview(view);

    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
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


  it("builds valid output and trail fallback specs", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.artifactPresent);
    const outputSpec = buildCommandCenterOutputTabSpec({
      latestCompletedNode: view.latestCompletedNode,
      resultSpec: nowDocument("Result fallback"),
      artifacts: view.artifacts,
      copy: { noResultYet: "No output yet.", noArtifacts: "No artifacts yet.", locateSourceNode: "Locate source node" },
    });
    const trailSpec = buildCommandCenterTrailTabSpec({
      activity: view.activity,
      runtimeEvents: [],
      copy: { activityTitle: "Execution activity", activityEmpty: "Activity will appear after planning or execution starts." },
      toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" },
    });

    const outputResult = validateChronaSpec(outputSpec);
    const trailResult = validateChronaSpec(trailSpec);
    expect(outputResult).toMatchObject({ ok: true });
    expect(trailResult).toMatchObject({ ok: true });
  });
});
