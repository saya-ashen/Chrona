import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskWorkspacePlanSection } from "./task-workspace-plan-section";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import {
  createTaskWorkspaceFixtureGraph,
  createTaskWorkspaceFixtureNode,
  createTaskWorkspaceFixturePageData,
} from "../test-support/task-workspace-test-fixtures";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {} }),
}));

beforeAll(() => {
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

afterEach(() => {
  cleanup();
});

describe("TaskWorkspacePlanSection", () => {
  it("collapses the node drawer when clicking outside the drawer", async () => {
    const node = createTaskWorkspaceFixtureNode({
      id: "review",
      title: "Review task output",
      status: "waiting",
      nextAction: "Review output",
    });
    const graphPlan = createTaskWorkspaceFixtureGraph([node], "review");

    render(
      <>
        <button type="button">Top navigation action</button>
        <button type="button">Left navigation action</button>
        <TaskWorkspacePlanSection
          label="Plan"
          graphPlan={graphPlan}
          pageData={createTaskWorkspaceFixturePageData()}
          plan={{ id: "plan-1", status: "accepted", revision: 1, updatedAt: "2026-05-18T00:00:00.000Z" } as TaskPlanReadModel}
          planGenerationStatus="idle"
          acceptPlanError={null}
          runtimeEvents={[]}
          onGeneratePlan={vi.fn()}
          onDispatchExecutionAction={vi.fn()}
        />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("complementary", { name: "Task command center" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open selected node drawer" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Top navigation action" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("task-plan-node-review"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Left navigation action" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument();
    });
  });
});
