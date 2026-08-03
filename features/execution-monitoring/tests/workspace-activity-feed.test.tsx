import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceActivityFeed } from "../ui/workspace-activity-feed";
import type { WorkspaceActivityItem } from "@features/task-workspace";

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

  it("renders persisted and live safe tool lifecycle activity with node context", () => {
    render(
      <WorkspaceActivityFeed
        activity={[
          activity({ id: "persisted-tool", kind: "tool_completed", title: "Tool completed", summary: "Provider tool completed.", tone: "success", sourceNodeTitle: "Read plan", tool: { label: "Read plan", state: "completed" } }),
        ]}
        runtimeEvents={[{
          type: "runtime_event",
          action: "start_manual",
          executionScope: "scope-1",
          nodeId: "answer",
          nodeTitle: "Answer user",
          runtime: { category: "runtime", label: "Execution runtime" },
          provider: { category: "ai_provider", label: "AI provider" },
          sequence: 2,
          timestamp: "2026-05-21T00:01:00.000Z",
          event: { type: "tool_started", tool: { category: "tool", label: "Runtime tool" }, label: "Write response" },
        }]}
      />,
    );

    expect(screen.getByText("Execution activity")).toBeInTheDocument();
    expect(screen.getAllByText("AI provider")).toHaveLength(1);
    expect(screen.getByText("Write response")).toBeInTheDocument();
    expect(screen.getByText("Answer user")).toBeInTheDocument();
    expect(screen.getByText("Provider tool completed.")).toBeInTheDocument();
  });

  it("groups plan generation events using safe activity group metadata", () => {
    const group = { kind: "plan_generation" as const, id: "generation-1" };
    render(<WorkspaceActivityFeed activity={[
      activity({ id: "done", kind: "task", title: "Plan generated", summary: "Plan ready", tone: "success", timestamp: "2026-05-21T00:01:02.000Z", activityGroup: group }),
      activity({ id: "status", kind: "task", title: "Plan generation update", summary: "Generating plan", timestamp: "2026-05-21T00:01:01.000Z", activityGroup: group }),
      activity({ id: "started", kind: "task", title: "Plan generation started", summary: "Generating a task plan.", timestamp: "2026-05-21T00:01:00.000Z", activityGroup: group }),
    ]} />);

    expect(screen.getAllByText("Planning phase")).toHaveLength(1);
    expect(screen.getByText("Plan generated")).toBeInTheDocument();
  });

  it("renders safe tool state and duration without tool payload details", () => {
    render(<WorkspaceActivityFeed activity={[
      activity({ id: "started", kind: "tool_started", title: "Tool started", summary: "Provider tool started.", tone: "info", tool: { name: "chrona_plan_read", label: "Read plan", state: "started" } }),
      activity({ id: "completed", kind: "tool_completed", title: "Tool completed", summary: "Provider tool completed.", tone: "success", tool: { name: "chrona_plan_write", label: "Write plan", durationMs: 128, state: "completed" } }),
      activity({ id: "failed", kind: "tool_completed", title: "Tool failed", summary: "Provider tool failed.", tone: "danger", tool: { name: "chrona_fetch", label: "Fetch", state: "failed" } }),
    ]} />);

    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("128ms")).toBeInTheDocument();
    expect(screen.queryByText("taskId=task-1")).not.toBeInTheDocument();
  });

  it("renders and invokes the Load older activity control for safe persisted activity", () => {
    const onLoadOlder = vi.fn();
    render(<WorkspaceActivityFeed activity={[
      activity({ id: "event", kind: "task", title: "Task updated", summary: "Updated" }),
    ]} hasOlderActivity onLoadOlder={onLoadOlder} />);

    fireEvent.click(screen.getByRole("button", { name: "Load older activity" }));
    expect(onLoadOlder).toHaveBeenCalledOnce();
  });

  it("uses safe lifecycle events in the rail", () => {
    render(<WorkspaceActivityFeed density="rail" active activity={[
      activity({ id: "provider", kind: "provider_run", title: "Provider run started", summary: "provider", tone: "info", timestamp: "2026-05-21T00:01:00.000Z" }),
      activity({ id: "tool", kind: "tool_started", title: "Tool started", summary: "Provider tool started.", tone: "info", timestamp: "2026-05-21T00:02:00.000Z", tool: { name: "chrona_result_write", label: "Writing result", state: "started" } }),
    ]} />);

    const spinnerRow = screen.getByLabelText("Latest activity running").closest("article");
    expect(spinnerRow).toHaveTextContent("Writing result");
  });
});
