import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const decideScheduleProposal = vi.fn().mockResolvedValue({ ok: true });
const dispatchExecutionAction = vi.fn().mockResolvedValue({ ok: true });

vi.mock("../ui/localized-link", () => ({
  LocalizedLink: ({
    children,
    href,
    ...props
  }: {
    children?: React.ReactNode;
    href: string;
  } & Omit<React.ComponentPropsWithoutRef<"a">, "href">) => (
    <a href={`/en${href}`} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@features/schedule", () => ({
  decideScheduleProposal: (...args: unknown[]) =>
    decideScheduleProposal(...args),
}));

vi.mock("@features/task-workspace", () => ({
  dispatchExecutionAction: (...args: unknown[]) =>
    dispatchExecutionAction(...args),
}));

vi.mock("@chrona/i18n", () => ({
  localizeHref: (locale: string, href: string) => `/${locale}${href}`,
  useLocale: () => "en",
}));

import { ActionCenterPageClient } from "@features/action-center";

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

function renderSingleItem(
  item: {
    id: string;
    kind: string;
    actionType: string;
    riskLevel: string;
    sourceTaskTitle: string;
    sourceTaskId: string;
    currentRunLabel: string | null;
    summary: string;
  },
  copyOverrides: Record<string, string> = {},
) {
  render(
    <ActionCenterPageClient
      workspaceId="ws_1"
      copy={{ ...copy, ...copyOverrides }}
      initialData={[
        {
          ...item,
          workspaceId: "ws_1",
          detail: item.actionType,
          consequence: "Execution stays paused until resolved.",
        } as never,
      ]}
    />,
  );
}

describe("ActionCenterPageClient", () => {
  it("submits approval decisions directly from action center approval cards", async () => {
    const user = userEvent.setup();

    render(
      <ActionCenterPageClient
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

    await waitFor(() =>
      expect(dispatchExecutionAction).toHaveBeenCalledWith({
        taskId: "task_1",
        action: { action: "resume_with_approval", decision: "approve" },
      }),
    );
    expect(
      screen.queryByText("Approve the file patch"),
    ).not.toBeInTheDocument();
  });

  it("accepts and rejects schedule proposals without leaving action center", async () => {
    const user = userEvent.setup();

    render(
      <ActionCenterPageClient
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
            consequence:
              "The plan stays unchanged until this proposal is accepted or rejected.",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Accept Proposal" }));

    await waitFor(() =>
      expect(decideScheduleProposal).toHaveBeenCalledWith({
        proposalId: "proposal_1",
        decision: "Accepted",
      }),
    );
  });

  it("shows the concrete auto-execution skip reason before generic consequence copy", () => {
    renderSingleItem({
      id: "scheduler_skip",
      kind: "auto_execution_skipped",
      actionType: "Auto execution skipped",
      riskLevel: "medium",
      sourceTaskTitle: "Generate report",
      sourceTaskId: "task_skip",
      currentRunLabel: null,
      summary: "Accept a plan before automatic execution can start.",
    });

    const reason = screen.getByText(
      "Accept a plan before automatic execution can start.",
    );
    const consequence = screen.getByText(
      "Execution stays paused until resolved.",
    );
    expect(reason.compareDocumentPosition(consequence)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("retries a failed recovery item via start_manual", async () => {
    const user = userEvent.setup();
    renderSingleItem(
      {
        id: "run_failed",
        kind: "recovery",
        actionType: "Recovery needed",
        riskLevel: "critical",
        sourceTaskTitle: "Build site",
        sourceTaskId: "task_3",
        currentRunLabel: "run_failed",
        summary: "The latest run stopped before finishing.",
      },
      { retry: "Retry" },
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(dispatchExecutionAction).toHaveBeenCalledWith({
        taskId: "task_3",
        action: { action: "start_manual" },
      }),
    );
  });

  it("resumes a blocked item via resume_after_unblock", async () => {
    const user = userEvent.setup();
    renderSingleItem(
      {
        id: "task_4",
        kind: "blocked",
        actionType: "Blocked",
        riskLevel: "high",
        sourceTaskTitle: "Deploy service",
        sourceTaskId: "task_4",
        currentRunLabel: null,
        summary: "Provider hermes is offline.",
      },
      { resume: "Resume" },
    );

    await user.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() =>
      expect(dispatchExecutionAction).toHaveBeenCalledWith({
        taskId: "task_4",
        action: { action: "resume_after_unblock" },
      }),
    );
  });

  it("offers an Open Task recovery link for a WaitingForInput item", async () => {
    renderSingleItem({
      id: "run_input",
      kind: "input",
      actionType: "Input needed",
      riskLevel: "medium",
      sourceTaskTitle: "Provision environment",
      sourceTaskId: "task_5",
      currentRunLabel: "run_input",
      summary: "Which environment should I target?",
    });

    const links = screen.getAllByRole("link", { name: "Open Task" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/en/tasks/task_5");
    }
    // WaitingForInput is resolved in the workbench, not auto-dispatched from action center.
    expect(dispatchExecutionAction).not.toHaveBeenCalled();
  });

  it("retries a cancelled recovery item via start_manual", async () => {
    const user = userEvent.setup();
    renderSingleItem(
      {
        id: "run_cancelled",
        kind: "recovery",
        actionType: "Recovery needed",
        riskLevel: "medium",
        sourceTaskTitle: "Generate report",
        sourceTaskId: "task_6",
        currentRunLabel: "run_cancelled",
        summary:
          "The latest run was cancelled and needs operator review before restarting.",
      },
      { retry: "Retry" },
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(dispatchExecutionAction).toHaveBeenCalledWith({
        taskId: "task_6",
        action: { action: "start_manual" },
      }),
    );
  });
});
