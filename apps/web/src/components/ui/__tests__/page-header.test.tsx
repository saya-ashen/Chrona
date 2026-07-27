import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeader } from "@shared/ui";

afterEach(cleanup);

describe("PageHeader", () => {
  it("keeps page identity, context, actions, and local controls in one semantic header", () => {
    render(
      <PageHeader
        eyebrow="Workspace"
        title="Tasks"
        description="Review and manage current work."
        meta={<span>Needs you</span>}
        actions={<button type="button">New task</button>}
        toolbar={<nav aria-label="Task views">All tasks</nav>}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Tasks" });
    expect(heading.closest("header")).not.toBeNull();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Review and manage current work.")).toBeInTheDocument();
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New task" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Task views" })).toBeInTheDocument();
  });

  it("omits optional regions when the page has only a title", () => {
    const { container } = render(<PageHeader title="Settings" />);

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="page-header-actions"]')).toBeNull();
    expect(container.querySelector('[data-slot="page-header-toolbar"]')).toBeNull();
  });

  it("renders a distinct workspace surface when requested", () => {
    const { container } = render(<PageHeader title="Workspace" surface="workspace" />);

    expect(container.querySelector("header")).toHaveClass(
      "border-y",
      "bg-muted/70",
    );
    expect(container.querySelector("header")).not.toHaveClass("rounded-2xl", "shadow-sm");
  });
});
