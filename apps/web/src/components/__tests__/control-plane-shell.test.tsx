import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/components/i18n/locale-switcher", () => ({
  LocaleSwitcher: () => (
    <div>
      <a href="/en/schedule">English</a>
      <a href="/zh/schedule">中文</a>
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}));

vi.mock("@/lib/router", () => ({
  useAppPathname: () => "/schedule",
}));

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "nav.brandTitle": "Chrona",
        "nav.brandTagline": "Control plane",
        "nav.schedule": "Schedule",
        "nav.inbox": "Inbox",
        "nav.memory": "Memory",
        "nav.settings": "Settings",
      };
      return map[key] ?? key;
    },
  }),
}));

import { ControlPlaneShell } from "@/components/control-plane-shell";

describe("ControlPlaneShell", () => {
  it("renders the refreshed control-plane navigation without Workspaces", () => {
    render(
      <ControlPlaneShell>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    expect(screen.getByRole("link", { name: "Chrona" })).toHaveAttribute("href", "/en/schedule");
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/en/schedule");
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/en/inbox");
    expect(screen.getByRole("link", { name: "Memory" })).toHaveAttribute("href", "/en/memory");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/en/settings");
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link", { name: "English" })[0]).toHaveAttribute("href", "/en/schedule");
    expect(screen.getAllByRole("link", { name: "中文" })[0]).toHaveAttribute("href", "/zh/schedule");
    expect(screen.queryByRole("link", { name: "Workspaces" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
  });
});
