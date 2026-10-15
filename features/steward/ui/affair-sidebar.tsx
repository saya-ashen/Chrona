import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import type { AffairDetail } from "@chrona/contracts";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import { useCareForm } from "../hooks/use-affairs";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import type { StewardClient } from "../model/client";
import { formatCadence } from "../model/format";
import { MutationStatus } from "./resource-status";
import { Surface } from "./layout";

type SidebarProps = { detail: AffairDetail; client: StewardClient; refresh: () => void };

function CareEditor({ form }: { form: ReturnType<typeof useCareForm> }) {
  const copy = useI18n().messages.steward.affairs;
  return <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void form.save(); }}>
    <label className="grid gap-1">{copy.minutes}<Input type="number" min={5} max={10080} step={1} value={form.minutes} disabled={form.pending} onChange={e => form.setMinutes(e.target.value)} /></label>
    <Select value={form.notify} onValueChange={form.setNotify} disabled={form.pending}>
      <SelectTrigger aria-label={copy.notify}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="now">{copy.nowNotify}</SelectItem><SelectItem value="digest">{copy.digest}</SelectItem><SelectItem value="web">{copy.web}</SelectItem></SelectContent>
    </Select>
    {form.invalid && <p role="alert">{copy.careInvalid}</p>}
    <div className="flex justify-end gap-2">
      <Button size="sm" disabled={form.pending}>{copy.save}</Button>
      <Button size="sm" type="button" variant="ghost" disabled={form.pending} onClick={() => form.setEditing(false)}>{copy.cancel}</Button>
    </div>
  </form>;
}

function CarePanel({ detail, client, refresh }: SidebarProps) {
  const { messages, locale } = useI18n(), copy = messages.steward.affairs, a = detail.affair;
  const form = useCareForm(client, a, refresh);
  return <Surface><section className="grid gap-3 p-4">
    <h2 className="font-semibold">{copy.care}</h2>
    {a.care ? <>
      <p>{formatCadence(a.care.cadenceSeconds, copy.cadence, locale)} · {a.care.notify === "now" ? copy.nowNotify : copy[a.care.notify]}</p>
      {a.care.lastCheckAt && <p>{copy.lastCheck}: {new Date(a.care.lastCheckAt).toLocaleString(locale)}</p>}
      {a.care.nextCheckAt && <p>{copy.nextCheck}: {new Date(a.care.nextCheckAt).toLocaleString(locale)}</p>}
    </> : <p>{copy.noCare}</p>}
    {!form.editing ? <Button className="w-fit" size="sm" variant="outline" disabled={form.pending} onClick={form.begin}>{a.care ? copy.edit : copy.startCare}</Button> : <CareEditor form={form} />}
    {a.care && <Button className="w-fit" size="sm" variant="ghost" disabled={form.pending} onClick={() => void form.stop()}>{copy.stopCare}</Button>}
    <MutationStatus mutation={form} />
  </section></Surface>;
}

function ToolsPanel({ detail }: { detail: AffairDetail }) {
  const { messages, locale } = useI18n(), copy = messages.steward.affairs;
  if (!detail.affair.care?.connectionId && detail.tools.length === 0) return <Surface><p className="p-4 text-muted-foreground">{copy.noTools}</p></Surface>;
  return <Surface><section className="grid gap-3 p-4">
    <h2 className="font-semibold">{copy.tools}</h2>
    {detail.affair.care?.connectionId && <Link className="underline" to={`/${locale}/settings`}>{copy.connectedSource}</Link>}
    {detail.tools.length === 0 && <p>{copy.none}</p>}
    <ul className="grid gap-3">{detail.tools.map(tool => <li key={tool.id}>
      <p>{tool.kind === "panel" ? <Link className="underline" to={`/${locale}/tools/${encodeURIComponent(tool.id)}`}>{tool.name}</Link> : tool.name} · {copy.toolStates[tool.state]}</p>
      <p>{tool.purpose}</p>
      {tool.kind === "script" && <p>{copy.version} {tool.version} · {tool.approvedVersion === tool.version ? `${copy.approved} ${tool.approvedVersion}` : copy.notApproved}</p>}
    </li>)}</ul>
  </section></Surface>;
}

export function AffairSidebar({ detail, client, refresh }: SidebarProps) {
  const copy = useI18n().messages.steward.affairs, a = detail.affair;
  const revoke = useStewardMutation(refresh);
  return <aside className="grid min-w-0 gap-5 text-sm [&_h2]:text-sm [&_h2]:text-muted-foreground">
    <CarePanel detail={detail} client={client} refresh={refresh} />
    {a.handling && <Surface><section className="grid gap-3 p-4">
      <h2 className="font-semibold">{copy.handling}</h2><p>{copy.modes[a.handling.mode]}</p><p>{a.handling.rationale}</p>
    </section></Surface>}
    <ToolsPanel detail={detail} />
    {detail.grants.length > 0 && <Surface><section className="grid gap-3 p-4">
      <h2 className="font-semibold">{copy.grants}</h2>
      <ul className="grid gap-3">{detail.grants.map(grant => <li key={grant.id} className="grid gap-2">
        <p>{copy.actions[grant.action]} · {copy.grantModes[grant.mode]}</p>
        <Button className="w-fit" size="sm" variant="outline" disabled={revoke.pending} onClick={() => void revoke.run(() => client.revokeGrant(grant.id))}>{copy.revoke}</Button>
      </li>)}</ul>
      <MutationStatus mutation={revoke} />
    </section></Surface>}
  </aside>;
}
