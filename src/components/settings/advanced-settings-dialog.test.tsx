import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedSettingsDialog } from "@/components/settings/advanced-settings-dialog";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "pages.settings.openAdvancedSettings": "Open Advanced Settings",
        "pages.settings.advancedDescription": "Workspace management and deeper operational controls live outside the daily task flow.",
        "pages.advancedSettings.title": "Advanced Settings",
        "pages.advancedSettings.subtitle": "Internal controls that stay available without becoming the default workflow.",
        "pages.advancedSettings.workspaceManagementTitle": "Workspace management",
        "pages.advancedSettings.workspaceManagementDescription": "The product now defaults into a single-workspace UX. Use workspace management only for advanced or internal operations.",
        "pages.advancedSettings.openWorkspaces": "Open Workspaces",
        "pages.advancedSettings.taskCountOne": "task",
        "pages.advancedSettings.taskCountOther": "tasks",
        "common.close": "Close",
      };
      return map[key] ?? key;
    },
  }),
  useLocale: () => "en",
}));

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("AdvancedSettingsDialog", () => {
  const workspaces = [{ id: "ws-1", name: "Main Workspace", _count: { tasks: 3 } }];

  it("renders modal content when open", () => {
    render(<AdvancedSettingsDialog isOpen closeHref="/en/settings" workspaces={workspaces} />);

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Advanced Settings")).toBeInTheDocument();
    expect(screen.getByText("Main Workspace")).toBeInTheDocument();
  });

  it("navigates back to settings when close button is clicked", () => {
    render(<AdvancedSettingsDialog isOpen closeHref="/en/settings" workspaces={workspaces} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(push).toHaveBeenCalledWith("/en/settings");
  });
});
