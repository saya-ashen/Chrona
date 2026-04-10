import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ControlPlaneShell } from "@/components/control-plane-shell";

describe("ControlPlaneShell", () => {
  it("renders the control-plane navigation including Workspaces", () => {
    render(
      <ControlPlaneShell>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    expect(screen.getByRole("link", { name: "Agent Dashboard" })).toHaveAttribute("href", "/en/schedule");
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "/en/workspaces");
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/en/schedule");
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "href",
      "/en/inbox",
    );
    expect(screen.getByRole("link", { name: "Memory" })).toHaveAttribute("href", "/en/memory");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/en/settings");
    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute("href", "/en/schedule");
    expect(screen.getByRole("link", { name: "中文" })).toHaveAttribute("href", "/zh/schedule");
    expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
  });
});
