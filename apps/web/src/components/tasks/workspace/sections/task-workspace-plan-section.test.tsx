import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class ELKMock {
    layout(graph: unknown) {
      return Promise.resolve(graph);
    }
  },
}));

vi.mock("@/components/tasks/panels/task-plan-graph-panel", () => ({
  TaskPlanGraphPanel: ({ plan, mode }: {
    plan: { nodes: Array<{ id: string; title: string }> };
    mode?: "full" | "compact";
  }) => (
    <div data-testid="task-plan-graph-panel" data-graph-mode={mode ?? "full"}>
      {plan.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className="react-flow__node"
          data-testid={`task-plan-node-${node.id}`}
          onClick={() => undefined}
        >
          {node.title}
        </button>
      ))}
    </div>
  ),
}));

import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import {
  createTaskWorkspaceFixtureGraph,
  createTaskWorkspaceFixtureNode,
  createTaskWorkspaceFixturePageData,
} from "../test-support/task-workspace-test-fixtures";

let TaskWorkspacePlanSection: typeof import("./task-workspace-plan-section").TaskWorkspacePlanSection;

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function renderPlanSection(overrides: Partial<React.ComponentProps<typeof TaskWorkspacePlanSection>> = {}) {
  return renderWithQueryClient(
    <TaskWorkspacePlanSection
      label="Plan"
      graphPlan={createTaskWorkspaceFixtureGraph([])}
      isGraphPlanPending={false}
      pageData={createTaskWorkspaceFixturePageData()}
      plan={null}
      planGenerationStatus="idle"
      acceptPlanError={null}
      runtimeEvents={[]}
      onGeneratePlan={vi.fn()}
      onApplyPlan={vi.fn()}
      onDispatchExecutionAction={vi.fn()}
      {...overrides}
    />,
  );
}

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ messages: {} }),
}));

beforeAll(async () => {
  ({ TaskWorkspacePlanSection } = await import("./task-workspace-plan-section"));

  class ResizeObserverMock {
    observe(target?: Element) {
      if (target) {
        Object.defineProperty(target, "clientWidth", {
          configurable: true,
          value: 960,
        });
      }
    }
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ generationSession: null }), {
    status: 404,
    headers: { "content-type": "application/json" },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("TaskWorkspacePlanSection", () => {
  it("renders plan graph without the execution console", () => {
    renderPlanSection();

    expect(screen.getByRole("region", { name: "Execution flow" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Task command center" })).not.toBeInTheDocument();
  });

  it("shows the plan-generation pending state without the execution console", () => {
    renderPlanSection({
      graphPlan: createTaskWorkspaceFixtureGraph([
        createTaskWorkspaceFixtureNode({ id: "planning", title: "Generating plan", status: "ready" }),
      ], "planning"),
      planGenerationStatus: "generating",
    });

    expect(screen.getByRole("status")).toHaveTextContent("Generating a fresh plan");
  });

  it("switches to compact graph mode after execution starts", async () => {
    renderPlanSection({
      graphPlan: createTaskWorkspaceFixtureGraph([
        createTaskWorkspaceFixtureNode({ id: "running", title: "Running node", status: "active" }),
      ], "running"),
      plan: { id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel,
      planGenerationStatus: "accepted",
    });

    await waitFor(() => expect(screen.getByTestId("task-plan-graph-panel")).toHaveAttribute("data-graph-mode", "compact"));
  });

  it("does not open node detail overlay when selecting a graph node", () => {
    renderPlanSection({
      graphPlan: createTaskWorkspaceFixtureGraph([
        createTaskWorkspaceFixtureNode({ id: "review", title: "Review task output", status: "waiting" }),
      ], "review"),
      plan: { id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel,
      planGenerationStatus: "idle",
    });

    expect(screen.getByTestId("task-plan-node-review")).toHaveTextContent("Review task output");
    screen.getByTestId("task-plan-node-review").click();

    expect(screen.queryByRole("dialog", { name: "Selected node details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Task command center" })).not.toBeInTheDocument();
  });
});
