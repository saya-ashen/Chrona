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
  return <section id={`settings-${name}`} aria-labelledby={`heading-${name}`} className="min-w-0 scroll-mt-20">
    <Surface className="gap-3 divide-y-0 p-3.5 text-[13px]">
      <h2 id={`heading-${name}`} className="text-[13px] font-semibold text-muted-foreground">{c[name]}</h2>
      <div className="grid min-w-0 gap-3">{children}</div>
    </Surface>
  </section>;
}

function NotificationForm({ settings, client, refresh }: { settings: Settings; client: StewardClient; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.steward.settings;
  const f = useNotificationForm(settings, client, refresh);
  return <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void f.save(); }}>
    <fieldset disabled={f.pending} className="grid min-w-0 gap-x-4 gap-y-2 min-[521px]:grid-cols-[160px_minmax(0,1fr)] [&_input]:h-10 [&_input]:w-[120px] [&_input]:max-w-full [&_input]:text-[13px] [&_input]:tabular-nums min-[761px]:[&_input]:h-8">
      <label className="self-center" htmlFor="notification-cap">{c.cap}</label>
      <div className="flex flex-wrap items-center gap-2"><Input id="notification-cap" type="number" min={0} max={50} value={f.cap} onChange={e => f.setCap(e.target.value)} /><span className="text-xs text-muted-foreground">{c.capHint}</span></div>
      <label className="self-center" htmlFor="notification-quiet">{c.quiet}</label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Checkbox id="notification-quiet" checked={f.quiet} onCheckedChange={value => f.setQuiet(value === true)} />
        {f.quiet && <>
          <Input aria-label={c.start} type="time" value={f.start} onChange={e => f.setStart(e.target.value)} />
          <span className="text-muted-foreground">{c.to}</span>
          <Input aria-label={c.end} type="time" value={f.end} onChange={e => f.setEnd(e.target.value)} />
        </>}
      </div>
      <label className="self-center" htmlFor="notification-digest">{c.digest}</label><Input id="notification-digest" type="time" value={f.digest} onChange={e => f.setDigest(e.target.value)} />
      <p className="col-span-full text-xs text-muted-foreground">{c.timezone}: {settings.notifications.timezone}</p>
      {f.invalid && <p role="alert">{c.invalid}</p>}
      <Button size="sm" variant="outline" className="col-span-full w-auto justify-self-start">{messages.steward.affairs.save}</Button>
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
    <Button size="sm" variant="ghost" disabled={s.mutation.pending} onClick={() => void s.mutation.run(() => s.client.revokeGrant(g.id))}>{a.revoke}</Button>
  </li>)}</ul>;
}

function PermissionsSection({ s }: { s: SettingsState }) {
  const { messages } = useI18n(), c = messages.steward.settings, a = messages.steward.affairs;
  return <SettingsSection name="permissions">
    <div className="overflow-x-auto" aria-label={c.permissions} tabIndex={0}>
      <table className="w-full min-w-[460px] text-left text-[13px] [&_th]:border-b [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:border-b [&_td]:p-2">
        <thead><tr><th>{c.action}</th><th>{c.mode}</th><th className="min-w-24 whitespace-nowrap">{c.origin}</th></tr></thead>
        <tbody>{s.rows.map(row => <tr key={row.action}>
          <td className="w-[52%]">{a.actions[row.action]}</td>
          <td>{row.editable ? <Select value={row.mode} disabled={s.mutation.pending} onValueChange={mode => void s.changeMode(row.action, mode as GrantMode)}>
            <SelectTrigger aria-label={a.actions[row.action]} className="h-10 w-auto min-w-32 gap-2 text-[13px] min-[761px]:h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{GRANT_MODES.map(mode => <SelectItem key={mode} value={mode}>{c.modes[mode]}</SelectItem>)}</SelectContent>
          </Select> : <span className="text-muted-foreground">{c.modes.never}</span>}</td>
          <td className="min-w-24 whitespace-nowrap text-xs text-muted-foreground">{!row.editable ? c.fixed : row.grant ? c.custom : c.builtin}</td>
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
    <ul className="grid">{d.preferences.map(p => <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 border-t py-2 first:border-0 min-[1000px]:grid-cols-[minmax(0,1fr)_auto_auto]">
      <p className="break-words">{p.text}</p>
      <p className="col-start-1 text-xs text-muted-foreground min-[1000px]:col-start-2">{c[p.origin]} · {new Date(p.createdAt).toLocaleDateString(locale)}</p>
      <Button variant="ghost" size="sm" className="col-start-2 row-span-2 row-start-1 min-[1000px]:col-start-3 min-[1000px]:row-span-1" disabled={m.pending} onClick={() => void m.run(() => s.client.deletePreference(p.id))}>{c.delete}</Button>
    </li>)}</ul>
    <InlineForm onSubmit={e => { e.preventDefault(); void s.addPreference(); }}>
      <Input aria-label={c.add} placeholder={c.preferenceHint} maxLength={500} value={s.preference} disabled={m.pending} onChange={e => s.setPreference(e.target.value)} />
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
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] [&_dt]:text-muted-foreground [&_dd]:tabular-nums">
      {(["queuedRuns", "runningRuns", "failedRunsToday", "dueSchedules", "failingConnectors", "queuedNotifications", "failedNotifications"] as const).map(key => <div key={key} className="contents"><dt>{c[key]}</dt><dd>{d.health[key]}</dd></div>)}
      <dt>{c.lastTick}</dt><dd>{d.health.lastTickAt ? new Date(d.health.lastTickAt).toLocaleString(locale) : messages.steward.affairs.none}</dd>
    </dl>
  </SettingsSection>;
}

export function SettingsPage() {
  const c = useI18n().messages.steward.settings;
  const s = useSettings(), d = s.data;
  return <PageColumn>
    <div className="grid min-w-0 items-start gap-7 min-[761px]:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label={c.nav} className="sticky top-16 hidden min-w-0 gap-0.5 min-[761px]:grid">
        {sections.map(key => <a className="rounded px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground" key={key} href={`#settings-${key}`}>{c[key]}</a>)}
      </nav>
      <div className="grid min-w-0 gap-5">
        <h1 className="text-2xl leading-8 font-semibold">{c.title}</h1>
        <ResourceStatus resource={s} /><MutationStatus mutation={s.mutation} />
        {d && <>
          <SettingsSection name="chat">
            <p className="leading-6"><Badge variant="secondary" className={`mr-2 rounded-full border-0 px-2 py-px text-xs ${d.settings.chat.bound ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{d.settings.chat.bound ? c.bound : c.unbound}</Badge>Chrona QQ Bot · <span className="text-muted-foreground">{d.settings.chat.bound ? c.descriptions.chat : c.bind}</span></p>
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
