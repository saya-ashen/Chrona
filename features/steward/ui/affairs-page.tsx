import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Badge, Button, Card, CardContent, Input, Label, Textarea } from "@shared/ui";
import { LocalizedLink } from "./localized-link";
import { useStewardClient, useStewardResource } from "../hooks/use-steward";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { parseKeywords } from "../model/affairs";

export function AffairsPage({ workspaceId }: { workspaceId: string }) {
  const { messages } = useI18n(), c = messages.steward;
  const client = useStewardClient(workspaceId), resource = useStewardResource(client.affairs);
  const mutation = useStewardMutation(resource.refresh);
  const [title, setTitle] = useState(""), [summary, setSummary] = useState(""), [goal, setGoal] = useState(""), [keywords, setKeywords] = useState("");
  return <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 p-4 [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <h1 className="text-2xl font-semibold">{c.affairs}</h1>
    {resource.loading && <p role="status">{c.loading}</p>}
    {resource.error && <p role="alert">{c.error} <Button onClick={resource.refresh}>{c.retry}</Button></p>}
    {mutation.notice && <p role={mutation.notice === "mutationError" ? "alert" : "status"}>{c[mutation.notice]}{mutation.notice === "mutationError" && <Button onClick={() => { mutation.reset(); resource.refresh(); }}>{c.retry}</Button>}</p>}
    {resource.data?.items.length === 0 && <div role="status"><p>{c.empty}</p><p>{c.affairEmpty}</p></div>}
    <ul className="space-y-3">{resource.data?.items.map(item => <li key={item.id}><Card><CardContent className="space-y-2 pt-4">
      <h2 className="font-semibold"><LocalizedLink className="underline" href={`/affairs/${encodeURIComponent(item.id)}`}>{item.title}</LocalizedLink></h2>
      <Badge variant="outline">{c.statuses[item.status]}</Badge><p>{c.openAttention}: {item.openAttentionCount}</p>
      <p>{c.updatedAt}: <time dateTime={item.updatedAt}>{item.updatedAt}</time></p>
    </CardContent></Card></li>)}</ul>
    <section className="space-y-3"><h2 className="text-xl font-semibold">{c.newAffair}</h2>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void mutation.run(() => client.createAffair({ title: title.trim(), summary, goal, keywords: parseKeywords(keywords) })).then(saved => { if (saved) { setTitle(""); setSummary(""); setGoal(""); setKeywords(""); } }); }}>
        <Label htmlFor="affair-title">{c.affairTitle}</Label><Input id="affair-title" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
        <Label htmlFor="affair-summary">{c.summary}</Label><Textarea id="affair-summary" maxLength={4000} value={summary} onChange={e => setSummary(e.target.value)} />
        <Label htmlFor="affair-goal">{c.goal}</Label><Textarea id="affair-goal" maxLength={2000} value={goal} onChange={e => setGoal(e.target.value)} />
        <Label htmlFor="affair-keywords">{c.keywords}</Label><Input id="affair-keywords" value={keywords} onChange={e => setKeywords(e.target.value)} />
        <Button type="submit" disabled={!title.trim() || mutation.busy || mutation.notice === "mutationError"}>{c.create}</Button>
      </form>
    </section>
  </div>;
}
