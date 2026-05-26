"use client";

import { useState } from "react";

import { LocalizedLink } from "@/components/i18n/localized-link";
import { Button } from "@/components/ui/button";
import { InboxList } from "@/components/inbox/inbox-list";
import { decideScheduleProposal, dispatchExecutionAction } from "@/lib/task-actions-client";

type InboxPageClientProps = {
  workspaceId: string;
  initialData: Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/get-inbox").getInbox>>;
  copy: Parameters<typeof InboxList>[0]["copy"] & {
    openSchedule?: string;
    acceptProposal?: string;
    rejectProposal?: string;
    editPlaceholder?: string;
  };
};

type InboxItem = InboxPageClientProps["initialData"][number];

function getActionError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function InboxPageClient({ initialData, copy }: InboxPageClientProps) {
  const [items, setItems] = useState(initialData);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runItemAction(item: InboxItem, action: "approve" | "reject" | "edit") {
    setPendingItemId(item.id);
    setActionError(null);

    try {
      if (item.kind === "schedule_proposal") {
        await decideScheduleProposal({
          proposalId: item.id,
          decision: action === "reject" ? "Rejected" : "Accepted",
        });
      } else if (item.kind === "approval") {
        await dispatchExecutionAction({
          taskId: item.sourceTaskId,
          action: {
            action: "resume_with_approval",
            decision: action === "reject" ? "reject" : action === "edit" ? "request_changes" : "approve",
            feedback: action === "edit" ? copy.editPlaceholder : undefined,
          },
        });
      } else {
        return;
      }

      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (error) {
      setActionError(getActionError(error));
    } finally {
      setPendingItemId(null);
    }
  }

  return (
    <div className="space-y-3">
      {actionError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}
      <InboxList
        items={items.map((item) => ({
          ...item,
          actions:
            item.kind === "schedule_proposal" ? (
              <>
                <Button type="button" disabled={pendingItemId === item.id} onClick={() => void runItemAction(item, "approve")}>
                  {copy.acceptProposal ?? "Accept Proposal"}
                </Button>
                <Button type="button" variant="outline" disabled={pendingItemId === item.id} onClick={() => void runItemAction(item, "reject")}>
                  {copy.rejectProposal ?? "Reject Proposal"}
                </Button>
                <LocalizedLink href="/schedule" className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted">
                  {copy.openSchedule ?? "Open Schedule"}
                </LocalizedLink>
              </>
            ) : item.kind === "approval" ? null : (
              <LocalizedLink href={`/tasks/${item.sourceTaskId}`} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
                {copy.openTask ?? "Open Task"}
              </LocalizedLink>
            ),
        }))}
        copy={copy}
        onApprove={(itemId) => {
          const item = items.find((candidate) => candidate.id === itemId);
          if (item) void runItemAction(item, "approve");
        }}
        onReject={(itemId) => {
          const item = items.find((candidate) => candidate.id === itemId);
          if (item) void runItemAction(item, "reject");
        }}
        onEditAndApprove={(itemId) => {
          const item = items.find((candidate) => candidate.id === itemId);
          if (item) void runItemAction(item, "edit");
        }}
      />
    </div>
  );
}
