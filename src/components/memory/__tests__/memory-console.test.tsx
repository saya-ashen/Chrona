import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryConsole } from "@/components/memory/memory-console";

describe("MemoryConsole", () => {
  it("shows content, source, scope, status, and linked task/run", () => {
    render(
      <MemoryConsole
        items={[
          {
            id: "memory_1",
            content: "Use Task Projection for all list surfaces.",
            sourceType: "user_input",
            scope: "workspace",
            status: "Active",
            workspaceId: "ws_1",
            taskId: "task_1",
            taskTitle: "Write task projection",
            runLabel: "run_projection",
          },
        ]}
      />,
    );

    expect(screen.getByText("Use Task Projection for all list surfaces.")).toBeInTheDocument();
    expect(screen.getByText(/workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Write task projection/i)).toBeInTheDocument();
    expect(screen.getByText(/run_projection/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Task" })).toHaveAttribute(
      "href",
      "/workspaces/ws_1/tasks/task_1",
    );
    expect(screen.getByRole("link", { name: "Open Workbench" })).toHaveAttribute(
      "href",
      "/workspaces/ws_1/work/task_1",
    );
  });
});
