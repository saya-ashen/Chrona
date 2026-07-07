import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "components.schedulePage.firstRunTitle": "Start with Chrona in three steps",
        "components.schedulePage.firstRunDescription":
          "Connect AI, capture a real task, then review the plan before anything runs.",
        "components.schedulePage.firstRunStepConnectAiTitle": "Connect AI",
        "components.schedulePage.firstRunStepConnectAi": "Add Claude Code or Codex as the AI client Chrona will use.",
        "components.schedulePage.firstRunStepConnectAiDone": "AI client connected. Next, create a real task.",
        "components.schedulePage.firstRunStepCreateTaskTitle": "Create a task",
        "components.schedulePage.firstRunStepCreateTask": "Describe the goal, constraints, and context in one task.",
        "components.schedulePage.firstRunStepReviewPlanTitle": "Review the plan",
        "components.schedulePage.firstRunStepReviewPlan": "Chrona previews AI suggestions first; you decide what to accept or run.",
        "components.schedulePage.firstRunConnectAi": "Connect AI",
        "components.schedulePage.firstRunCreateTask": "Create first task",
        "components.schedulePage.firstRunOpenCreatedTask": "Open created task",
      })[key] ?? key,
  }),
  useLocale: () => "en",
}));

import { StartWithChrona } from "../start-with-chrona";
import { notifyAiClientsChanged } from "@/lib/ai-client-events";

const push = vi.fn();

vi.mock("@/lib/router", () => ({
  useAppRouter: () => ({ push }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: ReactNode } & ComponentPropsWithoutRef<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

function mockClients(clients: Array<{ id: string; enabled?: boolean }>) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ clients }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function mockTasks(payload: { tasks?: Array<{ id?: string }>; total?: number }) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function deferredClients(clients: Array<{ id: string; enabled?: boolean }>) {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });

  return {
    promise,
    resolve: () => resolve(new Response(JSON.stringify({ clients }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
  };
}


function currentStep() {
  return screen.getByRole("listitem", { current: "step" });
}

function renderStartWithChrona(props: ComponentProps<typeof StartWithChrona> = {}) {
  return render(<StartWithChrona {...props} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

describe("StartWithChrona", () => {
  it("shows generic AI client setup when no client exists", async () => {
    mockClients([]);

    renderStartWithChrona();

    expect(await screen.findByText("Start with Chrona in three steps")).toBeInTheDocument();
    expect(screen.getByText(/Connect AI, capture a real task/)).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Connect AI");
    expect(currentStep()).not.toHaveTextContent("Create a task");
    expect(screen.getByText("Create a task")).toBeInTheDocument();
    expect(screen.getByText("Review the plan")).toBeInTheDocument();
    expect(screen.queryByText(/Hermes/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Connect AI" }));

    expect(push).toHaveBeenCalledWith("/en/settings?panel=ai-clients");
  });

  it("refreshes AI client step when clients change elsewhere", async () => {
    mockClients([]);

    renderStartWithChrona();

    expect(await screen.findByText("Start with Chrona in three steps")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Connect AI");

    mockClients([{ id: "client-1", enabled: true }]);
    notifyAiClientsChanged();

    expect(await screen.findByText("AI client connected. Next, create a real task.")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Create a task");
  });

  it("ignores stale AI client refreshes that finish out of order", async () => {
    const initial = deferredClients([]);
    const refreshed = deferredClients([{ id: "client-1", enabled: true }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockReturnValueOnce(initial.promise);
    fetchSpy.mockReturnValueOnce(refreshed.promise);

    renderStartWithChrona();
    notifyAiClientsChanged();

    refreshed.resolve();
    expect(await screen.findByText("AI client connected. Next, create a real task.")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Create a task");
    await act(async () => {
      initial.resolve();
      await Promise.resolve();
    });
    expect(currentStep()).toHaveTextContent("Create a task");
  });

  it("keeps the guide visible and advances CTA when an AI client exists", async () => {
    const onCreateTask = vi.fn();
    mockClients([{ id: "client-1", enabled: true }]);

    render(<StartWithChrona onCreateTask={onCreateTask} />);

    expect(await screen.findByText("Start with Chrona in three steps")).toBeInTheDocument();
    expect(screen.getByText("AI client connected. Next, create a real task.")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Create a task");
    expect(currentStep()).not.toHaveTextContent("Review the plan");
    expect(screen.getByRole("button", { name: "Create first task" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create first task" }));

    expect(onCreateTask).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the created task from the review step", async () => {
    mockClients([{ id: "client-1", enabled: true }]);

    renderStartWithChrona({ createdTaskId: "created-task" });

    expect(await screen.findByText("Start with Chrona in three steps")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Review the plan");
    expect(currentStep()).not.toHaveTextContent("Create a task");
    expect(screen.getByRole("button", { name: "Open created task" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open created task" }));

    expect(push).toHaveBeenCalledWith("/en/tasks/created-task");
  });


  it("advances to review when workspace already has a task", async () => {
    const onOpenCreatedTask = vi.fn();
    mockClients([{ id: "client-1", enabled: true }]);
    mockTasks({ tasks: [{ id: "existing-task" }], total: 1 });

    renderStartWithChrona({ workspaceId: "workspace-1", onOpenCreatedTask });

    expect(await screen.findByText("Start with Chrona in three steps")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Review the plan");
    expect(currentStep()).not.toHaveTextContent("Create a task");
    expect(screen.getByRole("button", { name: "Open created task" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open created task" }));

    expect(onOpenCreatedTask).toHaveBeenCalledWith("existing-task");
    expect(push).not.toHaveBeenCalled();
  });
  it("hides onboarding after the created task is opened", async () => {
    mockClients([{ id: "client-1", enabled: true }]);

    renderStartWithChrona({ createdTaskId: "created-task", isComplete: true });

    expect(screen.queryByText("Start with Chrona in three steps")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open created task" })).not.toBeInTheDocument();
  });
});
