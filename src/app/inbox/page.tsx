import { ControlPlaneShell } from "@/components/control-plane-shell";
import { InboxPageClient } from "@/components/inbox/inbox-page-client";
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

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <InboxPageClient workspaceId={workspace.id} initialData={items} copy={dictionary.components.inboxList} />
      </div>
    </ControlPlaneShell>
  );
}
