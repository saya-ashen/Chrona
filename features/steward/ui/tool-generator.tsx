import { useId, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { generateToolSchema, type generatedToolSchema } from "@chrona/contracts";
import type { z } from "zod";
import { Button, Checkbox, Input, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Textarea } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { eventRuleSpec, hasBothSamples, panelColumns, tablePanelSpec, type PanelColumn, type SampleCase } from "../model/controls";
import { initialSignals, signalKeys, signalOptions, updateSignal } from "../model/tool-form";
import { useStewardMutation } from "../hooks/use-steward-mutation";

export function ToolGenerator({ affairId, client, refresh }: { affairId: string; client: StewardClient; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.steward, t = c.controls;
  const id = useId(), mutation = useStewardMutation(refresh);
  const [signals, setSignals] = useState(initialSignals);
  const [name, setName] = useState(""), [purpose, setPurpose] = useState("");
  const [kind, setKind] = useState<"event_rule" | "table_panel">("event_rule");
  const [keywords, setKeywords] = useState(""), [author, setAuthor] = useState(""), [note, setNote] = useState("");
  const [disposition, setDisposition] = useState<"retain" | "digest" | "await_decision">("digest");
  const [cases, setCases] = useState<SampleCase[]>([{ title: "", body: "", author: "", expectMatch: true }, { title: "", body: "", author: "", expectMatch: false }]);
  const [columns, setColumns] = useState<PanelColumn[]>(["title"]), [source, setSource] = useState<"affair_events" | "affair_attention">("affair_events");
  const [answer, setAnswer] = useState<z.output<typeof generatedToolSchema> | null>(null), [invalid, setInvalid] = useState(false);
  function sample(index: number, patch: Partial<SampleCase>) { setCases(current => current.map((item, i) => i === index ? { ...item, ...patch } : item)); }
  return <details><summary className="cursor-pointer font-semibold">{t.needTool}</summary><form className="space-y-3 pt-3" onSubmit={event => {
    event.preventDefault(); setAnswer(null); setInvalid(false);
    const spec = kind === "event_rule" ? eventRuleSpec(keywords, author, disposition, note, cases) : tablePanelSpec(columns, source, t.columnLabels);
    if (kind === "event_rule" ? !hasBothSamples(cases) || !keywords.split(",").some(s => s.trim()) || !note.trim() : columns.length === 0) { setInvalid(true); return; }
    const input = generateToolSchema.safeParse({ affairId, name, purpose, signals, spec });
    if (!input.success) { setInvalid(true); return; }
    void mutation.run(async () => { setAnswer(await client.generateTool(input.data)); });
  }}>
    <Label htmlFor={`${id}-name`}>{t.name}</Label><Input id={`${id}-name`} required maxLength={200} value={name} onChange={e => setName(e.target.value)} />
    <Label htmlFor={`${id}-purpose`}>{c.purpose}</Label><Textarea id={`${id}-purpose`} required maxLength={4000} value={purpose} onChange={e => setPurpose(e.target.value)} />
    {signalKeys.map(key => <div key={key}><Label htmlFor={`${id}-${key}`}>{t.questions[key]}</Label><Select value={String(signals[key])} onValueChange={value => setSignals(current => updateSignal(current, key, value))}><SelectTrigger id={`${id}-${key}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{signalOptions[key].map(value => <SelectItem key={value} value={value}>{t.answers[value]}</SelectItem>)}</SelectContent></Select></div>)}
    <Label htmlFor={`${id}-spec`}>{t.spec}</Label><Select value={kind} onValueChange={value => setKind(value as typeof kind)}><SelectTrigger id={`${id}-spec`} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(["event_rule", "table_panel"] as const).map(value => <SelectItem key={value} value={value}>{t[value]}</SelectItem>)}</SelectContent></Select>
    {kind === "event_rule" ? <fieldset className="space-y-3"><legend>{t.event_rule}</legend>
      <Label htmlFor={`${id}-keywords`}>{c.keywords}</Label><Input id={`${id}-keywords`} required value={keywords} onChange={e => setKeywords(e.target.value)} />
      <Label htmlFor={`${id}-author`}>{t.optionalAuthor}</Label><Input id={`${id}-author`} maxLength={200} value={author} onChange={e => setAuthor(e.target.value)} />
      <Label htmlFor={`${id}-disposition`}>{t.disposition}</Label><Select value={disposition} onValueChange={value => setDisposition(value as typeof disposition)}><SelectTrigger id={`${id}-disposition`} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(["retain", "digest", "await_decision"] as const).map(value => <SelectItem key={value} value={value}>{t[value]}</SelectItem>)}</SelectContent></Select>
      <Label htmlFor={`${id}-note`}>{t.note}</Label><Textarea id={`${id}-note`} required maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />
      <h4>{t.samples}</h4><p>{t.sampleHint}</p>{cases.map((item, index) => <fieldset key={index} className="space-y-2 rounded border p-3"><legend>{t.samples} {index + 1}</legend>
        {(["title", "body", "author"] as const).map(key => <div key={key}><Label htmlFor={`${id}-sample-${index}-${key}`}>{key === "title" ? t.sampleTitle : key === "body" ? t.sampleBody : t.sampleAuthor}</Label><Textarea id={`${id}-sample-${index}-${key}`} maxLength={key === "title" ? 500 : key === "body" ? 8000 : 200} value={item[key]} onChange={e => sample(index, { [key]: e.target.value })} /></div>)}
        <div className="flex items-center gap-2"><Checkbox id={`${id}-match-${index}`} checked={item.expectMatch} onCheckedChange={value => sample(index, { expectMatch: value === true })} /><Label htmlFor={`${id}-match-${index}`}>{t.expectMatch}</Label></div>
        <Button type="button" variant="outline" disabled={cases.length <= 2} onClick={() => setCases(current => current.filter((_, i) => i !== index))}>{t.removeSample}</Button>
      </fieldset>)}<Button type="button" variant="outline" disabled={cases.length >= 20} onClick={() => setCases(current => [...current, { title: "", body: "", author: "", expectMatch: false }])}>{t.addSample}</Button>
    </fieldset> : <fieldset className="space-y-3"><legend>{t.table_panel}</legend><h4>{t.columns}</h4>{panelColumns.map(key => <div key={key} className="flex items-center gap-2"><Checkbox id={`${id}-column-${key}`} checked={columns.includes(key)} onCheckedChange={checked => setColumns(current => checked === true ? [...current, key] : current.filter(value => value !== key))} /><Label htmlFor={`${id}-column-${key}`}>{t.columnLabels[key]}</Label></div>)}
      <Label htmlFor={`${id}-source`}>{t.source}</Label><Select value={source} onValueChange={value => setSource(value as typeof source)}><SelectTrigger id={`${id}-source`} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(["affair_events", "affair_attention"] as const).map(value => <SelectItem key={value} value={value}>{t[value]}</SelectItem>)}</SelectContent></Select>
    </fieldset>}
    {invalid && <p role="alert">{t.invalidSpec}</p>}
    {mutation.notice && mutation.notice !== "saved" && <p role="alert">{c[mutation.notice]} {mutation.reason}<Button type="button" onClick={() => { mutation.reset(); refresh(); }}>{c.retry}</Button></p>}
    {answer && <p role="status">{c.handlingModes[answer.choice.mode]} — {answer.created ? t.created : t.noTool}: {answer.choice.rationale}</p>}
    <Button type="submit" disabled={mutation.busy || mutation.notice === "mutationError"}>{t.generate}</Button>
  </form></details>;
}
