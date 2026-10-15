import { useI18n } from "@chrona/i18n";
import type { PanelBlock } from "@chrona/domain";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { trendPoints } from "../model/panel";
import { useFilePanel } from "../hooks/use-file-panel";
import { ResourceStatus, MutationStatus } from "./resource-status";
import { Section, Surface } from "./layout";

/** The existing panel form/table/trend composition, backed by an affair CSV rather than a tool. */
export function FilePanel({ spec, client, affairId }: { spec: PanelBlock; client: StewardClient; affairId: string }) {
  const c = useI18n().messages.steward.panel;
  const f = useFilePanel(client, affairId, spec);
  return <Section title={spec.title}>
    {spec.description && <p>{spec.description}</p>}
    <ResourceStatus resource={f.resource} />
    {f.parsed.invalid ? <p role="alert">{c.invalid}</p> : f.resource.data && <>
      <Surface><form className="p-4" onSubmit={event => { event.preventDefault(); void f.save(); }}>
        <fieldset disabled={f.mutation.pending} className="grid min-w-0 gap-3 sm:grid-cols-2">
          {spec.fields.map(field => <label key={field.key} className="grid min-w-0 gap-1">{field.label}{field.required ? " *" : ""}
            {field.type === "select" ? <Select value={f.values[field.key]} onValueChange={value => f.setValues({ ...f.values, [field.key]: value })} disabled={f.mutation.pending}>
              <SelectTrigger aria-label={field.label}><SelectValue placeholder={c.choose} /></SelectTrigger><SelectContent>{field.options?.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
            </Select> : <Input aria-label={field.label} type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} step="any" required={field.required} value={f.values[field.key] ?? ""} onChange={event => f.setValues({ ...f.values, [field.key]: event.target.value })} />}
          </label>)}
          <Button type="submit">{c.add}</Button>
        </fieldset>
        {f.invalid && <p role="alert">{c.invalid}</p>}
      </form></Surface>
      <MutationStatus mutation={f.mutation} />
      {f.parsed.rows.length === 0 ? <p>{c.empty}</p> : <>
        {spec.views.map((view, index) => view.kind === "trend" ? <PanelTrend key={index} rows={f.parsed.rows} x={view.x} y={view.y} label={`${spec.fields.find(field => field.key === view.y)?.label} / ${spec.fields.find(field => field.key === view.x)?.label}`} /> : null)}
        <div className="min-w-0 overflow-x-auto"><table aria-label={c.entries} className="w-full text-left text-sm"><thead><tr>{spec.fields.map(field => <th className="p-2" key={field.key}>{field.label}</th>)}</tr></thead>
          <tbody>{f.parsed.rows.map(entry => <tr key={entry.id}>{spec.fields.map(field => <td className="p-2 break-words" key={field.key}>{String(entry.values[field.key] ?? "—")}</td>)}</tr>)}</tbody>
        </table></div>
      </>}
    </>}
  </Section>;
}
function PanelTrend({ rows, x, y, label }: { rows: { values: Record<string, unknown> }[]; x: string; y: string; label: string }) {
  const c = useI18n().messages.steward.panel;
  const trend = trendPoints(rows, x, y);
  return <Section title={`${c.trend}: ${label}`}>{!trend ? <p>{c.noTrend}</p> : <div role="img" aria-label={`${c.trend}: ${label}`} className="min-w-0">
    <svg aria-hidden="true" viewBox="0 0 600 240" className="w-full text-primary">
      <polyline points={trend.points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />
      {trend.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3" fill="currentColor" />)}
      <text x="0" y="25" fill="currentColor">{Number(trend.upper.toPrecision(6))}</text><text x="0" y="210" fill="currentColor">{Number(trend.lower.toPrecision(6))}</text>
    </svg>
    <p className="flex justify-between text-xs"><span>{trend.first}</span><span>{trend.last}</span></p>
  </div>}</Section>;
}
