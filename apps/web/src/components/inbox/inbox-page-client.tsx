"use client";

import { startTransition, useCallback, useState } from "react";
import {
  acceptScheduleProposal,
  approveApproval,
  editAndApproveApproval,
  rejectApproval,
  rejectScheduleProposal,
} from "@/lib/task-actions-client";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { InboxList } from "@/components/inbox/inbox-list";

type InboxPageClientProps = {
  workspaceId: string;
  initialData: Awaited<ReturnType<typeof import("@/modules/queries/get-inbox").getInbox>>;
  copy: Parameters<typeof InboxList>[0]["copy"] & {
    openSchedule?: string;
    acceptProposal?: string;
    rejectProposal?: string;
    editPlaceholder?: string;
  };
};

export function InboxPageClient({ workspaceId, initialData, copy }: InboxPageClientProps) {
  const [items, setItems] = useState(initialData);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/inbox/projection?workspaceId=${encodeURIComponent(workspaceId)}`, {
      cache: "no-store",
    });

    if (!response.ok) return;

    const next = await response.json();
    startTransition(() => setItems(next));
  }, [workspaceId]);

  return (
    <InboxList
      items={items.map((item) => ({
        ...item,
        actions:
          item.kind === "approval" ? (
            <>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  await approveApproval(item.id);
                  await refresh();
                }}
              >
                <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                  {copy?.approve ?? "Approve"}
                </button>
              </form>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  await rejectApproval(item.id);
                  await refresh();
                }}
              >
                <button type="submit" className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white">
                  {copy?.reject ?? "Reject"}
                </button>
              </form>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  await editAndApproveApproval(formData);
                  await refresh();
                }}
                className="flex flex-wrap gap-2"
              >
                <input type="hidden" name="approvalId" value={item.id} />
                <input type="text" name="editedContent" placeholder={copy?.editPlaceholder} className="min-w-48 rounded-md border bg-background px-3 py-2 text-sm" />
                <button type="submit" className="rounded-md border px-3 py-2 text-sm text-foreground">
                  {copy?.editAndApprove ?? "Edit and Approve"}
                </button>
              </form>
            </>
          ) : item.kind === "schedule_proposal" ? (
            <>
              <form onSubmit={async (event) => { event.preventDefault(); await acceptScheduleProposal(item.id, "Accepted from inbox"); await refresh(); }}>
                <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                  {copy?.acceptProposal ?? "Accept"}
                </button>
              </form>
              <form onSubmit={async (event) => { event.preventDefault(); await rejectScheduleProposal(item.id, "Rejected from inbox"); await refresh(); }}>
                <button type="submit" className="rounded-md border px-3 py-2 text-sm text-foreground">
                  {copy?.rejectProposal ?? "Reject"}
                </button>
              </form>
              <LocalizedLink href="/schedule" className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted">
                {copy?.openSchedule ?? "Open Schedule"}
              </LocalizedLink>
            </>
          ) : (
            <LocalizedLink href={`/workspaces/${item.workspaceId}/work/${item.sourceTaskId}`} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              {copy?.openWorkbench ?? "Open Workbench"}
            </LocalizedLink>
          ),
      }))}
      copy={copy}
    />
  );
}
