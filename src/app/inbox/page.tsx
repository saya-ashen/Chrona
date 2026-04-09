import { ControlPlaneShell } from "@/components/control-plane-shell";
import { InboxList } from "@/components/inbox/inbox-list";
import {
  approveApproval,
  acceptScheduleProposal,
  editAndApproveApproval,
  rejectScheduleProposal,
  rejectApproval,
} from "@/app/actions/task-actions";
import Link from "next/link";
import { getInbox } from "@/modules/queries/get-inbox";
import { getDefaultWorkspace } from "@/modules/workspaces/get-default-workspace";

export default async function InboxPage() {
  const workspace = await getDefaultWorkspace();
  const items = await getInbox(workspace.id);

  const itemsWithActions = items.map((item) => ({
    ...item,
    actions: (
      item.kind === "approval" ? (
        <>
          <form action={approveApproval.bind(null, item.id)}>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Approve
            </button>
          </form>
          <form action={rejectApproval.bind(null, item.id)}>
            <button
              type="submit"
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white"
            >
              Reject
            </button>
          </form>
          <form action={editAndApproveApproval} className="flex flex-wrap gap-2">
            <input type="hidden" name="approvalId" value={item.id} />
            <input
              type="text"
              name="editedContent"
              placeholder="Edited instruction"
              className="min-w-48 rounded-md border bg-background px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md border px-3 py-2 text-sm text-foreground">
              Edit and Approve
            </button>
          </form>
        </>
      ) : item.kind === "schedule_proposal" ? (
        <>
          <form
            action={async () => {
              "use server";

              await acceptScheduleProposal(item.id, "Accepted from inbox");
            }}
          >
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Accept Proposal
            </button>
          </form>
          <form
            action={async () => {
              "use server";

              await rejectScheduleProposal(item.id, "Rejected from inbox");
            }}
          >
            <button
              type="submit"
              className="rounded-md border px-3 py-2 text-sm text-foreground"
            >
              Reject Proposal
            </button>
          </form>
          <Link
            href="/schedule"
            className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Open Schedule
          </Link>
        </>
      ) : (
        <Link
          href={`/workspaces/${item.workspaceId}/work/${item.sourceTaskId}`}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Open Workbench
        </Link>
      )
    ),
  }));

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Triage approvals, input requests, schedule proposals, and recovery work from one interruption queue.
          </p>
        </div>
        <InboxList items={itemsWithActions} />
      </div>
    </ControlPlaneShell>
  );
}
