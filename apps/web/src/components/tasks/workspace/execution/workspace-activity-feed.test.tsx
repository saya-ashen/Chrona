import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceActivityFeed } from "./workspace-activity-feed";
import type { WorkspaceActivityItem } from "../model/task-workspace-types";

function activity(overrides: Partial<WorkspaceActivityItem> & Pick<WorkspaceActivityItem, "id" | "kind">): WorkspaceActivityItem {
  return {
    title: overrides.title ?? overrides.id,
    summary: overrides.summary ?? overrides.id,
    description: overrides.description ?? overrides.summary ?? overrides.id,
    tone: overrides.tone ?? "neutral",
    timestamp: overrides.timestamp ?? "2026-05-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkspaceActivityFeed", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders task-wide persisted and live activity with node context", () => {
    render(
      <WorkspaceActivityFeed
        activity={[
          activity({ id: "persisted-tool", kind: "tool_completed", title: "Tool completed", summary: "Read plan completed", tone: "success", sourceNodeTitle: "Read plan", tool: { label: "chrona_plan_read", state: "completed" } }),
        ]}
        runtimeEvents={[{
          type: "runtime_event",
          action: "start_manual",
          nodeId: "answer",
          nodeTitle: "Answer user",
          runtimeName: "hermes",
          provider: "anthropic",
          runId: "run-1",
          sequence: 2,
          timestamp: "2026-05-21T00:01:00.000Z",
          event: { type: "assistant_text_delta", text: "Live answer" },
        }]}
      />,
    );

    expect(screen.getByText("Execution activity")).toBeInTheDocument();
    expect(screen.getAllByText("anthropic")).toHaveLength(2);
    expect(screen.getByText("Live answer")).toBeInTheDocument();
    expect(screen.getByText("Answer user")).toBeInTheDocument();
    expect(screen.getByText("Read plan completed")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("renders reasoning as expandable details", () => {
    render(<WorkspaceActivityFeed activity={[
      activity({ id: "reasoning", kind: "reasoning", title: "Reasoning", summary: "Hidden thought", assistant: { text: "Hidden thought", isReasoning: true } }),
    ]} />);

    expect(screen.getByText("Hidden thought")).toBeInTheDocument();
  });

  it("groups plan generation events into a collapsible phase", () => {
    render(<WorkspaceActivityFeed activity={[
      activity({ id: "start", kind: "task", title: "Execution Started", summary: "plan_execution.execution_started", timestamp: "2026-05-21T00:00:00.000Z", rawEventType: "plan_execution.execution_started" }),
      activity({ id: "ctx", kind: "raw", title: "Loading task context", summary: "Loading task context...", tone: "neutral", timestamp: "2026-05-21T00:01:00.000Z", rawEventType: "plan_generation.context_loading" }),
      activity({ id: "ai", kind: "raw", title: "AI is thinking", summary: "AI is thinking...", tone: "neutral", timestamp: "2026-05-21T00:01:01.000Z", rawEventType: "plan_generation.ai_thinking" }),
      activity({ id: "done", kind: "provider_run", title: "Plan generated", summary: "获取今天的 GitHub Trending", tone: "success", timestamp: "2026-05-21T00:01:02.000Z", rawEventType: "plan_generation.completed" }),
    ]} />);

    expect(screen.getByText("Planning phase")).toBeInTheDocument();
    expect(screen.getByText("3 events · 2.0s")).toBeInTheDocument();
    expect(screen.getByText("Loading task context...")).toBeInTheDocument();
    expect(screen.getByText("AI is thinking...")).toBeInTheDocument();
    expect(screen.getByText("Plan generated")).toBeInTheDocument();
    expect(screen.getByText("Execution Started")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Planning phase/i }));

    expect(screen.queryByText("Loading task context...")).not.toBeInTheDocument();
    expect(screen.getByText("Planning phase completed · 3 events · 2.0s")).toBeInTheDocument();
  });

  it("groups plan generation events by activity group across interleaved activity", () => {
    const group = { kind: "plan_generation" as const, id: "generation-1" };
    render(<WorkspaceActivityFeed activity={[
      activity({ id: "done", kind: "task", title: "Plan generated", summary: "Plan ready", tone: "success", timestamp: "2026-05-21T00:01:02.000Z", rawEventType: "plan_generation.completed", activityGroup: group }),
      activity({ id: "refresh", kind: "task", title: "Task Workspace Updated", summary: "plan_generation.status", timestamp: "2026-05-21T00:01:01.500Z", rawEventType: "task_workspace_updated" }),
      activity({ id: "status", kind: "task", title: "Plan generation update", summary: "Using browser_console...", timestamp: "2026-05-21T00:01:01.000Z", rawEventType: "plan_generation.status", activityGroup: group }),
      activity({ id: "accepted", kind: "task", title: "Command accepted", summary: "plan.generate", timestamp: "2026-05-21T00:01:00.500Z", rawEventType: "command.accepted" }),
      activity({ id: "started", kind: "task", title: "Plan generation started", summary: "Generating a task plan.", timestamp: "2026-05-21T00:01:00.000Z", rawEventType: "plan_generation.started", activityGroup: group }),
    ]} />);

    expect(screen.getAllByText("Planning phase")).toHaveLength(1);
    expect(screen.getByText("3 events · 2.0s")).toBeInTheDocument();
    expect(screen.getByText("Task Workspace Updated")).toBeInTheDocument();
    expect(screen.getByText("Command accepted")).toBeInTheDocument();
  });

  it("renders started, completed, and failed tool details with expansion", () => {
    render(<WorkspaceActivityFeed activity={[
      activity({ id: "started", kind: "tool_started", title: "Tool started", summary: "Read plan", tone: "info", timestamp: "2026-05-21T00:02:00.000Z", tool: { name: "chrona_plan_read", label: "Read plan", inputSummary: "taskId=task-1", preview: "Loading nodes", state: "started" } }),
      activity({ id: "completed", kind: "tool_completed", title: "Tool completed", summary: "Write done", tone: "success", timestamp: "2026-05-21T00:01:00.000Z", tool: { name: "chrona_plan_write", label: "Write plan", durationMs: 128, state: "completed" } }),
      activity({ id: "failed", kind: "tool_completed", title: "Tool failed", summary: "Fetch failed", tone: "danger", timestamp: "2026-05-21T00:00:00.000Z", tool: { name: "chrona_fetch", label: "Fetch", error: "Timeout", state: "failed" } }),
    ]} />);

    expect(screen.getByText("started")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();

    // Spec path renders tool details inline — no toggle button needed.
    expect(screen.getByText("taskId=task-1")).toBeInTheDocument();
    expect(screen.getByText("Loading nodes")).toBeInTheDocument();
    expect(screen.getByText("128ms")).toBeInTheDocument();
    expect(screen.getByText("Timeout")).toBeInTheDocument();
  });

  it("renders load older activity control", () => {
    const onLoadOlder = vi.fn();
    render(<WorkspaceActivityFeed
      activity={[activity({ id: "event", kind: "task", title: "Task updated", summary: "Updated" })]}
      hasOlderActivity
      onLoadOlder={onLoadOlder}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Load older activity" }));

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("disables load older activity while loading", () => {
    render(<WorkspaceActivityFeed
      activity={[activity({ id: "event", kind: "task", title: "Task updated", summary: "Updated" })]}
      hasOlderActivity
      isLoadingOlder
      onLoadOlder={() => undefined}
    />);

    expect(screen.getByRole("button", { name: "Loading older activity..." })).toBeDisabled();
  });

  it("renders the feed through the json-render spec path", () => {
    render(<WorkspaceActivityFeed
      activity={[activity({
        id: "c",
        kind: "tool_completed",
        title: "Tool completed",
        summary: "Read plan completed",
        tone: "success",
        sourceNodeTitle: "Read plan",
        timestamp: "2026-05-21T09:30:00.000Z",
        tool: { label: "chrona_plan_read", inputSummary: "taskId=task-1", state: "completed" },
      })]}
    />);

    expect(screen.getByText("Tool completed")).toBeInTheDocument();
    expect(screen.getByText("Read plan completed")).toBeInTheDocument();
    expect(screen.getByText("Read plan")).toBeInTheDocument(); // source-node badge
    expect(screen.getByText("completed")).toBeInTheDocument(); // tool-state badge
    expect(screen.getByText("09:30:00")).toBeInTheDocument(); // derived time label
    expect(screen.getByText("taskId=task-1")).toBeInTheDocument(); // ToolDetails row value
  });

  it("omits tool detail rows in compact density", () => {
    render(<WorkspaceActivityFeed
      density="compact"
      activity={[activity({
        id: "c",
        kind: "tool_completed",
        title: "Tool completed",
        summary: "Read plan completed",
        tone: "success",
        sourceNodeTitle: "Read plan",
        tool: { label: "chrona_plan_read", inputSummary: "taskId=task-1", preview: "Loaded", state: "completed" },
      })]}
    />);

    expect(screen.getByText("Read plan completed")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.queryByText("taskId=task-1")).not.toBeInTheDocument();
    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();
  });
});
