import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ControlPlaneShell } from "@/components/control-plane-shell";

describe("ControlPlaneShell", () => {
  it("renders the MVP control-plane navigation and excludes Calendar", () => {
    render(
      <ControlPlaneShell>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
      "href",
      "/workspaces",
    );
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "href",
      "/tasks",
    );
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "href",
      "/inbox",
    );
    expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
  });
});
