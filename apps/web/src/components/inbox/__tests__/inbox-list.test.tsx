import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild && children) {
      return <>{children}</>;
    }
    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.openTask": "Open Task",
        "common.openWork": "Open Work",
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
      "/en/tasks/task_1",
    );
    expect(screen.getByRole("link", { name: "Open Task" })).toHaveAttribute(
      "href",
      "/en/tasks/task_1",
    );
  });
});
