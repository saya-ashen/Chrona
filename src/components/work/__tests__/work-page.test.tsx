import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkPageClient } from "@/components/work/work-page-client";

describe("WorkPageClient", () => {
  it("renders the timeline as the primary surface with conversation as secondary", () => {
    render(
      <WorkPageClient
        initialData={{
          taskShell: {
            id: "task_1",
            workspaceId: "ws_1",
            title: "Write projection",
            status: "Blocked",
            priority: "High",
            dueAt: null,
            blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
          },
          currentRun: { id: "run_1", status: "WaitingForApproval" },
          timeline: [],
          conversation: [],
          approvals: [],
          artifacts: [],
          toolCalls: [],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Execution Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conversation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pending Approvals" })).toBeInTheDocument();
  });
});
