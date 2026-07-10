import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskPageData } from "../../../../../../../features/task-workspace";
import { deriveTaskPlanningReadiness } from "../../../../../../../features/task-workspace";
import { PlanSetupPanel } from "./task-workspace-plan-section";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
afterEach(cleanup);

const pageData = {
  availableAiClients: [{ id: "ai-1", name: "Claude Code", enabled: true }],
  task: {
    id: "task-1",
    title: "Research developer tools",
    description: "Compare current tools",
    aiClientId: "ai-1",
    executionRuntime: "claude_code",
    dueAt: null,
    scheduledStartAt: null,
    currentWorkBlock: null,
  },
} as unknown as TaskPageData;

describe("PlanSetupPanel", () => {
  it("shows one generate action and routes brief improvements to editing", () => {
    const onGeneratePlan = vi.fn();
    const onEditBrief = vi.fn();
    render(
      <PlanSetupPanel
        readiness={deriveTaskPlanningReadiness(pageData)}
        pageData={pageData}
        onGeneratePlan={onGeneratePlan}
        onEditBrief={onEditBrief}
      />,
    );
    expect(screen.getByTestId("plan-setup-panel")).toHaveAttribute("data-plan-setup-layout", "full-width");
    expect(screen.getByRole("complementary", { name: "Plan creation action" })).toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "Generate plan" })).toHaveLength(1);
    expect(screen.queryByText("Plan intent presets")).not.toBeInTheDocument();
    expect(screen.getByText(/nothing runs until the plan is reviewed and accepted/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit task brief" })[0]);
    expect(onEditBrief).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(onGeneratePlan).toHaveBeenCalledOnce();
  });

  it("offers a working provider settings link instead of a disabled action", () => {
    const noProvider = {
      ...pageData,
      availableAiClients: [],
      task: { ...pageData.task, aiClientId: null, executionRuntime: undefined },
    } as unknown as TaskPageData;
    render(
      <PlanSetupPanel
        readiness={deriveTaskPlanningReadiness(noProvider)}
        pageData={noProvider}
        onGeneratePlan={vi.fn()}
        onEditBrief={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Generate plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect AI provider" })).toHaveAttribute("href", "/settings?panel=ai-clients");
  });
});
