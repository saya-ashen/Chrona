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
  SurfaceCardDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
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

import { InboxList } from "@/components/inbox/inbox-list";

describe("InboxList", () => {
  it("shows action type, risk, task, run, summary, and consequence", () => {
    render(
      <InboxList
        items={[
          {
            id: "approval_1",
            kind: "approval",
            actionType: "approval",
            riskLevel: "high",
            sourceTaskTitle: "Review adapter mapping",
            sourceTaskId: "task_1",
            workspaceId: "ws_1",
            currentRunLabel: "run_projection",
            detail: "command approval",
            summary: "Approve the file patch",
            consequence: "Blocks deployment until approved",
          },
        ]}
      />,
    );

    expect(screen.getByText("approval")).toBeInTheDocument();
    expect(screen.getByText(/Risk: high/i)).toBeInTheDocument();
    expect(screen.getByText(/Task: Review adapter mapping/i)).toBeInTheDocument();
    expect(screen.getByText("Approve the file patch")).toBeInTheDocument();
    expect(screen.getByText("Blocks deployment until approved")).toBeInTheDocument();
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
