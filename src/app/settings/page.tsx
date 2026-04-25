import { ControlPlaneShell } from "@/components/control-plane-shell";
import { AdvancedSettingsDialog } from "@/components/settings/advanced-settings-dialog";
import { AiClientsDialog } from "@/components/settings/ai-clients-dialog";
import { ScheduleAiSettingsPanel } from "@/components/settings/schedule-ai-settings-panel";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getWorkspaces } from "@/modules/queries/get-workspaces";

export default async function SettingsPage(props: {
  params?: Promise<{ lang?: string }>;
  searchParams?: Promise<{ panel?: string }>;
}) {
  const locale = resolveLocale((await props.params)?.lang);
  const dictionary = await getDictionary(locale);
  const t = dictionary.pages.settings;
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const showAiClientsDialog = searchParams?.panel === "ai-clients";
  const showAdvancedDialog = searchParams?.panel === "advanced";
  const workspaces = await getWorkspaces();

  return (
    <ControlPlaneShell>
      <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">AI Clients</h2>
            <p className="text-sm text-muted-foreground">{t.aiClientsDescription}</p>
          </div>
          <div className="mt-3">
            <LocalizedLink
              href="/settings?panel=ai-clients"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t.manageAiClients}
            </LocalizedLink>
          </div>
        </div>
        <ScheduleAiSettingsPanel
          title={t.scheduleAiTitle}
          description={t.scheduleAiDescription}
        />
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">{t.advancedTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.advancedDescription}</p>
          </div>
          <div className="mt-3">
            <LocalizedLink
              href="/settings?panel=advanced"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t.openAdvancedSettings}
            </LocalizedLink>
          </div>
        </div>
      </div>
      <AiClientsDialog isOpen={showAiClientsDialog} closeHref={`/${locale}/settings`} />
      <AdvancedSettingsDialog isOpen={showAdvancedDialog} closeHref={`/${locale}/settings`} workspaces={workspaces} />
    </ControlPlaneShell>
  );
}
