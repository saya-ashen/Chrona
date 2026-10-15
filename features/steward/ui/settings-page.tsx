import type { ReactNode } from "react";
import { useI18n } from "@chrona/i18n";
import { GRANT_MODES, type GrantMode, type Settings } from "@chrona/contracts";
import { Badge, Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import { useNotificationForm, useSettings } from "../hooks/use-settings";
import type { StewardClient } from "../model/client";
import { ConnectorsSection } from "./settings-connectors";
import { MutationStatus, ResourceStatus } from "./resource-status";
import { PageColumn, Surface, InlineForm } from "./layout";

const sections = ["chat", "notifications", "permissions", "preferences", "connections", "provider", "health"] as const;
type SettingsState = ReturnType<typeof useSettings>;
type LoadedSettings = NonNullable<SettingsState["data"]>;
type SectionProps = { s: SettingsState; d: LoadedSettings };

export function SettingsSection({ name, children }: { name: (typeof sections)[number]; children: ReactNode }) {
  const c = useI18n().messages.steward.settings;
  return <section id={`settings-${name}`} aria-labelledby={`heading-${name}`} className="min-w-0 scroll-mt-6">
    <Surface>
      <header className="grid gap-1 px-5 py-4">
        <h2 id={`heading-${name}`} className="font-semibold">{c[name]}</h2>
        <p className="text-sm text-muted-foreground">{c.descriptions[name]}</p>
      </header>
      <div className="grid min-w-0 gap-4 p-5">{children}</div>
    </Surface>
  </section>;
}

function NotificationForm({ settings, client, refresh }: { settings: Settings; client: StewardClient; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.steward.settings;
  const f = useNotificationForm(settings, client, refresh);
  return <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void f.save(); }}>
    <fieldset disabled={f.pending} className="grid gap-4 [&>label]:grid [&>label]:grid-cols-[minmax(0,1fr)_auto] [&>label]:items-center [&>label]:gap-3 [&_input[type=time]]:w-auto [&_input[type=time]]:min-w-36 [&_input[type=time]]:shrink-0">
      <label>{c.cap}<Input className="w-28" type="number" min={0} max={50} value={f.cap} onChange={e => f.setCap(e.target.value)} /></label>
      <label>{c.quiet}<Checkbox checked={f.quiet} onCheckedChange={value => f.setQuiet(value === true)} /></label>
      {f.quiet && <div className="grid gap-3 [&>label]:flex [&>label]:items-center [&>label]:justify-between [&>label]:gap-3">
        <label>{c.start}<Input type="time" value={f.start} onChange={e => f.setStart(e.target.value)} /></label>
        <label>{c.end}<Input type="time" value={f.end} onChange={e => f.setEnd(e.target.value)} /></label>
      </div>}
      <label>{c.digest}<Input type="time" value={f.digest} onChange={e => f.setDigest(e.target.value)} /></label>
      <p className="text-xs text-muted-foreground">{c.timezone}: {settings.notifications.timezone}</p>
      {f.invalid && <p role="alert">{c.invalid}</p>}
      <Button className="w-auto justify-self-end">{messages.steward.affairs.save}</Button>
    </fieldset>
    <MutationStatus mutation={f} />
    {f.saved && <p role="status">{c.saved}</p>}
  </form>;
}

function NotificationsSection({ s, d }: SectionProps) {
  const { messages, locale } = useI18n(), c = messages.steward.settings, m = s.mutation;
  return <SettingsSection name="notifications">
    <NotificationForm settings={d.settings} client={s.client} refresh={s.refresh} />
    <p className="text-sm text-muted-foreground">{c.sent}: {d.settings.chat.sentToday} / {d.settings.notifications.dailyCap}</p>
    <details><summary className="cursor-pointer text-sm">{c.recent}</summary>
      {!d.notifications.length && <p>{messages.steward.affairs.none}</p>}
      <ul className="grid gap-4 pt-3">{d.notifications.map(n => <li key={n.id} className="grid gap-2">
        <p>{n.title} · {c.notificationStates[n.status]}</p>
        <p className="break-words">{n.body}</p>
        <p className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString(locale)}</p>
        <div className="flex flex-wrap gap-2">
          {(["useful", "not_useful"] as const).map(feedback => <Button key={feedback} size="sm" variant="outline" aria-pressed={n.feedback === feedback} disabled={m.pending} onClick={() => void m.run(() => s.client.notificationFeedback(n.id, { feedback }))}>{feedback === "useful" ? c.useful : c.notUseful}</Button>)}
          {n.status === "failed" && <Button size="sm" disabled={m.pending} onClick={() => void m.run(() => s.client.retryNotification(n.id))}>{messages.steward.foundation.retry}</Button>}
        </div>
        {n.lastError && <p>{n.lastError}</p>}
      </li>)}</ul>
    </details>
  </SettingsSection>;
}

function ScopedGrants({ s }: { s: SettingsState }) {
  const { messages } = useI18n(), c = messages.steward.settings, a = messages.steward.affairs;
  return <ul className="grid gap-3">{s.grants.map(g => <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 break-words">
    <p>{a.actions[g.action]} · {c.modes[g.mode]} · {c[g.scope.kind]} {g.scope.kind === "affair" ? g.scope.affairId : g.scope.kind === "connector" ? g.scope.connectorId : ""}</p>
    <Button size="sm" variant="outline" disabled={s.mutation.pending} onClick={() => void s.mutation.run(() => s.client.revokeGrant(g.id))}>{a.revoke}</Button>
  </li>)}</ul>;
}

function PermissionsSection({ s }: { s: SettingsState }) {
  const { messages } = useI18n(), c = messages.steward.settings, a = messages.steward.affairs;
  return <SettingsSection name="permissions">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm [&_th]:pb-3 [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:border-t [&_td]:py-3 [&_td]:pr-3">
        <thead><tr><th>{c.action}</th><th>{c.mode}</th><th className="hidden min-w-24 whitespace-nowrap sm:table-cell">{c.origin}</th></tr></thead>
        <tbody>{s.rows.map(row => <tr key={row.action}>
          <td className="w-full">{a.actions[row.action]}<span className="mt-1 block text-xs text-muted-foreground sm:hidden">{!row.editable ? c.fixed : row.grant ? c.custom : c.builtin}</span></td>
          <td>{row.editable ? <Select value={row.mode} disabled={s.mutation.pending} onValueChange={mode => void s.changeMode(row.action, mode as GrantMode)}>
            <SelectTrigger aria-label={a.actions[row.action]} className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{GRANT_MODES.map(mode => <SelectItem key={mode} value={mode}>{c.modes[mode]}</SelectItem>)}</SelectContent>
          </Select> : <span className="text-muted-foreground">{c.modes.never}</span>}</td>
          <td className="hidden min-w-24 whitespace-nowrap text-xs text-muted-foreground sm:table-cell">{!row.editable ? c.fixed : row.grant ? c.custom : c.builtin}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <ScopedGrants s={s} />
  </SettingsSection>;
}

function PreferencesSection({ s, d }: SectionProps) {
  const { messages, locale } = useI18n(), c = messages.steward.settings, m = s.mutation;
  return <SettingsSection name="preferences">
    {!d.preferences.length && <p>{messages.steward.affairs.none}</p>}
    <ul className="grid gap-3">{d.preferences.map(p => <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b pb-3">
      <p className="break-words">{p.text}</p>
      <p className="col-start-1 text-xs text-muted-foreground">{c[p.origin]} · {new Date(p.createdAt).toLocaleString(locale)}</p>
      <Button variant="ghost" size="sm" className="col-start-2 row-start-1 row-span-2" disabled={m.pending} onClick={() => void m.run(() => s.client.deletePreference(p.id))}>{c.delete}</Button>
    </li>)}</ul>
    <InlineForm onSubmit={e => { e.preventDefault(); void s.addPreference(); }}>
      <Input aria-label={c.add} maxLength={500} value={s.preference} disabled={m.pending} onChange={e => s.setPreference(e.target.value)} />
      <Button disabled={m.pending || !s.preference.trim()}>{c.add}</Button>
    </InlineForm>
  </SettingsSection>;
}

function HealthSection({ d }: { d: LoadedSettings }) {
  const { messages, locale } = useI18n(), c = messages.steward.settings;
  return <SettingsSection name="health">
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">{c.git} · {d.health.git ? c.available : c.unavailable}</Badge>
      <Badge variant="outline">{c.sandbox} · {d.health.jobsSandbox ? c.available : c.unavailable}</Badge>
    </div>
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm [&_dt]:text-muted-foreground [&_dd]:text-right [&_dd]:font-medium [&_dd]:tabular-nums">
      {(["queuedRuns", "runningRuns", "failedRunsToday", "dueSchedules", "failingConnectors", "queuedNotifications", "failedNotifications"] as const).map(key => <div key={key} className="contents"><dt>{c[key]}</dt><dd>{d.health[key]}</dd></div>)}
      <dt>{c.lastTick}</dt><dd>{d.health.lastTickAt ? new Date(d.health.lastTickAt).toLocaleString(locale) : messages.steward.affairs.none}</dd>
    </dl>
  </SettingsSection>;
}

export function SettingsPage() {
  const c = useI18n().messages.steward.settings;
  const s = useSettings(), d = s.data;
  return <PageColumn>
    <h1 className="text-2xl font-semibold">{c.title}</h1>
    <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <nav aria-label={c.nav} className="flex min-w-0 gap-1 overflow-x-auto pb-2 lg:sticky lg:top-6 lg:grid lg:w-44">
        {sections.map(key => <a className="shrink-0 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" key={key} href={`#settings-${key}`}>{c[key]}</a>)}
      </nav>
      <div className="grid min-w-0 gap-8">
        <ResourceStatus resource={s} /><MutationStatus mutation={s.mutation} />
        {d && <>
          <SettingsSection name="chat">
            <p>Chrona QQ Bot · <Badge variant="outline">{d.settings.chat.bound ? c.bound : c.unbound}</Badge></p>
            {!d.settings.chat.bound && <p className="break-words text-sm text-muted-foreground">{c.bind}</p>}
          </SettingsSection>
          <NotificationsSection s={s} d={d} />
          <PermissionsSection s={s} />
          <PreferencesSection s={s} d={d} />
          <SettingsSection name="connections"><ConnectorsSection client={s.client} connectors={d.connectors} affairs={d.affairs} refresh={s.refresh} /></SettingsSection>
          <SettingsSection name="provider">
            <p>{d.health.provider.name} · {d.health.provider.available ? c.available : c.unavailable}</p>
            <p>{d.health.provider.sandboxed ? c.bashEnabled : c.bashDisabled}</p>
            {d.health.provider.lastError && <p role="status">{d.health.provider.lastError}</p>}
          </SettingsSection>
          <HealthSection d={d} />
        </>}
      </div>
    </div>
  </PageColumn>;
}
