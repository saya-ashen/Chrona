import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "components.schedulePage.firstRunTitle": "Start with Chrona in three steps",
        "components.schedulePage.firstRunDescription":
          "Connect an AI client, create a task, then let Chrona turn it into a plan. AI actions stay previewed for your approval before anything changes.",
        "components.schedulePage.firstRunStepConnectAi": "Connect an AI client for local-first planning and execution.",
        "components.schedulePage.firstRunStepCreateTask": "Capture one real task with enough context for AI to help.",
        "components.schedulePage.firstRunStepReviewPlan": "Review AI suggestions before accepting or running work.",
        "components.schedulePage.firstRunConnectAi": "Connect AI",
      })[key] ?? key,
  }),
  useLocale: () => "en",
}));

import { StartWithChrona } from "../start-with-chrona";

const push = vi.fn();

vi.mock("@/lib/router", () => ({
  useAppRouter: () => ({ push }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: ReactNode } & ComponentPropsWithoutRef<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

function renderStartWithChrona() {
  return render(<StartWithChrona />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

describe("StartWithChrona", () => {
  it("shows generic AI client setup when no client exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ clients: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderStartWithChrona();

    expect(await screen.findByText("Start with Chrona in three steps")).toBeInTheDocument();
    expect(screen.getByText(/Connect an AI client, create a task/)).toBeInTheDocument();
    expect(screen.queryByText(/Hermes/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Connect AI" }));

    expect(push).toHaveBeenCalledWith("/en/settings?panel=ai-clients");
  });

  it("hides when an AI client exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ clients: [{ id: "client-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderStartWithChrona();

    await waitFor(() => {
      expect(screen.queryByText("Start with Chrona in three steps")).not.toBeInTheDocument();
    });
  });
});
