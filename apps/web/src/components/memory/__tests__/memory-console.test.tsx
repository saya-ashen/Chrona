import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.openTask": "Open Task",
        "common.openWorkbench": "Open Workbench",
        "common.startWork": "Start Work",
      };
      return map[key] ?? key;
    },
  }),
}));

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
      "/en/workspaces/ws_1/tasks/task_1",
    );
    expect(screen.getByRole("link", { name: "Open Workbench" })).toHaveAttribute(
      "href",
      "/en/workspaces/ws_1/work/task_1",
    );
  });
});
