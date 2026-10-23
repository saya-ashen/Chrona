import { PageColumn } from "@features/steward";
import { NavLink, Outlet, useLoaderData } from "react-router-dom";
import { localizeHref, useI18n } from "@chrona/i18n";
import { I18nProvider } from "@chrona/i18n/react";
import { Button } from "@shared/ui";
import { Composer, ProviderWork, StewardSession, useStewardSession } from "@features/steward";
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
    { href: "/apps", label: copy.apps },
    { href: "/chat", label: messages.steward.sessions.title },
    { href: "/settings", label: copy.settings },
  ];
  return <div className="steward-shell min-h-screen min-w-0 text-[15px] leading-[1.6] [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-sm">
      <PageColumn className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5">
      <LocalizedLink href="/" className="font-semibold">Chrona</LocalizedLink>
      <nav aria-label={copy.navigation} className="flex flex-wrap gap-1 text-[13px]">
        {navigation.map(item => <NavLink key={item.href} to={localizeHref(locale, item.href)} end={item.href === "/"}
          className={({ isActive }) => isActive ? "rounded-md bg-muted px-2.5 py-1 font-medium" : "rounded-md px-2.5 py-1 text-muted-foreground hover:underline"}>
          {item.label}
        </NavLink>)}
      </nav>
      <div className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <span aria-hidden="true" className={`size-[7px] shrink-0 rounded-full ${settings.data?.chat.bound ? "bg-success" : "bg-muted-foreground"}`} />
        {settings.error ? <span>{copy.statusUnavailable} <Button variant="ghost" onClick={settings.refresh}>{messages.steward.foundation.retry}</Button></span>
          : settings.data ? <span>{settings.data.chat.bound ? `${copy.chatConnected} · ${copy.sentToday.replace("{count}", String(settings.data.chat.sentToday)).replace("{cap}", String(settings.data.notifications.dailyCap))}` : copy.chatDisconnected}</span>
          : <span>{messages.steward.foundation.loading}</span>}
      </div>
      </PageColumn>
    </header>
    <main className="min-w-0">
      <PageColumn className="pb-0">
        <Composer client={session.today.client} lang={locale} refresh={session.refresh} onPendingChange={session.setChatPending} sessionId={session.sessionId} onSession={session.setSessionId} />
        <ProviderWork client={session.today.client} mode="questions" sessionId={session.sessionId} onChange={session.refresh} />
      </PageColumn>
      <Outlet context={data} />
    </main>
  </div>;
}
