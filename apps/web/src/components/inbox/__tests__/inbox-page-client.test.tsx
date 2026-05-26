import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const decideScheduleProposal = vi.fn().mockResolvedValue({ ok: true });
const dispatchExecutionAction = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/lib/task-actions-client", () => ({
  decideScheduleProposal: (...args: unknown[]) => decideScheduleProposal(...args),
  dispatchExecutionAction: (...args: unknown[]) => dispatchExecutionAction(...args),
}));

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "common.openTask": "Open Task",
      "common.openWork": "Open Work",
      "common.startWork": "Start Work",
    }[key] ?? key),
  }),
}));

import { InboxPageClient } from "@/components/inbox/inbox-page-client";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const copy = {
  risk: "Risk",
  task: "Task",
  run: "Run",
  openTask: "Open Task",
  approve: "Approve",
  reject: "Reject",
  editAndApprove: "Edit and Approve",
  openSchedule: "Open Schedule",
  acceptProposal: "Accept Proposal",
  rejectProposal: "Reject Proposal",
  editPlaceholder: "Needs edits before approval",
};

describe("InboxPageClient", () => {
  it("submits approval decisions directly from inbox approval cards", async () => {
    const user = userEvent.setup();

    render(
      <InboxPageClient
        workspaceId="ws_1"
        copy={copy}
        initialData={[
          {
            id: "approval_1",
            kind: "approval",
            actionType: "Approval needed",
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

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(dispatchExecutionAction).toHaveBeenCalledWith({
      taskId: "task_1",
      action: { action: "resume_with_approval", decision: "approve" },
    }));
    expect(screen.queryByText("Approve the file patch")).not.toBeInTheDocument();
  });

  it("accepts and rejects schedule proposals without leaving inbox", async () => {
    const user = userEvent.setup();

    render(
      <InboxPageClient
        workspaceId="ws_1"
        copy={copy}
        initialData={[
          {
            id: "proposal_1",
            kind: "schedule_proposal",
            actionType: "Schedule proposal",
            riskLevel: "medium",
            sourceTaskTitle: "Plan launch",
            sourceTaskId: "task_2",
            workspaceId: "ws_1",
            currentRunLabel: null,
            detail: "ai via planner",
            summary: "Move launch prep to tomorrow",
            consequence: "The plan stays unchanged until this proposal is accepted or rejected.",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Accept Proposal" }));

    await waitFor(() => expect(decideScheduleProposal).toHaveBeenCalledWith({
      proposalId: "proposal_1",
      decision: "Accepted",
    }));
  });
});
