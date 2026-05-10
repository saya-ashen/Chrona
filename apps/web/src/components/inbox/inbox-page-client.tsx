"use client";

import { LocalizedLink } from "@/components/i18n/localized-link";
import { InboxList } from "@/components/inbox/inbox-list";

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

export function InboxPageClient({ initialData, copy }: InboxPageClientProps) {
  return (
    <InboxList
      items={initialData.map((item) => ({
        ...item,
        actions:
          item.kind === "schedule_proposal" ? (
            <LocalizedLink href="/schedule" className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted">
              {copy?.openSchedule ?? "Open Schedule"}
            </LocalizedLink>
          ) : item.kind === "approval" ? null : (
            <LocalizedLink href={`/workspaces/${item.workspaceId}/work/${item.sourceTaskId}`} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              {copy?.openWorkbench ?? "Open Workbench"}
            </LocalizedLink>
          ),
      }))}
      copy={copy}
    />
  );
}
