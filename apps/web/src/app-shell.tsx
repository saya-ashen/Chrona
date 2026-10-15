import { PageColumn } from "@features/steward";
import { NavLink, Outlet, useLoaderData } from "react-router-dom";
import { localizeHref, useI18n } from "@chrona/i18n";
import { I18nProvider } from "@chrona/i18n/react";
import { Button } from "@shared/ui";
import { Composer, StewardSession, useStewardSession } from "@features/steward";
import { AccessKeyGate } from "@/components/access-key-gate";
import { LocalizedLink } from "@/components/i18n/localized-link";
import type { AppBootData } from "./pages";

export function AppShell() {
  const data = useLoaderData() as AppBootData;
  return <I18nProvider locale={data.locale} messages={data.dictionary}>
    <AccessKeyGate><StewardSession key={data.defaultWorkspace.id} workspaceId={data.defaultWorkspace.id}>
      <ShellContent data={data} />
    </StewardSession></AccessKeyGate>
  </I18nProvider>;
}

function ShellContent({ data }: { data: AppBootData }) {
  const { locale, messages } = useI18n();
  const copy = messages.steward.shell;
  const session = useStewardSession();
  const settings = session.settings;
  const navigation = [
    { href: "/", label: copy.today },
    { href: "/affairs", label: copy.affairs },
    { href: "/settings", label: copy.settings },
  ];
  return <div className="min-h-screen min-w-0 [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <header className="border-b bg-card">
      <PageColumn className="flex flex-wrap items-center gap-4 py-3">
      <LocalizedLink href="/" className="font-semibold">Chrona</LocalizedLink>
      <nav aria-label={copy.navigation} className="flex flex-wrap gap-4">
        {navigation.map(item => <NavLink key={item.href} to={localizeHref(locale, item.href)} end={item.href === "/"}
          className={({ isActive }) => isActive ? "font-semibold underline underline-offset-4" : "text-muted-foreground hover:underline"}>
          {item.label}
        </NavLink>)}
      </nav>
      <div className="min-w-0 text-sm text-muted-foreground sm:ml-auto" aria-live="polite">
        {settings.error ? <span>{copy.statusUnavailable} <Button variant="ghost" onClick={settings.refresh}>{messages.steward.foundation.retry}</Button></span>
          : settings.data ? <span>{settings.data.chat.bound ? `${copy.chatConnected} · ${copy.sentToday.replace("{count}", String(settings.data.chat.sentToday)).replace("{cap}", String(settings.data.notifications.dailyCap))}` : copy.chatDisconnected}</span>
          : <span>{messages.steward.foundation.loading}</span>}
      </div>
      </PageColumn>
    </header>
    <main className="min-w-0">
      <PageColumn className="pb-0">
        <Composer client={session.today.client} lang={locale} refresh={session.refresh} onPendingChange={session.setChatPending} />
      </PageColumn>
      <Outlet context={data} />
    </main>
  </div>;
}
