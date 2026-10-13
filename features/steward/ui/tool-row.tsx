import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import type { InboundEvent, ManagedTool, toolRunResultSchema } from "@chrona/contracts";
import type { z } from "zod";
import { Badge, Button, Card, CardContent } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { toolActions, toolProgress, toolTransitionInput } from "../model/controls";
import { useStewardMutation } from "../hooks/use-steward-mutation";

export function ToolRow({ tool, events, client, refresh }: { tool: ManagedTool; events: InboundEvent[]; client: StewardClient; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.steward, t = c.controls;
  const mutation = useStewardMutation(refresh);
  const [result, setResult] = useState<z.output<typeof toolRunResultSchema> | null>(null);
  return <Card><CardContent className="space-y-2 pt-4">
    <h3 className="font-semibold">{tool.name}</h3><p>{tool.purpose}</p><Badge variant="outline">{c.toolStates[tool.state]}</Badge>
    <ol aria-label={t.progress} className="flex flex-wrap gap-2 text-sm">{toolProgress(tool.state).map(({ step, reached, current }, index) => <li key={step} aria-current={current ? "step" : undefined} className={reached ? "font-semibold" : "text-muted-foreground"}>{index + 1}. {c.toolStates[step]} {reached ? "✓" : "○"}</li>)}</ol>
    <p>{c.handlingMode}: {c.handlingModes[tool.handlingMode]}</p><p>{c.whyTool}: {tool.selectionRationale || c.notProvided}</p>
    <p>{t.validation}: {tool.validationSummary ?? c.notProvided}</p><p>{t.version}: {tool.version}</p>
    <p>{t.lastRun}: {tool.lastRunAt ?? c.notProvided} · {c.lastSuccess}: {tool.lastSuccessAt ?? c.notProvided} · {c.lastFailure}: {tool.lastFailureAt ?? c.notProvided}</p>
    {tool.state === "validation_failed" && <p>{t.editHint}</p>}{tool.state === "validated" && <p>{t.authorizeHint}</p>}{tool.state === "enabled" && <p>{t.runHint}</p>}
    {mutation.notice && <p role={mutation.notice === "saved" ? "status" : "alert"}>{c[mutation.notice]} {mutation.reason}{mutation.notice === "mutationError" && <Button onClick={() => { mutation.reset(); refresh(); }}>{c.retry}</Button>}</p>}
    <div className="flex flex-wrap gap-2">{toolActions(tool.state).map(action => <Button key={action} disabled={mutation.busy || mutation.notice === "mutationError"} variant="outline" onClick={() => { setResult(null); void mutation.run(async () => {
      if (action === "run") setResult(await client.runTool(tool.id, { events: events.slice(0, 500).map(({ title, body, author }) => ({ title, body, author })) }));
      else await client.transitionTool(tool.id, toolTransitionInput(tool, action));
    }); }}>{t[action]}</Button>)}</div>
    {result && <div role="status" className="space-y-2"><h4>{t.matches} ({result.matches.length})</h4><ul>{result.matches.map(match => <li key={match.index}>{match.index + 1}: {match.matched ? t.matched : t.notMatched}{match.disposition && ` · ${match.disposition === "retain" || match.disposition === "digest" || match.disposition === "await_decision" ? t[match.disposition] : match.disposition}`}{match.note && ` · ${match.note}`}</li>)}</ul><h4>{t.rows} ({result.rows.length})</h4>{result.rows.map((row, index) => <dl key={index}>{Object.entries(row).map(([key, value]) => <div key={key}><dt>{key in t.columnLabels ? t.columnLabels[key as keyof typeof t.columnLabels] : key}</dt><dd>{value}</dd></div>)}</dl>)}</div>}
  </CardContent></Card>;
}
