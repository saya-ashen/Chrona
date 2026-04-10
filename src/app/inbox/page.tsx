import {
  approveApproval,
  acceptScheduleProposal,
  editAndApproveApproval,
  rejectScheduleProposal,
  rejectApproval,
} from "@/app/actions/task-actions";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { InboxList } from "@/components/inbox/inbox-list";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getInbox } from "@/modules/queries/get-inbox";
import { getDefaultWorkspace } from "@/modules/workspaces/get-default-workspace";

export default async function InboxPage(props: { params?: Promise<{ lang?: string }> }) {
  const locale = resolveLocale((await props.params)?.lang);
  const dictionary = await getDictionary(locale);
  const t = dictionary.pages.inbox;
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
              {t.approve}
            </button>
          </form>
          <form action={rejectApproval.bind(null, item.id)}>
            <button
              type="submit"
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white"
            >
              {t.reject}
            </button>
          </form>
          <form action={editAndApproveApproval} className="flex flex-wrap gap-2">
            <input type="hidden" name="approvalId" value={item.id} />
            <input
              type="text"
              name="editedContent"
              placeholder={t.editPlaceholder}
              className="min-w-48 rounded-md border bg-background px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md border px-3 py-2 text-sm text-foreground">
              {t.editAndApprove}
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
              {t.acceptProposal}
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
              {t.rejectProposal}
            </button>
          </form>
          <LocalizedLink
            href="/schedule"
            className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {t.openSchedule}
          </LocalizedLink>
        </>
      ) : (
        <LocalizedLink
          href={`/workspaces/${item.workspaceId}/work/${item.sourceTaskId}`}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t.openWorkbench}
        </LocalizedLink>
      )
    ),
  }));

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <InboxList items={itemsWithActions} copy={dictionary.components.inboxList} />
      </div>
    </ControlPlaneShell>
  );
}
