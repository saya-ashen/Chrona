import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskAiPlanPanel } from "./task-ai-plan-panel";

vi.mock("@/components/tasks/ai/task-plan-generation-panel", () => ({
  TaskPlanGenerationPanel: (props: { showRegenerateButton?: boolean; showEmptyGenerateButton?: boolean; onApply?: unknown }) => (
    <div data-testid="plan-preview" data-regenerate={String(props.showRegenerateButton)} data-generate={String(props.showEmptyGenerateButton)} data-apply={String(Boolean(props.onApply))} />
  ),
}));
vi.mock("@/components/tasks/plan/task-plan-view-model", () => ({
  taskPlanReadModelToGraphPlan: (plan: unknown) => plan ? { steps: [], edges: [] } : null,
}));

vi.mock("@/components/tasks/panels/task-plan-graph-panel", () => ({
  TaskPlanGraphPanel: ({ mode, actions }: { mode?: string; actions?: unknown }) => (
    <div data-testid="workspace-plan-graph" data-mode={mode} data-actions={String(Boolean(actions))} />
  ),
}));

describe("TaskAiPlanPanel preview", () => {
  it("shows only an empty preview when no plan exists", () => {
    render(
      <TaskAiPlanPanel
        previewOnly
        taskId="task-1"
        planningTaskDraft={{ title: "Task", description: "", priority: "Medium", dueAt: null, scheduledStartAt: null, scheduledEndAt: null }}
        savedPlan={null}
        generationStatus="idle"
        acceptedPlanId={null}
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByText("No plan available to preview.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-preview")).not.toBeInTheDocument();
  });
  it("renders an existing plan with the compact workspace graph and no actions", () => {
    render(
      <TaskAiPlanPanel
        previewOnly
        taskId="task-1"
        planningTaskDraft={{ title: "Task", description: "", priority: "Medium", dueAt: null, scheduledStartAt: null, scheduledEndAt: null }}
        savedPlan={{ id: "plan-1" } as never}
        generationStatus="accepted"
        acceptedPlanId="plan-1"
        hasUnsavedConfigChanges={false}
        unsavedConfigDraft={null}
        onPlanLoaded={vi.fn()}
        onApplyPlan={vi.fn()}
        onSaveConfigBeforeRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("workspace-plan-graph")).toHaveAttribute("data-mode", "compact");
    expect(screen.getByTestId("workspace-plan-graph")).toHaveAttribute("data-actions", "false");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

});
