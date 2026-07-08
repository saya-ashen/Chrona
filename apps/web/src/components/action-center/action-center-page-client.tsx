"use client";

import { useState } from "react";
import type { ActionCenterItem, ActionCenterProjection } from "@chrona/contracts/api";

import { LocalizedLink } from "@/components/i18n/localized-link";
import { Button } from "@/components/ui/button";
import { ActionCenterList } from "@/components/action-center/action-center-list";
import { decideScheduleProposal, dispatchExecutionAction } from "@/lib/task-actions-client";

type ActionCenterCopy = Partial<Record<
  | "risk"
  | "task"
  | "run"
  | "openTask"
  | "reviewResults"
  | "recoverRun"
  | "viewLogs"
  | "approve"
  | "reject"
  | "editAndApprove"
  | "emptyTitle"
  | "emptyDescription"
  | "emptyAction"
  | "openSchedule"
  | "acceptProposal"
  | "rejectProposal"
  | "editPlaceholder"
  | "retry"
  | "resume",
  string
>>;

type ActionCenterPageClientProps = {
  workspaceId: string;
  initialData: ActionCenterProjection;
  copy: ActionCenterCopy;
};

function getActionError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function taskHref(item: ActionCenterItem) {
  return `/tasks/${item.sourceTaskId}`;
}

function TaskLink({ item, label, variant = "outline" }: { item: ActionCenterItem; label: string; variant?: "default" | "outline" | "ghost" }) {
  return (
    <Button asChild variant={variant} size="sm">
      <LocalizedLink href={taskHref(item)}>{label}</LocalizedLink>
    </Button>
  );
}

export function ActionCenterPageClient({ initialData, copy }: ActionCenterPageClientProps) {
  const [items, setItems] = useState(initialData);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runItemAction(item: ActionCenterItem, action: "approve" | "reject" | "edit") {
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
      } else if (item.kind === "recovery") {
        await dispatchExecutionAction({
          taskId: item.sourceTaskId,
          action: { action: "start_manual" },
        });
      } else if (item.kind === "blocked") {
        await dispatchExecutionAction({
          taskId: item.sourceTaskId,
          action: { action: "resume_after_unblock" },
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

  function actionProps(item: ActionCenterItem) {
    const disabled = pendingItemId === item.id;
    const openTask = <TaskLink item={item} label={copy.openTask ?? "Open Task"} />;

    if (item.kind === "schedule_proposal") {
      return {
        primaryAction: (
          <Button type="button" size="sm" disabled={disabled} onClick={() => void runItemAction(item, "approve")}>
            {copy.acceptProposal ?? "Accept Proposal"}
          </Button>
        ),
        secondaryActions: (
          <>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void runItemAction(item, "reject")}>
              {copy.rejectProposal ?? "Reject Proposal"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <LocalizedLink href="/schedule">{copy.openSchedule ?? "Open Schedule"}</LocalizedLink>
            </Button>
          </>
        ),
      };
    }

    if (item.kind === "approval") {
      return {
        primaryAction: (
          <Button type="button" size="sm" disabled={disabled} onClick={() => void runItemAction(item, "approve")}>
            {copy.approve ?? "Approve"}
          </Button>
        ),
        secondaryActions: (
          <>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void runItemAction(item, "reject")}>
              {copy.reject ?? "Reject"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void runItemAction(item, "edit")}>
              {copy.editAndApprove ?? "Edit and Approve"}
            </Button>
            {openTask}
          </>
        ),
      };
    }

    if (item.kind === "recovery") {
      return {
        primaryAction: (
          <Button type="button" size="sm" disabled={disabled} onClick={() => void runItemAction(item, "approve")}>
            {copy.recoverRun ?? copy.retry ?? "Recover run"}
          </Button>
        ),
        secondaryActions: openTask,
      };
    }

    if (item.kind === "blocked") {
      return {
        primaryAction: (
          <Button type="button" size="sm" disabled={disabled} onClick={() => void runItemAction(item, "approve")}>
            {copy.resume ?? "Resume"}
          </Button>
        ),
        secondaryActions: openTask,
      };
    }

    if (item.kind === "execution_completed") {
      return {
        primaryAction: <TaskLink item={item} label={copy.reviewResults ?? "Review results"} variant="default" />,
        secondaryActions: openTask,
      };
    }

    return {
      primaryAction: <TaskLink item={item} label={copy.openTask ?? "Open Task"} variant="default" />,
    };
  }

  return (
    <div className="space-y-3">
      {actionError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}
      <ActionCenterList
        items={items.map((item) => ({
          ...item,
          ...actionProps(item),
        }))}
        copy={copy}
      />
    </div>
  );
}
