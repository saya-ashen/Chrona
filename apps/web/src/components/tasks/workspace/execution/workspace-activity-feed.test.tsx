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
    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(screen.getByText("Live answer")).toBeInTheDocument();
    expect(screen.getByText("Answer user")).toBeInTheDocument();
    expect(screen.getByText("Read plan completed")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("renders reasoning as expandable details", () => {
    render(<WorkspaceActivityFeed activity={[
      activity({ id: "reasoning", kind: "reasoning", title: "Reasoning", summary: "Hidden thought", assistant: { text: "Hidden thought", isReasoning: true } }),
    ]} />);

    expect(screen.getByText("Reasoning details")).toBeInTheDocument();
    expect(screen.getByText("Hidden thought")).toBeInTheDocument();
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

    fireEvent.click(screen.getAllByRole("button", { name: "Show tool details" })[0]);

    expect(screen.getByText("taskId=task-1")).toBeInTheDocument();
    expect(screen.getByText("Loading nodes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide tool details" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Show tool details" })[0]);
    expect(screen.getByText("128ms")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Show tool details" })[0]);
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
});
