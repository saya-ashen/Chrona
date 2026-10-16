import { Link } from "react-router-dom";
import type { Affair, Connector } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import { connectorStatusClass } from "../model/connector-status";
import type { StewardClient } from "../model/client";
import { useConnector, useEmailConnector } from "../hooks/use-connectors";
import { MutationStatus, ResourceStatus } from "./resource-status";

function ConnectorItem({ connector: source, client, refresh }: { connector: Connector; client: StewardClient; refresh: () => void }) {
  const { messages, locale } = useI18n(), c = messages.steward.settings, a = messages.steward.affairs;
  const s = useConnector(client, source.id, refresh), m = s.mutation;
  return <li className="grid min-w-0 gap-2 border-b pb-3 text-[13px]">
    <div className="flex flex-wrap items-center gap-2.5">
      <Badge variant="secondary" className={`rounded-full border-0 px-2 py-px text-xs ${connectorStatusClass(source.status)}`}>{c.connectionStates[source.status]}</Badge>
      <p className="break-words">{source.label}</p>
      <div className="text-xs text-muted-foreground min-[1000px]:ml-auto min-[1000px]:text-right">
        <p>{c.lastSync}: {source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString(locale) : a.none} · {c.pendingItems}: {source.pendingItems}</p>
        <p>{source.coverageNote}</p>
      </div>
    </div>
    {source.lastError && <p>{source.lastError}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={m.pending} onClick={() => void s.testConnection()}>{c.testConnection}</Button>
      <Button size="sm" variant="outline" disabled={m.pending || source.status === "paused"} onClick={() => void m.run(() => client.syncConnector(source.id))}>{c.sync}</Button>
      <Button size="sm" variant="outline" disabled={m.pending} onClick={() => void m.run(() => client.updateConnector(source.id, { settings: source.settings, status: source.status === "paused" ? "active" : "paused" }))}>{source.status === "paused" ? a.resume : a.pause}</Button>
    </div>
    <MutationStatus mutation={m} />
    {s.test && <p role="status">{s.test.ok ? c.testPassed : `${c.testFailed}: ${s.test.error}`}</p>}
    <details><summary>{c.inbound}</summary>
      <ResourceStatus resource={s.items} />
      {s.items.data && !s.items.data.items.length && <p>{a.none}</p>}
      <ul className="grid gap-3">{s.items.data?.items.map(item => <li key={item.id} className="break-words">
        <p>{item.from} · {item.subject} · {c.inboundStates[item.status]}</p>
        <p>{item.ruleNote}</p>
        {item.path && source.affairId && <Link className="underline" to={`/${locale}/affairs/${encodeURIComponent(source.affairId)}?path=${encodeURIComponent(item.path)}`}>{item.path}</Link>}
      </li>)}</ul>
    </details>
  </li>;
}

export function ConnectorsSection({ connectors, affairs, client, refresh }: { connectors: Connector[]; affairs: Affair[]; client: StewardClient; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.steward.settings;
  const f = useEmailConnector(client, refresh);
  return <>
    {!connectors.length && <p>{messages.steward.affairs.none}</p>}
    <ul className="grid min-w-0 gap-4">{connectors.map(connector => <ConnectorItem key={connector.id} connector={connector} client={client} refresh={refresh} />)}</ul>
    <details><summary>{c.addEmail}</summary>
      <form className="grid gap-3 pt-4" onSubmit={event => { event.preventDefault(); void f.save(c.mailbox); }}>
        <fieldset disabled={f.mutation.pending} className="grid gap-3 sm:grid-cols-2">
          {(["address", "imapHost", "imapPort", "smtpHost", "smtpPort", "folders", "password"] as const).map(key => <label key={key} className="grid min-w-0 gap-1">{c[key]}
            <Input required={key !== "smtpHost" && key !== "smtpPort"} type={key === "password" ? "password" : key.endsWith("Port") ? "number" : key === "address" ? "email" : "text"} min={key.endsWith("Port") ? 1 : undefined} max={key.endsWith("Port") ? 65535 : undefined} autoComplete={key === "password" ? "new-password" : "off"} value={f.fields[key]} onChange={event => f.update(key, event.target.value)} />
          </label>)}
          <label className="grid min-w-0 gap-1">{c.targetAffair}
            <Select value={f.fields.affairId} onValueChange={value => f.update("affairId", value)}><SelectTrigger aria-label={c.targetAffair}><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="new">{c.newMailbox}</SelectItem>
              {affairs.map(affair => <SelectItem key={affair.id} value={affair.id}>{affair.title}</SelectItem>)}
            </SelectContent></Select>
          </label>
          <p className="text-sm text-muted-foreground sm:col-span-2">{c.secretNote}</p>
          <Button type="submit">{c.addEmail}</Button>
        </fieldset>
        <MutationStatus mutation={f.mutation} />
      </form>
    </details>
  </>;
}
