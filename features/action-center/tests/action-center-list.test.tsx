import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@shared/ui", () => ({
  Button: ({ children, asChild, ...props }: { children?: React.ReactNode; asChild?: boolean } & React.ComponentPropsWithoutRef<"button">) => {
    if (asChild && children) return <>{children}</>;
    return <button {...props}>{children}</button>;
  },
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Card: ({ children, ...props }: React.ComponentPropsWithoutRef<"div">) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: React.ComponentPropsWithoutRef<"div">) => <div {...props}>{children}</div>,
  Input: (props: React.ComponentPropsWithoutRef<"input">) => <input {...props} />,
  Select: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children?: React.ReactNode; value: string }) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children, ...props }: { children?: React.ReactNode } & React.ComponentPropsWithoutRef<"button">) => <button type="button" {...props}>{children}</button>,
  SelectValue: () => <span />,
  cn: (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" "),
}));

import { ActionCenterList } from "@features/action-center";

afterEach(() => {
  cleanup();
});

const recoveryItem = {
  id: "run_failed",
  kind: "recovery" as const,
  actionType: "Recovery needed",
  riskLevel: "critical",
  sourceTaskTitle: "Collect PhD positions",
  sourceTaskId: "task_1",
  workspaceId: "ws_1",
  currentRunLabel: "run_critical",
  detail: "Updated 12m ago · Agent: Claude SDK",
  summary: "The last run failed before completion.",
  consequence: "The last run failed before completion and needs operator recovery.",
  primaryAction: <button>Recover run</button>,
  secondaryActions: <a href="/en/tasks/task_1">Open Task</a>,
};

const completedItem = {
  id: "run_completed",
  kind: "execution_completed" as const,
  actionType: "Execution completed",
  riskLevel: "low",
  sourceTaskTitle: "Draft report",
  sourceTaskId: "task_2",
  workspaceId: "ws_1",
  currentRunLabel: "run_done",
  detail: "Completed 1h ago · Agent: Codex",
  summary: "Task execution completed recently.",
  consequence: "Results are ready for review. Check the outputs and decide next steps.",
  primaryAction: <a href="/en/tasks/task_2">Review results</a>,
};

describe("ActionCenterList", () => {
  it("renders action queue stats, priority groups, and one primary action per card", () => {
    render(<ActionCenterList items={[completedItem, recoveryItem]} />);

    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.getByText("Recover now")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Collect PhD positions" })).toBeInTheDocument();
    expect(screen.getByText("Risk: critical")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("The last run failed before completion and needs operator recovery.")).toBeInTheDocument();
    expect(screen.queryByTestId("action-center-message")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recover run" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review results" })).toHaveAttribute("href", "/en/tasks/task_2");
  });

  it("filters the action queue by priority and search text", async () => {
    const user = userEvent.setup();
    render(<ActionCenterList items={[completedItem, recoveryItem]} />);

    await user.click(screen.getByRole("button", { name: "Recover" }));

    expect(screen.getByText("Collect PhD positions")).toBeInTheDocument();
    expect(screen.queryByText("Draft report")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search tasks or runs..."));
    await user.type(screen.getByPlaceholderText("Search tasks or runs..."), "missing");

    expect(screen.getByText("No matching action items")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Draft report")).toBeInTheDocument();
  });

  it("renders an empty action queue state", () => {
    render(<ActionCenterList items={[]} />);

    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View tasks" })).toHaveAttribute("href", "/en/tasks");
  });
});
