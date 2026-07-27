import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildCommandCenterTrailSpec,
  validateChronaSpec,
  type UiDocument,
} from "@chrona/ui-protocol";
import { createTaskWorkspaceExecutionConsoleView } from "@features/task-workspace";
import { executionMonitoringWorkspaceFixtures } from "./execution-monitoring-test-fixtures";
import { TaskWorkspaceExecutionOverview } from "../ui/task-workspace-execution-overview";
import {
  buildCommandCenterOutputTabSpec,
  buildCommandCenterTrailTabSpec,
} from "../ui/build-execution-overview-spec";

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class ELKMock {
    layout(graph: unknown) {
      return Promise.resolve(graph);
    }
  },
}));

function renderOverview(
  view: ReturnType<typeof createTaskWorkspaceExecutionConsoleView>,
  extra: Partial<
    React.ComponentProps<typeof TaskWorkspaceExecutionOverview>
  > = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TaskWorkspaceExecutionOverview
      taskId="task-1"
      progress={view.progress}
      readiness={view.readiness}
      latestResult={view.latestResult}
      attention={view.attention}
      nodes={view.graphPlan?.nodes ?? []}
      latestCompletedNode={view.latestCompletedNode}
      artifacts={view.artifacts}
      activity={view.activity}
      {...extra}
    />,
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
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
    window.localStorage.clear();
  });

  it("keeps approval waits in stage results instead of final result", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.approvalNeeded,
    );
    renderOverview(view, {
      currentExecution: { status: "waiting_for_approval" } as never,
    });

    expect(screen.getByRole("heading", { name: "Stage results" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Final result" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Execution is producing output" })).not.toBeInTheDocument();
    expect(screen.queryByText("AI is working")).not.toBeInTheDocument();
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);
  });

  it("shows a persisted node error even when Activity has no danger event", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );
    renderOverview(view, {
      activity: [],
      nodes: [{
        id: "search-jobs",
        title: "Find matching PhD roles",
        objective: "Find matching roles",
        phase: "Execution",
        status: "failed",
        metadata: {
          error: "Provider run was cancelled before recording a Chrona terminal result action",
        },
      }],
      currentExecution: {
        status: "failed",
        planOutput: undefined,
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Run had a failure");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Provider run was cancelled before recording a Chrona terminal result action",
    );
  });

  it("does not promote a recovered tool failure after execution completes", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );
    renderOverview(view, {
      activity: [{
        id: "read-failed",
        kind: "tool_completed",
        title: "Read failed",
        summary: "Invalid selector ':'",
        description: "The read command used an invalid selector and execution recovered.",
        tone: "danger",
        timestamp: "2026-07-19T10:26:27.509Z",
      }],
      currentExecution: {
        status: "completed",
        planOutput: undefined,
      },
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows finalization failure with retry instead of validated-result labeling", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.artifactPresent,
    );

    renderOverview(view, {
      currentExecution: {
        status: "completed",
        planOutput: {
          manifest: {
            schemaVersion: 1,
            sourceRevision: 3,
            outcome: { title: "", summary: "" },
            readiness: { status: "partial", summary: "" },
            deliverables: [], findings: [], decisions: [],
            caveats: [], nextActions: [], evidence: [],
          },
          finalizedResult: null,
          revision: 3,
          updatedAt: null,
          updatedByNodeId: null,
          finalization: {
            status: "Failed",
            sourceRevision: 3,
            attempt: 1,
            failedAt: "2026-07-26T00:00:00.000Z",
            errorCode: "RESULT_FINALIZATION_FAILED",
            errorMessage: "Invalid result schema",
          },
        },
      },
      onRetryFinalization: retry,
    });

    expect(screen.getByRole("heading", { name: "Final result unavailable" })).toBeInTheDocument();
    expect(screen.getByText("Finalization failed")).toBeInTheDocument();
    expect(screen.queryByText("AI generated")).not.toBeInTheDocument();
    expect(screen.queryByText("Validated output from task execution.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry finalization" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps completed transcript prominent without competing with the result", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.approvalNeeded,
    );
    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument(),
          output: nowDocument("Output"),
          trail: nowDocument("Trail"),
        },
      },
      currentExecution: {
        status: "completed",
        planOutput: {
          manifest: {
            schemaVersion: 1,
            sourceRevision: 1,
            outcome: { title: "", summary: "" },
            readiness: { status: "ready", summary: "" },
            deliverables: [], findings: [], decisions: [],
            caveats: [], nextActions: [], evidence: [],
          },
          finalizedResult: null,
          revision: 1,
          updatedAt: null,
          updatedByNodeId: null,
          finalization: {
            status: "Ready",
            sourceRevision: 1,
            attempt: 1,
            finalizedAt: "2026-07-26T00:00:00.000Z",
          },
        },
      },
    });

    expect(
      screen.getAllByLabelText("Execution overview").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: "Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Results" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Final result" }),
    ).toBeInTheDocument();
    const transcriptButton = screen.getByRole("button", { name: /Open Agent transcript/ });
    expect(transcriptButton).toHaveAccessibleName(new RegExp(`${view.activity.length} events`));
    expect(transcriptButton).toHaveClass("fixed", "right-0");
    await user.click(transcriptButton);
    expect(screen.getByRole("dialog", { name: "Agent transcript" })).toBeInTheDocument();
    expect(screen.getByText(/Intent, tool calls, results/)).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("AI generated")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Execution progress" }),
    ).not.toBeInTheDocument();
  });

  it("shows tool input, intent, progress, and result in the completed transcript", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.approvalNeeded,
    );
    renderOverview(view, {
      runtimeEvents: [
        {
          type: "runtime_event",
          action: "start_manual",
          runtimeName: "omp",
          provider: "omp",
          runId: "run-1",
          sequence: 1,
          timestamp: "2026-05-12T10:00:00.000Z",
          event: { type: "tool_started", toolName: "read", callId: "call-1", label: "Read", inputSummary: '{\n  "path": "src/app.ts"\n}', preview: "Inspect application source" },
        },
        {
          type: "runtime_event",
          action: "start_manual",
          runtimeName: "omp",
          provider: "omp",
          runId: "run-1",
          sequence: 2,
          timestamp: "2026-05-12T10:00:01.000Z",
          event: { type: "tool_progress", toolName: "read", callId: "call-1", label: "Read", preview: "Loaded 42 lines" },
        },
        {
          type: "runtime_event",
          action: "start_manual",
          runtimeName: "omp",
          provider: "omp",
          runId: "run-1",
          sequence: 3,
          timestamp: "2026-05-12T10:00:02.000Z",
          event: { type: "tool_completed", toolName: "read", callId: "call-1", label: "Read", preview: "export const ready = true;" },
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: /Open Agent transcript/ }));
    const dialog = screen.getByRole("dialog", { name: "Agent transcript" });
    expect(within(dialog).getByText(/src\/app\.ts/)).toBeInTheDocument();
    expect(within(dialog).getByText("Inspect application source")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "View all technical details" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "View all technical details" }));
    expect(within(dialog).getByText("Loaded 42 lines")).toBeInTheDocument();
    expect(within(dialog).getAllByText("export const ready = true;").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });

  it("makes running Activity primary with responsive tabs and a desktop timeline", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );
    renderOverview(view, {
      activityLayout: "side",
      commandCenter: {
        documents: {
          now: nowDocument(),
          output: nowDocument("Output"),
          trail: buildCommandCenterTrailSpec({
            activity: [
              {
                id: "tool",
                kind: "tool_completed",
                title: "Tool completed",
                summary: "Read plan",
                description: "Read plan",
                tone: "success",
                tool: {
                  label: "Read plan",
                  state: "completed",
                  durationMs: 128,
                },
              },
            ],
            savedCount: 1,
            toolLabels: {
              tool: "Tool",
              input: "Input",
              preview: "Preview",
              duration: "Duration",
              error: "Error",
            },
          }),
        },
      },
      currentExecution: { status: "running" },
      isExecutionRunning: true,
    });

    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("data-state", "active");
    expect(screen.getAllByText(/events · live/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Read plan").length).toBeGreaterThan(0);
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getAllByText("Agent transcript").length).toBeGreaterThan(0);
  });

  it("renders persisted server-driven Trail items once", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );
    const commandCenter = {
      documents: {
        now: nowDocument("Execution running"),
        output: nowDocument("Output"),
        trail: buildCommandCenterTrailSpec({
          activity: [
            {
              id: "persisted-plan-status",
              kind: "task",
              title: "Plan generation update",
              summary: "Requesting AI provider...",
              description: "Requesting AI provider...",
              tone: "info",
              timestamp: "2026-05-12T10:00:00.000Z",
            },
          ],
          savedCount: 1,
          toolLabels: {
            tool: "Tool",
            input: "Input",
            preview: "Preview",
            duration: "Duration",
            error: "Error",
          },
        }),
      },
    };

    renderOverview(view, {
      commandCenter,
      currentExecution: { status: "running" },
      isExecutionRunning: true,
    });

    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("data-state", "active");
    expect(screen.getAllByText("Plan generation update").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Requesting AI provider...").length).toBeGreaterThan(0);
  });

  it("omits implementation statistics and audit-group chrome from Activity specs", () => {
    const trail = buildCommandCenterTrailTabSpec({
      activity: [{
        id: "tool",
        kind: "tool_completed",
        title: "Tool completed",
        summary: "Read plan",
        description: "Read plan",
        tone: "success",
      }],
      runtimeEvents: [],
      copy: { activityTitle: "Activity" },
      toolLabels: {
        tool: "Tool",
        input: "Input",
        preview: "Preview",
        duration: "Duration",
        error: "Error",
      },
    });

    expect(trail.elements.groups).toBeUndefined();
    expect(trail.elements.stats).toBeUndefined();
    expect(trail.elements.title).toBeUndefined();
    validateChronaSpec(trail);
  });

  it("keeps running status out of Results while activity stream stays live", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );
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
      event: {
        type: "tool_started" as const,
        toolName: "chrona_report_write",
        label: "Writing report",
        preview: "Generating report sections",
        inputSummary: '{"section":"architecture"}',
      },
    };

    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution running"),
          output: nowDocument("Output"),
          trail: buildCommandCenterTrailSpec({
            activity: [],
            savedCount: 0,
            toolLabels: {
              tool: "Tool",
              input: "Input",
              preview: "Preview",
              duration: "Duration",
              error: "Error",
            },
          }),
        },
      },
      runtimeEvents: [liveEvent],
      currentExecution: { status: "running" },
    });

    const currentActivity = screen.getByRole("status", { name: "Execution is producing output" });
    expect(currentActivity).toHaveTextContent("Writing report");
    expect(currentActivity).toHaveTextContent("Generating report sections");
    expect(currentActivity).toHaveTextContent('{"section":"architecture"}');
    expect(currentActivity).not.toHaveTextContent("Step: Generate report");
  });

  it("renders the complete live tool process in Activity", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );
    renderOverview(view, {
      runtimeEvents: [
        {
          type: "runtime_event",
          action: "start_manual",
          nodeId: "execute",
          nodeTitle: "Review architecture",
          runtimeName: "hermes",
          provider: "omp",
          runId: "run-1",
          sequence: 1,
          timestamp: "2026-05-12T10:01:00.000Z",
          event: { type: "tool_started", toolName: "task", label: "task", preview: "Parallelizing audit tracks" },
        },
        {
          type: "runtime_event",
          action: "start_manual",
          nodeId: "execute",
          nodeTitle: "Review architecture",
          runtimeName: "hermes",
          provider: "omp",
          runId: "run-1",
          sequence: 2,
          timestamp: "2026-05-12T10:01:01.000Z",
          event: { type: "tool_progress", toolName: "task", label: "task", preview: "Reviewer is inspecting persistence boundaries" },
        },
        {
          type: "runtime_event",
          action: "start_manual",
          nodeId: "execute",
          nodeTitle: "Review architecture",
          runtimeName: "omp",
          provider: "omp",
          runId: "run-1",
          sequence: 3,
          timestamp: "2026-05-12T10:01:02.000Z",
          event: { type: "raw_event", rawEventType: "turn_start", message: "Agent turn started." },
        },
      ],
      currentExecution: { status: "running" },
      isExecutionRunning: true,
    });

    expect(screen.getAllByText("Reviewer is inspecting persistence boundaries").length).toBeGreaterThan(0);
    expect(screen.queryByText("Agent turn started.")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("data-state", "active");
  });

  it("updates stage results from assistant output while execution is running", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );

    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution running"),
          output: nowDocument("Output"),
          trail: buildCommandCenterTrailSpec({
            activity: [],
            savedCount: 0,
            toolLabels: {
              tool: "Tool",
              input: "Input",
              preview: "Preview",
              duration: "Duration",
              error: "Error",
            },
          }),
        },
      },
      runtimeEvents: [
        {
          type: "runtime_event",
          action: "start_manual",
          nodeId: "execute",
          nodeTitle: "Generate report",
          runtimeName: "hermes",
          provider: "hermes",
          runId: "run-1",
          sequence: 1,
          timestamp: "2026-05-12T10:01:00.000Z",
          event: { type: "assistant_text_delta", text: "First paragraph. " },
        },
        {
          type: "runtime_event",
          action: "start_manual",
          nodeId: "execute",
          nodeTitle: "Generate report",
          runtimeName: "hermes",
          provider: "hermes",
          runId: "run-1",
          sequence: 2,
          timestamp: "2026-05-12T10:01:01.000Z",
          event: { type: "assistant_text_delta", text: "Second paragraph." },
        },
      ],
      currentExecution: { status: "running" },
      isExecutionRunning: true,
      executionResultState: "waiting",
    });

    const results = screen.getByRole("region", { name: "Stage results" });
    expect(results).toHaveTextContent("First paragraph. Second paragraph.");
    expect(results).toHaveTextContent("Results available");
    expect(screen.queryByRole("note", { name: "Current step result pending" })).not.toBeInTheDocument();
  });

  it("explains that stage results are pending while activity stays live", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );

    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution ready"),
          output: nowDocument("Output"),
          trail: buildCommandCenterTrailSpec({
            activity: [],
            savedCount: 0,
            toolLabels: {
              tool: "Tool",
              input: "Input",
              preview: "Preview",
              duration: "Duration",
              error: "Error",
            },
          }),
        },
      },
      currentExecution: { status: "started" },
      isExecutionRunning: true,
      executionResultState: "waiting",
    });

    expect(screen.getByRole("region", { name: "Stage results" })).toHaveTextContent("Waiting for output");
    const liveStatus = screen.getByRole("status", { name: "Execution is producing output" });
    expect(liveStatus).toHaveTextContent("AI is working");
    expect(liveStatus).toHaveTextContent("Working on the current step");
    expect(liveStatus.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("hides live status strip after completion even when stale activity looks active", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.completed,
    );
    const staleStarted = {
      id: "stale-tool-started",
      kind: "tool_started" as const,
      title: "Tool started",
      summary: "Writing report",
      description: "Writing report",
      tone: "info" as const,
      timestamp: "2026-05-12T10:01:00.000Z",
      tool: {
        name: "chrona_report_write",
        label: "Writing report",
        state: "started" as const,
      },
    };

    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution completed"),
          output: nowDocument("Output"),
          trail: buildCommandCenterTrailSpec({
            activity: [staleStarted],
            savedCount: 1,
            toolLabels: {
              tool: "Tool",
              input: "Input",
              preview: "Preview",
              duration: "Duration",
              error: "Error",
            },
          }),
        },
      },
      currentExecution: { status: "completed" },
      activity: [staleStarted],
    });

    expect(screen.queryByText("Running now")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Latest activity running"),
    ).not.toBeInTheDocument();
  });
  it("streams live runtime events into a server-driven Trail document", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );
    const commandCenter = {
      documents: {
        now: nowDocument("Execution running"),
        output: nowDocument("Output"),
        trail: buildCommandCenterTrailSpec({
          activity: [],
          savedCount: 0,
          toolLabels: {
            tool: "Tool",
            input: "Input",
            preview: "Preview",
            duration: "Duration",
            error: "Error",
          },
        }),
      },
    };
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
      event: {
        type: "tool_started" as const,
        toolName: "chrona_plan_read",
        label: "正在读取计划",
      },
    };

    const { rerender } = renderOverview(view, {
      commandCenter,
      runtimeEvents: [],
      currentExecution: { status: "running" },
    });
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
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
        currentExecution={{ status: "running" }}
        runtimeEvents={[liveEvent]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();

    return waitFor(() =>
      expect(screen.getAllByText("正在读取计划").length).toBeGreaterThan(0),
    );
  });

  it("streams live workspace events into a server-driven Trail document", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );
    const commandCenter = {
      documents: {
        now: nowDocument("Execution running"),
        output: nowDocument("Output"),
        trail: buildCommandCenterTrailSpec({
          activity: [],
          savedCount: 0,
          toolLabels: {
            tool: "Tool",
            input: "Input",
            preview: "Preview",
            duration: "Duration",
            error: "Error",
          },
        }),
      },
    };

    renderOverview(view, {
      commandCenter,
      liveActivity: [
        {
          id: "event-plan-status-1",
          kind: "task",
          title: "Plan generation update",
          summary: "Requesting AI provider...",
          description: "Requesting AI provider...",
          tone: "info",
          timestamp: "2026-05-12T10:00:00.000Z",
        },
      ],
      currentExecution: { status: "running" },
      isExecutionRunning: true,
    });
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();

    expect(screen.getAllByText("Plan generation update").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Requesting AI provider...").length).toBeGreaterThan(0);
  });

  it("renders finalized result and artifacts as primary results content", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.artifactPresent,
    );

    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution running"),
          output: nowDocument("Plan output"),
          trail: nowDocument("Trail"),
        },
      },
    });

    expect(
      screen.getByRole("heading", { name: "Final result" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Plan output")).toBeInTheDocument();
    expect(screen.queryByText("summary")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Locate source node" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByText("file://report.md")).toBeInTheDocument();
  });

  it("renders a completed node summary when finalized result is absent", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.running,
    );

    renderOverview(view, {
      latestCompletedNode: {
        id: "research",
        title: "Research target user",
        objective: "Complete workspace step",
        phase: "Execution",
        status: "done",
        completionSummary: "Research complete",
      },
      commandCenter: null,
      currentExecution: { status: "running" },
      isExecutionRunning: true,
      executionResultState: "available",
    });

    expect(screen.getByRole("region", { name: "Stage results" })).toHaveTextContent(
      "Research complete",
    );
    expect(screen.getByText("Results available")).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "Current step result pending" })).not.toBeInTheDocument();
  });


  it("does not render command center primary actions inside the execution panel", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.empty,
    );
    const onClick = vi.fn();
    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution running"),
          output: nowDocument("Output"),
          trail: nowDocument("Trail"),
        },
      },
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
    expect(
      screen.queryByRole("button", { name: "Generate plan" }),
    ).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders an empty output state when no node has completed", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.empty,
    );

    renderOverview(view);

    expect(
      screen.getByRole("heading", { name: "Final result" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No execution result yet.")).toBeInTheDocument();
  });

  it("hides the current operation card when there is nothing to act on", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.completed,
    );

    // No server now document, no attention, and a passive primary action
    // (suppressAttentionCard, no onClick/actionSpec) → the rail collapses.
    renderOverview(view, {
      attention: null,
      runtimeEvents: [],
      primaryAction: {
        kind: "no-operation",
        label: "No current operation",
        description:
          "The accepted plan is running, but the engine has not returned an actionable checkpoint yet.",
        tone: "neutral",
        suppressAttentionCard: true,
      },
    });

    expect(screen.queryByText("Current operation")).not.toBeInTheDocument();
    expect(screen.queryByText("No current operation")).not.toBeInTheDocument();
  });
  it("filters output and artifacts by selected result node", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.completed,
    );
    const commandCenter = {
      documents: {
        now: nowDocument("Execution completed"),
        trail: buildCommandCenterTrailSpec({
          activity: [],
          savedCount: 0,
          toolLabels: {
            tool: "Tool",
            input: "Input",
            preview: "Preview",
            duration: "Duration",
            error: "Error",
          },
        }),
        output: {
          root: "root",
          elements: {
            root: {
              type: "Stack",
              props: { gap: "sm" },
              children: ["node-a-output", "node-b-output"],
            },
            "node-a-output": { type: "RichMarkdown", props: { content: "Alpha result", xChronaSourceNodeId: "node-a" },
            children: [], },
            "node-b-output": { type: "RichMarkdown", props: { content: "Beta result", xChronaSourceNodeId: "node-b" },
            children: [], },
          },
        } satisfies UiDocument,
      },
    };

    renderOverview(view, {
      nodes: [
        {
          id: "node-a",
          title: "Alpha node",
          objective: "Alpha",
          phase: "One",
          status: "done",
        },
        {
          id: "node-b",
          title: "Beta node",
          objective: "Beta",
          phase: "Two",
          status: "done",
        },
      ],
      commandCenter,
      artifacts: [
        {
          id: "artifact-a",
          title: "Alpha artifact",
          type: "file",
          uri: "file://alpha",
          sourceNodeId: "node-a",
        },
        {
          id: "artifact-b",
          title: "Beta artifact",
          type: "file",
          uri: "file://beta",
          sourceNodeId: "node-b",
        },
      ],
    });

    expect(screen.getByText("Alpha result")).toBeInTheDocument();
    expect(screen.getByText("Beta result")).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "Filter results by node" }),
    );
    await user.click(screen.getByRole("option", { name: "Beta node" }));

    expect(screen.queryByText("Alpha result")).not.toBeInTheDocument();
    expect(screen.getByText("Beta result")).toBeInTheDocument();
    expect(screen.queryByText("Alpha artifact")).not.toBeInTheDocument();
    expect(screen.getByText("Beta artifact")).toBeInTheDocument();
  });

  it("builds host-owned node result sections around node-scoped output", () => {
    const outputSpec = buildCommandCenterOutputTabSpec({
      latestCompletedNode: null,
      resultSpec: {
        root: "root",
        elements: {
          root: {
            type: "Stack",
            props: { gap: "sm" },
            children: ["intro", "alpha", "beta"],
          },
          intro: { type: "RichMarkdown", props: { content: "Shared overview" },
          children: [], },
          alpha: { type: "RichMarkdown", props: { content: "Alpha result", xChronaSourceNodeId: "node-a" },
          children: [], },
          beta: { type: "RichMarkdown", props: { content: "Beta result", xChronaSourceNodeId: "node-b" },
          children: [], },
        },
      },
      artifacts: [],
      copy: { noResultYet: "No output yet." },
      selectedNodeId: "all",
      nodeOptions: [
        { id: "node-a", title: "Alpha node", status: "done" },
        { id: "node-b", title: "Beta node", status: "done" },
      ],
    });

    const rootChildren = outputSpec.elements.root.children ?? [];
    const sections = rootChildren.filter(
      (key) => outputSpec.elements[key]?.type === "NodeResultSection",
    );
    expect(sections).toHaveLength(2);
    expect(outputSpec.elements[sections[0]]?.props).toMatchObject({
      nodeId: "node-a",
      nodeTitle: "Alpha node",
      defaultCollapsed: false,
    });
    expect(outputSpec.elements[sections[0]]?.children).toEqual([
      "output:alpha",
    ]);
    expect(outputSpec.elements[sections[1]]?.props).toMatchObject({
      nodeId: "node-b",
      nodeTitle: "Beta node",
      defaultCollapsed: false,
    });
    expect(outputSpec.elements["output:alpha"]?.props).toMatchObject({
      defaultCollapsed: false,
    });
    expect(outputSpec.elements["output:beta"]?.props).toMatchObject({
      defaultCollapsed: false,
    });
    expect(validateChronaSpec(outputSpec)).toMatchObject({ ok: true });
  });

  it("wraps unscoped single-node output in a host-owned node section", () => {
    const outputSpec = buildCommandCenterOutputTabSpec({
      latestCompletedNode: null,
      resultSpec: {
        root: "root",
        elements: {
          root: {
            type: "Stack",
            props: { gap: "sm" },
            children: ["summary", "positions"],
          },
          summary: {
            type: "ResultSummary",
            props: { text: "Collected PhD positions" },
            children: [],
          },
          positions: {
            type: "Card",
            props: { title: "岗位清单", defaultCollapsed: false },
            children: ["table"],
          },
          table: { type: "RichMarkdown", props: { content: "| Role | Deadline |\n| --- | --- |" },
          children: [], },
        },
      },
      artifacts: [],
      copy: { noResultYet: "No output yet." },
      selectedNodeId: "all",
      nodeOptions: [
        { id: "node-1", title: "搜集并整理AI方向PhD岗位", status: "done" },
      ],
      outputOwnerNodeId: "node-1",
    });

    const rootChildren = outputSpec.elements.root.children ?? [];
    expect(rootChildren).toHaveLength(1);
    const section = outputSpec.elements[rootChildren[0]!];
    expect(section?.type).toBe("NodeResultSection");
    expect(section?.props).toMatchObject({
      nodeId: "node-1",
      nodeTitle: "搜集并整理AI方向PhD岗位",
      defaultCollapsed: false,
      itemCount: 2,
    });
    expect(section?.children).toEqual(["output:summary", "output:positions"]);
    expect(outputSpec.elements["output:positions"]?.props).toMatchObject({
      defaultCollapsed: false,
    });
    expect(validateChronaSpec(outputSpec)).toMatchObject({ ok: true });
  });

  it("accepts Card defaultCollapsed as presentation metadata", () => {
    expect(
      validateChronaSpec({
        root: "root",
        elements: {
          root: {
            type: "Card",
            props: { title: "Details", defaultCollapsed: true },
            children: ["body"],
          },
          body: { type: "Text", props: { text: "Hidden until expanded" } },
        },
      }),
    ).toMatchObject({ ok: true });
  });

  it("lets AI-authored Card defaultCollapsed drive Chrona-owned collapse chrome", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.completed,
    );
    const { container } = renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution completed"),
          trail: buildCommandCenterTrailSpec({
            activity: [],
            savedCount: 0,
            toolLabels: {
              tool: "Tool",
              input: "Input",
              preview: "Preview",
              duration: "Duration",
              error: "Error",
            },
          }),
          output: {
            root: "root",
            elements: {
              root: {
                type: "Stack",
                props: { gap: "sm" },
                children: ["details", "open"],
              },
              details: {
                type: "Card",
                props: { title: "Secondary evidence", defaultCollapsed: true },
                children: ["body"],
              },
              body: { type: "RichMarkdown", props: { content: "Evidence details" },
              children: [], },
              open: {
                type: "Card",
                props: { title: "Primary details", defaultCollapsed: false },
                children: ["open-body"],
              },
              "open-body": { type: "RichMarkdown", props: { content: "Visible details" },
              children: [], },
            },
          },
        },
      },
    });

    expect(
      screen.getByRole("button", { name: /Secondary evidence/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Evidence details")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Primary details/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen
        .getByRole("button", { name: /Secondary evidence/ })
        .closest("section"),
    ).toHaveClass("w-full");
    expect(
      container.querySelector('[data-slot="card"]'),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Visible details")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Secondary evidence/ }),
    );

    expect(screen.getByText("Evidence details")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Result options" }));
    await user.click(await screen.findByText("Collapse all"));

    expect(
      screen.getByRole("button", { name: /Deliver launch brief/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /Secondary evidence/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Evidence details")).not.toBeInTheDocument();
    expect(screen.queryByText("Visible details")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Result options" }));
    await user.click(await screen.findByText("Expand all"));

    expect(
      screen.getByRole("button", { name: /Secondary evidence/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /Primary details/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Evidence details")).toBeInTheDocument();
    expect(screen.getByText("Visible details")).toBeInTheDocument();
  });

  it("remembers result collapse state across workspace remounts", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.completed,
    );
    const commandCenter = {
      documents: {
        now: nowDocument("Execution completed"),
        trail: buildCommandCenterTrailSpec({
          activity: [],
          savedCount: 0,
          toolLabels: {
            tool: "Tool",
            input: "Input",
            preview: "Preview",
            duration: "Duration",
            error: "Error",
          },
        }),
        output: {
          root: "root",
          elements: {
            root: {
              type: "Stack",
              props: { gap: "sm" },
              children: ["details"],
            },
            details: {
              type: "Card",
              props: { title: "Persistent details", defaultCollapsed: false },
              children: ["body"],
            },
            body: { type: "RichMarkdown", props: { content: "Remembered body" },
            children: [], },
          },
        },
      },
    };

    const first = renderOverview(view, { commandCenter });
    expect(
      screen.getByRole("button", { name: /Persistent details/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Remembered body")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Persistent details/ }),
    );
    expect(
      screen.getByRole("button", { name: /Persistent details/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Remembered body")).not.toBeInTheDocument();

    first.unmount();
    renderOverview(view, { commandCenter });

    expect(
      screen.getByRole("button", { name: /Persistent details/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Remembered body")).not.toBeInTheDocument();
  });

  it("collapses the whole FileRef block separately from file preview expansion", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.completed,
    );
    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution completed"),
          trail: buildCommandCenterTrailSpec({
            activity: [],
            savedCount: 0,
            toolLabels: {
              tool: "Tool",
              input: "Input",
              preview: "Preview",
              duration: "Duration",
              error: "Error",
            },
          }),
          output: {
            root: "root",
            elements: {
              root: { type: "Stack", props: { gap: "sm" }, children: ["file"] },
              file: {
                type: "FileRef",
                props: {
                  path: ".chrona/outputs/node-1/log.txt",
                  title: "Raw log",
                  contentKind: "text",
                  contentPreview: `${"line\n".repeat(350)}`,
                  contentTruncated: true,
                  defaultCollapsed: true,
                },
                children: [],
              },
            },
          },
        },
      },
    });

    expect(screen.getByText("Raw log")).toBeInTheDocument();
    expect(
      screen.queryByText(".chrona/outputs/node-1/log.txt"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Preview/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Raw log/ }));

    expect(
      screen.getAllByText(".chrona/outputs/node-1/log.txt").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Preview/ })).toBeInTheDocument();
  });

  it("does not append artifacts when the API output already owns the artifact list", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.artifactPresent,
    );
    const apiArtifactsSpec: UiDocument = {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "sm" }, children: ["artifact-list"] },
        "artifact-list": {
          type: "WorkspaceArtifactList",
          props: { emptyLabel: "No artifacts" },
          children: ["api-artifact"],
        },
        "api-artifact": {
          type: "WorkspaceArtifactItem",
          props: { title: "API artifact", type: "file", uri: "artifact://api" },
        },
      },
    };

    const spec = buildCommandCenterOutputTabSpec({
      latestCompletedNode: view.latestCompletedNode,
      resultSpec: nowDocument("Result fallback"),
      artifacts: view.artifacts,
      apiArtifactsSpec,
      copy: {},
    });

    expect(
      Object.values(spec.elements).filter(
        (element) => element.type === "WorkspaceArtifactList",
      ),
    ).toHaveLength(1);
    expect(
      Object.values(spec.elements).filter(
        (element) => element.type === "WorkspaceArtifactItem",
      ),
    ).toHaveLength(1);
  });

  it("omits artifacts already represented by finalized deliverables", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.artifactPresent,
    );
    const artifact = view.artifacts[0];
    if (!artifact) throw new Error("Expected artifact fixture");
    const spec = buildCommandCenterOutputTabSpec({
      latestCompletedNode: view.latestCompletedNode,
      resultSpec: nowDocument("Result fallback"),
      artifacts: [{ ...artifact, artifactRef: "AFREPORT" }],
      apiArtifactsSpec: {
        root: "root",
        elements: {
          root: { type: "Stack", props: { gap: "sm" }, children: ["deliverable"] },
          deliverable: {
            type: "ResultDeliverable",
            props: {
              title: "Report",
              summary: "Final report",
              artifactRef: "AFREPORT",
              role: "primary",
              kind: "document",
            },
          },
        },
      },
      copy: {},
    });

    expect(
      Object.values(spec.elements).filter(
        (element) => element.type === "WorkspaceArtifactList",
      ),
    ).toHaveLength(0);
    expect(
      Object.values(spec.elements).filter(
        (element) => element.type === "ResultDeliverable",
      ),
    ).toHaveLength(1);
  });

  it("keeps only unrepresented artifacts in a collapsed secondary section", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.artifactPresent,
    );
    const artifact = view.artifacts[0];
    if (!artifact) throw new Error("Expected artifact fixture");
    const spec = buildCommandCenterOutputTabSpec({
      latestCompletedNode: view.latestCompletedNode,
      resultSpec: nowDocument("Result fallback"),
      artifacts: [
        { ...artifact, artifactRef: "AFREPORT" },
        {
          id: "extra-1",
          artifactRef: "AFEXTRA",
          title: "Supporting notes",
          type: "markdown",
          uri: "generated://supporting-notes.md",
        },
      ],
      apiArtifactsSpec: {
        root: "root",
        elements: {
          root: { type: "Stack", props: { gap: "sm" }, children: ["deliverable"] },
          deliverable: {
            type: "ResultDeliverable",
            props: {
              title: "Report",
              summary: "Final report",
              artifactRef: "AFREPORT",
              role: "primary",
              kind: "document",
            },
          },
        },
      },
      copy: {
        otherGeneratedFiles: "Other generated files",
        otherGeneratedFilesDescription: "Additional files",
      },
    });

    const artifactItems = Object.values(spec.elements).filter(
      (element) => element.type === "WorkspaceArtifactItem",
    );
    expect(artifactItems).toHaveLength(1);
    expect(artifactItems[0]?.props).toMatchObject({ title: "Supporting notes" });
    expect(
      Object.values(spec.elements).find(
        (element) => element.type === "CollapsibleBlock",
      )?.props,
    ).toMatchObject({
      title: "Other generated files",
      defaultCollapsed: true,
    });
  });

  it("builds valid output and trail fallback specs", () => {
    const view = createTaskWorkspaceExecutionConsoleView(
      executionMonitoringWorkspaceFixtures.artifactPresent,
    );
    const outputSpec = buildCommandCenterOutputTabSpec({
      latestCompletedNode: view.latestCompletedNode,
      resultSpec: nowDocument("Result fallback"),
      artifacts: view.artifacts,
      copy: {
        noResultYet: "No output yet.",
        noArtifacts: "No artifacts yet.",
        locateSourceNode: "Locate source node",
      },
    });
    const trailSpec = buildCommandCenterTrailTabSpec({
      activity: view.activity,
      runtimeEvents: [],
      copy: {
        activityTitle: "Execution activity",
        activityEmpty:
          "Activity will appear after planning or execution starts.",
      },
      toolLabels: {
        tool: "Tool",
        input: "Input",
        preview: "Preview",
        duration: "Duration",
        error: "Error",
      },
    });

    const outputResult = validateChronaSpec(outputSpec);
    const trailResult = validateChronaSpec(trailSpec);
    expect(outputResult).toMatchObject({ ok: true });
    expect(trailResult).toMatchObject({ ok: true });
  });
});
