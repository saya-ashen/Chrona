import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedSettingsDialog } from "@/components/settings/advanced-settings-dialog";

const push = vi.fn();

vi.mock("@/lib/router", () => ({
  useAppRouter: () => ({ push }),
  AppLink: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "pages.settings.openAdvancedSettings": "Open Advanced Settings",
        "pages.settings.advancedDescription": "Operational controls live outside the daily task flow.",
        "pages.advancedSettings.title": "Advanced Settings",
        "pages.advancedSettings.subtitle": "Internal controls that stay available without becoming the default workflow.",
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
  it("renders modal content when open", () => {
    render(<AdvancedSettingsDialog isOpen closeHref="/en/settings" />);

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Advanced Settings")).toBeInTheDocument();
  });

  it("navigates back to settings when close button is clicked", () => {
    render(<AdvancedSettingsDialog isOpen closeHref="/en/settings" />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(push).toHaveBeenCalledWith("/en/settings");
  });
});
