import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
