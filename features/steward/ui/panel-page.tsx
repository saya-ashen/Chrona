import { PageColumn, Section, Surface } from "./layout";
import { useParams } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import type { ToolDetail } from "@chrona/contracts";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import { useStewardSession } from "../hooks/use-steward-session";
import { usePanel, usePanelForm } from "../hooks/use-panel";
import { toolSpecSchema, trendPoints, type ToolSpec } from "../model/panel";
import type { StewardClient } from "../model/client";
import { ResourceStatus, MutationStatus } from "./resource-status";
export function PanelContent({ detail, spec, client, refresh }: { detail: ToolDetail; spec: ToolSpec; client: StewardClient; refresh: () => void }) {
  const c = useI18n().messages.steward.panel;
  const f = usePanelForm(spec, client, detail.tool.id, refresh);
  const enabled = detail.tool.state === "enabled" && detail.tool.approvedVersion === detail.tool.version;
  return <div className="grid min-w-0 gap-6">
    <h1 className="text-2xl font-semibold break-words">{spec.title}</h1>
    <p className="break-words">{spec.description ?? detail.tool.purpose}</p>
    {!enabled && <p role="status">{c.disabled}</p>}
    <Surface><form className="p-5" onSubmit={e => { e.preventDefault(); void f.save(); }} noValidate>
      <fieldset disabled={!enabled || f.mutation.pending} className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spec.fields.map(field => <label key={field.key} className="grid min-w-0 gap-1">{field.label}{field.required ? " *" : ""}
          {field.type === "select" ? <Select value={f.values[field.key]} onValueChange={value => f.setValues({ ...f.values, [field.key]: value })} disabled={!enabled || f.mutation.pending}>
            <SelectTrigger aria-label={field.label}><SelectValue placeholder={c.choose} /></SelectTrigger>
            <SelectContent>{field.options?.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
          </Select> : <Input aria-label={field.label} type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} step="any" required={field.required} value={f.values[field.key] ?? ""} onChange={e => f.setValues({ ...f.values, [field.key]: e.target.value })} />}
        </label>)}
        <div className="flex justify-end sm:col-span-2 lg:col-span-3"><Button type="submit">{c.add}</Button></div>
      </fieldset>
      {f.invalid && <p role="alert">{c.invalid}</p>}
    </form></Surface>
    <MutationStatus mutation={f.mutation} />
    {detail.entries.length === 0 ? <p>{c.empty}</p> : <>
      {spec.views.map((view, index) => {
        if (view.kind !== "trend") return null;
        const trend = trendPoints(detail.entries, view.x, view.y);
        const label = `${spec.fields.find(f => f.key === view.y)?.label} / ${spec.fields.find(f => f.key === view.x)?.label}`;
        return <Section key={index} title={`${c.trend}: ${label}`}><Surface><div className="p-4">{!trend ? <p>{c.noTrend}</p> : <div role="img" aria-label={`${c.trend}: ${label}`} className="relative h-[220px] w-full text-sm text-foreground">
          {trend.points.length === 1 ? <div className="flex h-full flex-col items-center justify-center gap-2">
            <span>{trend.points[0]!.value}</span><span className="size-2 rounded-full bg-primary" />
            <span className="text-muted-foreground">{trend.first}</span>
          </div> : <>
            <div className="absolute inset-x-0 top-4 bottom-9 ml-16 mr-3 border-b border-l border-border">
              <svg aria-hidden="true" viewBox="60 40 480 160" preserveAspectRatio="none" className="h-full w-full overflow-visible text-primary">
                <polyline points={trend.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
              {trend.points.map((p, i) => <span key={i} title={`${p.date}: ${p.value}`} className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" style={{ left: `${(p.x - 60) / 480 * 100}%`, top: `${(p.y - 40) / 160 * 100}%` }} />)}
              <span className="absolute top-0 right-full pr-2 text-xs text-muted-foreground">{Number(trend.upper.toPrecision(6))}</span>
              <span className="absolute right-full bottom-0 pr-2 text-xs text-muted-foreground">{Number(trend.lower.toPrecision(6))}</span>
              <span className="absolute top-full left-0 pt-2 text-xs text-muted-foreground">{trend.first}</span>
              <span className="absolute top-full right-0 pt-2 text-xs text-muted-foreground">{trend.last}</span>
            </div>
          </>}
        </div>}</div></Surface></Section>;
      })}
      <Section title={c.entries}>
        <Surface><div className="min-w-0 overflow-x-auto p-4"><table aria-label={c.entries} className="w-full text-left text-sm"><thead><tr>{spec.fields.map(field => <th className="py-2 pr-4" key={field.key}>{field.label}</th>)}<th>{c.actions}</th></tr></thead>
          <tbody>{detail.entries.map(entry => <tr key={entry.id}>{spec.fields.map(field => <td className="py-2 pr-4 break-words" key={field.key}>{String(entry.values[field.key] ?? "—")}</td>)}<td>
            {f.confirm === entry.id ? <div className="flex flex-wrap gap-2"><span>{c.confirm}</span><Button variant="destructive" disabled={f.mutation.pending} onClick={() => void f.remove(entry.id)}>{c.delete}</Button><Button variant="ghost" disabled={f.mutation.pending} onClick={() => f.setConfirm(null)}>{c.cancel}</Button></div> : <Button variant="ghost" disabled={f.mutation.pending} onClick={() => f.setConfirm(entry.id)}>{c.delete}</Button>}
          </td></tr>)}</tbody></table></div></Surface>
      </Section>
    </>}
  </div>;
}
export function PanelPage() {
  const { toolId = "" } = useParams();
  const client = useStewardSession().today.client;
  const resource = usePanel(client, toolId);
  const c = useI18n().messages.steward.panel;
  const parsed = toolSpecSchema.safeParse(resource.data?.tool.spec);
  return <PageColumn><ResourceStatus resource={resource} />{resource.data && (resource.data.tool.kind === "panel" && parsed.success ? <PanelContent key={`${toolId}:${resource.data.tool.version}`} detail={resource.data} spec={parsed.data} client={client} refresh={resource.refresh} /> : <p role="alert">{c.unavailable}</p>)}</PageColumn>;
}
