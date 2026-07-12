import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  createTaskWorkspaceFixtureGraph,
  createTaskWorkspaceFixtureNode,
  createTaskWorkspaceFixturePageData,
} from "./task-workspace-test-fixtures";

export const taskWorkspaceUiScenarios = {
  loading: { label: "Loading task workspace", status: "loading" },
  empty: { label: "Empty task workspace", status: "empty" },
  planning: { label: "Planning task workspace", status: "planning" },
  executing: { label: "Executing task workspace", status: "executing" },
  blocked: { label: "Blocked task workspace", status: "blocked" },
  failed: { label: "Failed task workspace", status: "failed" },
  completed: { label: "Completed task workspace", status: "completed" },
  retry: { label: "Retryable task workspace", status: "retry" },
  longText: { label: "Long text task workspace", status: "long-text" },
  desktop: { label: "Desktop task workspace", viewport: { width: 1440, height: 900 } },
  mobile: { label: "Mobile task workspace", viewport: { width: 390, height: 844 } },
} as const;

export function createTaskWorkspaceUiFixture(status: keyof typeof taskWorkspaceUiScenarios) {
  const nodeStatus = status === "completed" ? "done" : status === "blocked" || status === "failed" ? "blocked" : "active";

  return {
    pageData: createTaskWorkspaceFixturePageData({
      task: {
        title: taskWorkspaceUiScenarios[status].label,
        status: status === "completed" ? "Completed" : status === "blocked" ? "Blocked" : status === "failed" ? "Failed" : "Running",
      },
    }),
    graphPlan: createTaskWorkspaceFixtureGraph([
      createTaskWorkspaceFixtureNode({
        id: status,
        title: status === "longText" ? "Very long generated plan node title that should wrap without hiding primary actions" : taskWorkspaceUiScenarios[status].label,
        status: nodeStatus,
        nextAction: status === "retry" ? "Retry execution" : undefined,
      }),
    ], status),
  };
}

export function renderTaskWorkspaceUi(element: ReactElement) {
  return render(element);
}
