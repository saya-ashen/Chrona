import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiClientsDialog } from "@/components/settings/ai-clients-dialog";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "pages.settings.manageAiClients": "Manage AI Clients",
        "pages.settings.aiClientsDescription": "Manage AI clients and configure which client each feature uses",
        "common.close": "Close",
      };
      return map[key] ?? key;
    },
    messages: {},
  }),
}));

vi.mock("@/components/settings/ai-clients-manager", () => ({
  AiClientsManager: () => <div>AI clients manager body</div>,
}));

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("AiClientsDialog", () => {
  it("renders modal content when open", () => {
    render(<AiClientsDialog isOpen closeHref="/en/settings" />);

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("AI clients manager body")).toBeInTheDocument();
    expect(screen.getByText("Manage AI Clients")).toBeInTheDocument();
  });

  it("navigates back to settings when close button is clicked", () => {
    render(<AiClientsDialog isOpen closeHref="/en/settings" />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(push).toHaveBeenCalledWith("/en/settings");
  });
});
