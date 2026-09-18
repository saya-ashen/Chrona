import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Plus, RefreshCw, Search } from "lucide-react";
import { useI18n } from "@chrona/i18n";
import { Button, Input, PageFrame, Skeleton, Tabs, TabsList, TabsTrigger } from "@shared/ui";
import { apiJson } from "@shared/http";
import { useWorkInbox } from "../hooks/use-work-records";
import { WorkInboxResults } from "./work-inbox-results";
import { WorkCapture } from "./work-capture";
export function WorkInboxPanel({ embedded }: { embedded?: boolean }) {
  const { messages, locale } = useI18n(), c = messages.workRecords;
  const [attentionOnly, setAttention] = useState(Boolean(embedded)), [query, setQuery] = useState(""), [draft, setDraft] = useState(""), [capturing, setCapturing] = useState(false), [canWrite, setCanWrite] = useState(false);
  const state = useWorkInbox(attentionOnly, query);
  useEffect(() => { const controller = new AbortController(); void apiJson<{ canWrite: boolean }>("/api/work-records/capabilities", { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setCanWrite(result.canWrite); }).catch(() => setCanWrite(false)); return () => controller.abort(); }, []);
  return <section className="min-w-0 space-y-6" data-ui-surface-kind="product-authored" aria-label={embedded ? c.inboxTitle : c.title}>
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 space-y-2">{embedded ? <h2 className="text-xl font-semibold">{c.inboxTitle}</h2> : <h1 className="text-3xl font-semibold tracking-tight">{c.title}</h1>}<p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{embedded ? c.inboxIntro : c.intro}</p></div>
      {embedded ? <Button variant="outline" asChild><Link to={`/${locale}/work`}>{c.all}<ArrowRight className="size-4" /></Link></Button> : <Button disabled={!canWrite} onClick={() => setCapturing(true)}><Plus className="size-4" />{c.create}</Button>}
    </header>
    {!embedded && <div className="flex flex-col justify-between gap-4 sm:flex-row"><Tabs value={attentionOnly ? "attention" : "all"} onValueChange={v => setAttention(v === "attention")}><TabsList><TabsTrigger value="all">{c.all}</TabsTrigger><TabsTrigger value="attention">{c.attention}</TabsTrigger></TabsList></Tabs>
      <form onSubmit={event => { event.preventDefault(); setQuery(draft.trim()); }} className="flex min-w-0 gap-2"><Input aria-label={c.search} value={draft} onChange={event => setDraft(event.target.value)} maxLength={200} placeholder={c.search} className="min-w-0 sm:w-56" /><Button type="submit" variant="outline" size="icon" aria-label={c.search}><Search className="size-4" /></Button><Button type="button" variant="outline" size="icon" disabled={state.loading} onClick={state.refresh} aria-label={c.refresh}><RefreshCw className="size-4" /></Button></form>
    </div>}
    {state.error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm">{c[state.error]}</p><Button variant="outline" size="sm" onClick={state.refresh}>{c.refresh}</Button></div>}
    {state.loading && <p role="status" className="text-sm text-muted-foreground">{c.loading}</p>}
    {!state.data && state.loading && <div className="space-y-3"><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-28 w-full rounded-xl" /></div>}
    <WorkInboxResults state={state} attentionOnly={attentionOnly} canWrite={canWrite} capture={() => setCapturing(true)} hasQuery={Boolean(query)} />
    {capturing && <WorkCapture open onClose={() => setCapturing(false)} onCaptured={state.refresh} />}
  </section>;
}
export function WorkInboxPage() {
  return <PageFrame mode="main" data-domain="work-records" className="min-w-0 p-2 sm:p-4"><div className="mx-auto w-full min-w-0 max-w-5xl pb-10"><WorkInboxPanel /></div></PageFrame>;
}
