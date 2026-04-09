import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ControlPlaneShell } from "@/components/control-plane-shell";

describe("ControlPlaneShell", () => {
  it("renders the single-workspace control-plane navigation and excludes Workspaces", () => {
    render(
      <ControlPlaneShell>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    expect(screen.getByRole("link", { name: "Agent Dashboard" })).toHaveAttribute("href", "/schedule");
    expect(screen.queryByRole("link", { name: "Workspaces" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/schedule");
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "href",
      "/tasks",
    );
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "href",
      "/inbox",
    );
    expect(screen.getByRole("link", { name: "Memory" })).toHaveAttribute("href", "/memory");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
  });
});
