import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useI18n } from "@chrona/i18n";
import { GRANT_MODES, type GrantMode, type Settings } from "@chrona/contracts";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/ui";
import { useNotificationForm, useSettings } from "../hooks/use-settings";
import type { StewardClient } from "../model/client";
import { toolActions } from "../model/settings";
import { MutationStatus, ResourceStatus } from "./resource-status";
const sections = [
  "chat",
  "notifications",
  "permissions",
  "preferences",
  "connections",
  "tools",
  "health",
] as const;
function NotificationForm({
  settings,
  client,
  refresh,
}: {
  settings: Settings;
  client: StewardClient;
  refresh: () => void;
}) {
  const { messages } = useI18n(),
    c = messages.steward.settings,
    a = messages.steward.affairs;
  const f = useNotificationForm(settings, client, refresh);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void f.save();
      }}
    >
      <fieldset disabled={f.pending} className="grid gap-3">
        <label>
          {c.cap}
          <Input
            type="number"
            min={0}
            max={50}
            value={f.cap}
            onChange={(e) => f.setCap(e.target.value)}
          />
        </label>
        <label className="flex gap-2">
          <Checkbox checked={f.quiet} onCheckedChange={(value) => f.setQuiet(value === true)} />
          {c.quiet}
        </label>
        {f.quiet && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              {c.start}
              <Input type="time" value={f.start} onChange={(e) => f.setStart(e.target.value)} />
            </label>
            <label>
              {c.end}
              <Input type="time" value={f.end} onChange={(e) => f.setEnd(e.target.value)} />
            </label>
          </div>
        )}
        <label>
          {c.digest}
          <Input type="time" value={f.digest} onChange={(e) => f.setDigest(e.target.value)} />
        </label>
        <p>
          {c.timezone}: {settings.notifications.timezone}
        </p>
        {f.invalid && <p role="alert">{c.invalid}</p>}
        <Button>{a.save}</Button>
      </fieldset>
      <MutationStatus mutation={f} />
      {f.saved && <p role="status">{c.saved}</p>}
    </form>
  );
}
export function SettingsPage() {
  const { messages, locale } = useI18n(),
    c = messages.steward.settings,
    a = messages.steward.affairs,
    base = messages.steward.foundation;
  const s = useSettings(),
    d = s.data,
    m = s.mutation;
  const date = (value: string | null) => (value ? new Date(value).toLocaleString(locale) : a.none);
  const section = (key: (typeof sections)[number], children: ReactNode) => (
    <section
      id={`settings-${key}`}
      aria-labelledby={`heading-${key}`}
      className="grid min-w-0 scroll-mt-6 gap-3 border-b pb-6"
    >
      <h2 id={`heading-${key}`} className="text-lg font-semibold">
        {c[key]}
      </h2>
      {children}
    </section>
  );
  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-[10rem_minmax(0,1fr)]">
      <nav aria-label={c.nav} className="sticky top-6 hidden self-start md:grid">
        {sections.map((key) => (
          <a className="py-2" key={key} href={`#settings-${key}`}>
            {c[key]}
          </a>
        ))}
      </nav>
      <div className="grid min-w-0 gap-6">
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <ResourceStatus resource={s} />
        <MutationStatus mutation={m} />
        {d && (
          <>
            {section(
              "chat",
              <>
                <p>
                  Chrona QQ Bot ·{" "}
                  <Badge variant="outline">{d.settings.chat.bound ? c.bound : c.unbound}</Badge>
                </p>
                {!d.settings.chat.bound && <p className="break-words">{c.bind}</p>}
              </>,
            )}
            {section(
              "notifications",
              <>
                <NotificationForm settings={d.settings} client={s.client} refresh={s.refresh} />
                <p>
                  {c.sent}: {d.settings.chat.sentToday}
                </p>
                <details>
                  <summary>{c.recent}</summary>
                  {!d.notifications.length && <p>{a.none}</p>}
                  <ul className="grid gap-4">
                    {d.notifications.map((n) => (
                      <li key={n.id}>
                        <p>
                          {n.title} · {c.notificationStates[n.status]}
                        </p>
                        <p className="break-words">{n.body}</p>
                        <p>{date(n.createdAt)}</p>
                        <div className="flex flex-wrap gap-2">
                          {(["useful", "not_useful"] as const).map((feedback) => (
                            <Button
                              key={feedback}
                              variant="outline"
                              aria-pressed={n.feedback === feedback}
                              disabled={m.pending}
                              onClick={() =>
                                void m.run(() => s.client.notificationFeedback(n.id, { feedback }))
                              }
                            >
                              {feedback === "useful" ? c.useful : c.notUseful}
                            </Button>
                          ))}
                          {n.status === "failed" && (
                            <Button
                              disabled={m.pending}
                              onClick={() => void m.run(() => s.client.retryNotification(n.id))}
                            >
                              {base.retry}
                            </Button>
                          )}
                        </div>
                        {n.lastError && <p>{n.lastError}</p>}
                      </li>
                    ))}
                  </ul>
                </details>
              </>,
            )}
            {section(
              "permissions",
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th>{c.action}</th>
                        <th>{c.mode}</th>
                        <th>{c.origin}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((row) => (
                        <tr key={row.action}>
                          <td className="py-3">{a.actions[row.action]}</td>
                          <td>
                            {row.editable ? (
                              <Select
                                value={row.mode}
                                disabled={m.pending}
                                onValueChange={(mode) =>
                                  void s.changeMode(row.action, mode as GrantMode)
                                }
                              >
                                <SelectTrigger
                                  aria-label={a.actions[row.action]}
                                  className="w-full"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {GRANT_MODES.map((mode) => (
                                    <SelectItem key={mode} value={mode}>
                                      {c.modes[mode]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              c.modes.never
                            )}
                          </td>
                          <td>{!row.editable ? c.fixed : row.grant ? c.custom : c.builtin}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="grid gap-3">
                  {s.grants.map((g) => (
                    <li key={g.id} className="break-words">
                      <p>
                        {a.actions[g.action]} · {c.modes[g.mode]} · {c[g.scope.kind]}{" "}
                        {g.scope.kind === "affair"
                          ? g.scope.affairId
                          : g.scope.kind === "connection"
                            ? g.scope.connectionId
                            : g.scope.kind === "tool_version"
                              ? `${g.scope.toolId} · ${a.version} ${g.scope.version}`
                              : ""}
                      </p>
                      <Button
                        variant="outline"
                        disabled={m.pending}
                        onClick={() => void m.run(() => s.client.revokeGrant(g.id))}
                      >
                        {a.revoke}
                      </Button>
                    </li>
                  ))}
                </ul>
              </>,
            )}
            {section(
              "preferences",
              <>
                {!d.preferences.length && <p>{a.none}</p>}
                <ul className="grid gap-3">
                  {d.preferences.map((p) => (
                    <li key={p.id}>
                      <p className="break-words">{p.text}</p>
                      <p>
                        {c[p.origin]} · {date(p.createdAt)}
                      </p>
                      <Button
                        variant="outline"
                        disabled={m.pending}
                        onClick={() => void m.run(() => s.client.deletePreference(p.id))}
                      >
                        {c.delete}
                      </Button>
                    </li>
                  ))}
                </ul>
                <form
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void s.addPreference();
                  }}
                >
                  <Input
                    aria-label={c.add}
                    maxLength={500}
                    value={s.preference}
                    disabled={m.pending}
                    onChange={(e) => s.setPreference(e.target.value)}
                  />
                  <Button disabled={m.pending || !s.preference.trim()}>{c.add}</Button>
                </form>
              </>,
            )}
            {section(
              "connections",
              <>
                {!d.connections.length && <p>{a.none}</p>}
                <ul className="grid gap-4">
                  {d.connections.map((source) => (
                    <li key={source.id}>
                      <p>
                        {source.label}{" "}
                        <Badge variant="outline">{c.connectionStates[source.status]}</Badge>
                      </p>
                      <p>
                        {c.lastSuccess}: {date(source.lastSuccessAt)}
                      </p>
                      <p>{source.coverageNote}</p>
                      {source.lastError && <p>{source.lastError}</p>}
                      {source.status !== "revoked" && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={m.pending}
                            onClick={() =>
                              void m.run(() =>
                                s.client.transitionConnection(source.id, {
                                  action: source.status === "paused" ? "resume" : "pause",
                                }),
                              )
                            }
                          >
                            {source.status === "paused" ? a.resume : a.pause}
                          </Button>
                          <Button
                            disabled={m.pending}
                            onClick={() =>
                              void m.run(() =>
                                s.client.transitionConnection(source.id, { action: "revoke" }),
                              )
                            }
                          >
                            {a.revoke}
                          </Button>
                          <Button
                            disabled={m.pending || source.status === "paused"}
                            onClick={() => void m.run(() => s.client.syncConnection(source.id))}
                          >
                            {c.sync}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>,
            )}
            {section(
              "tools",
              <>
                {!d.tools.length && <p>{a.none}</p>}
                <ul className="grid gap-4">
                  {d.tools.map((tool) => (
                    <li key={tool.id} className="min-w-0">
                      <p>
                        {tool.kind === "panel" ? <Link className="underline" to={`/${locale}/tools/${encodeURIComponent(tool.id)}`}>{tool.name}</Link> : tool.name} · {a.toolStates[tool.state]} · {a.version} {tool.version}
                      </p>
                      <p>{tool.purpose}</p>
                      <p>
                        {tool.approvedVersion === tool.version
                          ? `${a.approved} ${tool.approvedVersion}`
                          : a.notApproved}
                      </p>
                      {tool.script && (
                        <details>
                          <summary>{c.source}</summary>
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">
                            <code>{tool.script.source}</code>
                          </pre>
                        </details>
                      )}
                      {tool.kind === "script" && <details>
                        <summary>{c.scriptRuns}</summary>
                        {!d.toolRuns[tool.id]?.length && <p>{a.none}</p>}
                        <ul>{d.toolRuns[tool.id]?.map(run => <li key={run.id}>
                          <p>{a.version} {run.version} · {c.runStates[run.status]} · {date(run.startedAt)}</p>
                          {run.output && <pre className="whitespace-pre-wrap break-all">{run.output}</pre>}
                          {run.error && <p className="break-all">{run.error}</p>}
                        </li>)}</ul>
                      </details>}
                      <div className="flex flex-wrap gap-2">
                        {toolActions(tool).map((action) => (
                          <Button
                            key={action}
                            disabled={m.pending}
                            onClick={() =>
                              void m.run(() =>
                                s.client.transitionTool(tool.id, {
                                  action,
                                  expectedVersion: tool.version,
                                }),
                              )
                            }
                          >
                            {c[action]}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </>,
            )}
            {section(
              "health",
              <>
                <p>
                  {d.health.agent.name} · {d.health.agent.available ? c.available : c.unavailable}
                </p>
                <p>{c.sandbox} · {d.health.sandbox.available ? c.available : c.unavailable} {d.health.sandbox.languages.join(", ")}</p>
                {d.health.agent.lastError && <p>{d.health.agent.lastError}</p>}
                <dl>
                  {(
                    [
                      "queuedAffairs",
                      "runningAffairs",
                      "failedAffairs",
                      "pendingEvents",
                      "failingConnections",
                      "queuedNotifications",
                      "failedNotifications",
                    ] as const
                  ).map((key) => (
                    <div key={key} className="flex justify-between gap-3">
                      <dt>{c[key]}</dt>
                      <dd>{d.health[key]}</dd>
                    </div>
                  ))}
                  <dt>{c.lastTick}</dt>
                  <dd>{date(d.health.lastTickAt)}</dd>
                </dl>
              </>,
            )}
          </>
        )}
      </div>
    </div>
  );
}
