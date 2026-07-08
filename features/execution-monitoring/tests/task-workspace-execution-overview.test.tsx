import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildCommandCenterTrailSpec, validateChronaSpec, type UiDocument } from "@chrona/ui-protocol";
import { createTaskWorkspaceExecutionConsoleView } from "../../task-workspace";
import { taskWorkspaceStateFixtures } from "../../../apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures";
import { TaskWorkspaceExecutionOverview } from "../ui/task-workspace-execution-overview";
import { buildCommandCenterOutputTabSpec, buildCommandCenterTrailTabSpec } from "../ui/build-execution-overview-spec";

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class ELKMock {
    layout(graph: unknown) {
      return Promise.resolve(graph);
    }
  },
}));

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
      nodes={view.graphPlan?.nodes ?? []}
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
    expect(screen.getByRole("heading", { name: "Execution Result" })).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("AI generated")).toBeInTheDocument();
    expect(screen.getAllByText("Runtime state").length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Execution progress" })).not.toBeInTheDocument();
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

  it("keeps running status out of Results while activity stream stays live", () => {
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

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("Running now")).not.toBeInTheDocument();
    expect(screen.getByText("Writing report")).toBeInTheDocument();
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

    const { rerender } = renderOverview(view, { commandCenter, runtimeEvents: [], currentExecution: { status: "running" } });
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
        currentExecution={{ status: "running" }}
        runtimeEvents={[liveEvent]}
      />,
    );
    expect(screen.getByText("Activity")).toBeInTheDocument();

    return waitFor(() => expect(screen.getAllByText("正在读取计划").length).toBeGreaterThan(0));
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

    expect(screen.getByRole("heading", { name: "Execution Result" })).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "Execution Result" })).toBeInTheDocument();
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
  it("filters output and artifacts by selected result node", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.completed);
    const commandCenter = {
      documents: {
        now: nowDocument("Execution completed"),
        trail: buildCommandCenterTrailSpec({ activity: [], savedCount: 0, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }),
        output: {
          root: "root",
          elements: {
            root: { type: "Stack", props: { gap: "sm" }, children: ["node-a-output", "node-b-output"] },
            "node-a-output": { type: "Markdown", props: { content: "Alpha result", xChronaSourceNodeId: "node-a" }, children: [] },
            "node-b-output": { type: "Markdown", props: { content: "Beta result", xChronaSourceNodeId: "node-b" }, children: [] },
          },
        } satisfies UiDocument,
      },
    };

    renderOverview(view, {
      nodes: [
        { id: "node-a", title: "Alpha node", objective: "Alpha", phase: "One", status: "done" },
        { id: "node-b", title: "Beta node", objective: "Beta", phase: "Two", status: "done" },
      ],
      commandCenter,
      artifacts: [
        { id: "artifact-a", title: "Alpha artifact", type: "file", uri: "file://alpha", sourceNodeId: "node-a" },
        { id: "artifact-b", title: "Beta artifact", type: "file", uri: "file://beta", sourceNodeId: "node-b" },
      ],
    });

    expect(screen.getByText("Alpha result")).toBeInTheDocument();
    expect(screen.getByText("Beta result")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Filter results by node" }));
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
          root: { type: "Stack", props: { gap: "sm" }, children: ["intro", "alpha", "beta"] },
          intro: { type: "Markdown", props: { content: "Shared overview" }, children: [] },
          alpha: { type: "Markdown", props: { content: "Alpha result", xChronaSourceNodeId: "node-a" }, children: [] },
          beta: { type: "Markdown", props: { content: "Beta result", xChronaSourceNodeId: "node-b" }, children: [] },
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
    const sections = rootChildren.filter((key) => outputSpec.elements[key]?.type === "NodeResultSection");
    expect(sections).toHaveLength(2);
    expect(outputSpec.elements[sections[0]]?.props).toMatchObject({ nodeId: "node-a", nodeTitle: "Alpha node", defaultCollapsed: false });
    expect(outputSpec.elements[sections[0]]?.children).toEqual(["output:alpha"]);
    expect(outputSpec.elements[sections[1]]?.props).toMatchObject({ nodeId: "node-b", nodeTitle: "Beta node", defaultCollapsed: false });
    expect(outputSpec.elements["output:alpha"]?.props).toMatchObject({ defaultCollapsed: false });
    expect(outputSpec.elements["output:beta"]?.props).toMatchObject({ defaultCollapsed: false });
    expect(validateChronaSpec(outputSpec)).toMatchObject({ ok: true });
  });

  it("wraps unscoped single-node output in a host-owned node section", () => {
    const outputSpec = buildCommandCenterOutputTabSpec({
      latestCompletedNode: null,
      resultSpec: {
        root: "root",
        elements: {
          root: { type: "Stack", props: { gap: "sm" }, children: ["summary", "positions"] },
          summary: { type: "ResultSummary", props: { text: "Collected PhD positions" }, children: [] },
          positions: { type: "Card", props: { title: "岗位清单", defaultCollapsed: false }, children: ["table"] },
          table: { type: "Markdown", props: { content: "| Role | Deadline |\n| --- | --- |" }, children: [] },
        },
      },
      artifacts: [],
      copy: { noResultYet: "No output yet." },
      selectedNodeId: "all",
      nodeOptions: [{ id: "node-1", title: "搜集并整理AI方向PhD岗位", status: "done" }],
      outputOwnerNodeId: "node-1",
    });

    const rootChildren = outputSpec.elements.root.children ?? [];
    expect(rootChildren).toHaveLength(1);
    const section = outputSpec.elements[rootChildren[0]!];
    expect(section?.type).toBe("NodeResultSection");
    expect(section?.props).toMatchObject({ nodeId: "node-1", nodeTitle: "搜集并整理AI方向PhD岗位", defaultCollapsed: false, itemCount: 2 });
    expect(section?.children).toEqual(["output:summary", "output:positions"]);
    expect(outputSpec.elements["output:positions"]?.props).toMatchObject({ defaultCollapsed: false });
    expect(validateChronaSpec(outputSpec)).toMatchObject({ ok: true });
  });

  it("accepts Card defaultCollapsed as presentation metadata", () => {
    expect(validateChronaSpec({
      root: "root",
      elements: {
        root: { type: "Card", props: { title: "Details", defaultCollapsed: true }, children: ["body"] },
        body: { type: "Text", props: { text: "Hidden until expanded" } },
      },
    })).toMatchObject({ ok: true });
  });

  it("lets AI-authored Card defaultCollapsed drive Chrona-owned collapse chrome", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.completed);
    const { container } = renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution completed"),
          trail: buildCommandCenterTrailSpec({ activity: [], savedCount: 0, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }),
          output: {
            root: "root",
            elements: {
              root: { type: "Stack", props: { gap: "sm" }, children: ["details", "open"] },
              details: { type: "Card", props: { title: "Secondary evidence", defaultCollapsed: true }, children: ["body"] },
              body: { type: "Markdown", props: { content: "Evidence details" }, children: [] },
              open: { type: "Card", props: { title: "Primary details", defaultCollapsed: false }, children: ["open-body"] },
              "open-body": { type: "Markdown", props: { content: "Visible details" }, children: [] },
            },
          },
        },
      },
    });

    expect(screen.getByRole("button", { name: /Secondary evidence/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Evidence details")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Primary details/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Secondary evidence/ }).closest("section")).toHaveClass("w-full");
    expect(container.querySelector('[data-slot="card"]')).not.toBeInTheDocument();
    expect(screen.getByText("Visible details")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Secondary evidence/ }));

    expect(screen.getByText("Evidence details")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(screen.queryByRole("button", { name: /Secondary evidence/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Primary details/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Evidence details")).not.toBeInTheDocument();
    expect(screen.queryByText("Visible details")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand all" }));

    expect(screen.getByRole("button", { name: /Secondary evidence/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Primary details/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Evidence details")).toBeInTheDocument();
    expect(screen.getByText("Visible details")).toBeInTheDocument();
  });

  it("collapses the whole FileRef block separately from file preview expansion", async () => {
    const user = userEvent.setup();
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.completed);
    renderOverview(view, {
      commandCenter: {
        documents: {
          now: nowDocument("Execution completed"),
          trail: buildCommandCenterTrailSpec({ activity: [], savedCount: 0, toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" } }),
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
    expect(screen.queryByText(".chrona/outputs/node-1/log.txt")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Raw log/ }));

    expect(screen.getByText(".chrona/outputs/node-1/log.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview/ })).toBeInTheDocument();
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
