import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/components/schedule/dialogs/task-create-dialog", () => ({
  TaskCreateDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div role="dialog">Create task dialog</div> : null,
}));

vi.mock("@/lib/task-actions-client", () => ({
  createTaskFromSchedule: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}));

vi.mock("@/lib/router", () => ({
  useAppPathname: () => "/tasks",
  useAppRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "nav.brandTitle": "Chrona",
        "nav.brandTagline": "Human-AI task work",
        "nav.schedule": "Schedule",
        "nav.tasks": "Tasks",
        "nav.settings": "Settings",
        "nav.newTask": "New Task",
      };
      return map[key] ?? key;
    },
  }),
}));

import { ControlPlaneShell } from "@/components/control-plane-shell";

const defaultWorkspace = { id: "ws-1", name: "Default" };

afterEach(() => {
  cleanup();
});

describe("ControlPlaneShell", () => {
  it("renders simplified navigation with Schedule, Tasks, and Settings", () => {
    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    const chronaLinks = screen.getAllByRole("link", { name: "Chrona" });
    expect(chronaLinks.length).toBeGreaterThan(0);
    expect(chronaLinks[0]).toHaveAttribute("href", "/en/schedule");
    expect(screen.getAllByRole("link", { name: "Schedule" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/en/tasks");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/en/settings");
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");

    // Should NOT show legacy navigation items
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Memory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workspaces" })).not.toBeInTheDocument();
  });

  it("opens the create task dialog without linking away from the current page", async () => {
    const user = userEvent.setup();

    render(
      <ControlPlaneShell defaultWorkspace={defaultWorkspace}>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    const newTaskButton = screen.getByRole("button", { name: "New Task" });
    expect(screen.queryByRole("link", { name: "New Task" })).not.toBeInTheDocument();

    await user.click(newTaskButton);

    expect(screen.getByRole("dialog")).toHaveTextContent("Create task dialog");
  });
});
