import { useEffect } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Input } from "@shared/ui";
import { useChat } from "../hooks/use-chat";
import { PageColumn } from "./layout";
import { MutationStatus, ResourceStatus } from "./resource-status";
import { MessageContent } from "./composer";
import { ProviderWork } from "./provider-work";

export function ChatPage() {
  const { messages, locale } = useI18n(), c = messages.steward.sessions;
  const chat = useChat();
  const { id, setSessionId } = chat;
  useEffect(() => { setSessionId(id); }, [id, setSessionId]);
  return <PageColumn><div className="flex flex-wrap items-center gap-3"><h1 className="mr-auto text-2xl font-semibold">{c.title}</h1><Button disabled={chat.mutation.pending} onClick={() => void chat.create()}>{c.new}</Button></div>
    <MutationStatus mutation={chat.mutation} />
    <div className="grid min-w-0 gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label={c.select} className="grid min-w-0 content-start gap-2"><ResourceStatus resource={chat.sessions} />
        {chat.sessions.data?.items.map(session => <Button key={session.id} variant={session.id === id ? "secondary" : "ghost"} className="h-auto justify-start whitespace-normal break-words text-left" aria-pressed={session.id === id} onClick={() => chat.select(session.id)}>{session.title ?? c.untitled}{session.status === "ended" ? ` · ${c.ended}` : ""}</Button>)}
        {chat.sessions.data?.items.length === 0 && <p>{c.empty}</p>}
      </nav>
      <section className="grid min-w-0 content-start gap-4" aria-label={c.history}>
        <ResourceStatus resource={chat.selected} />
        {chat.selected.data && <>
          <h2 className="font-semibold">{chat.selected.data.title ?? c.untitled}{chat.selected.data.status === "ended" ? ` · ${c.ended}` : ""}</h2>
          <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void chat.rename(); }}><Input aria-label={c.rename} maxLength={200} value={chat.title} onChange={event => chat.setTitle(event.target.value)} className="min-w-0 flex-1" /><Button variant="outline" disabled={chat.mutation.pending || !chat.title.trim()}>{c.save}</Button>
            {chat.selected.data.status === "active" && <Button type="button" variant="outline" disabled={chat.mutation.pending || chat.selected.data.running} onClick={() => void chat.end()}>{c.end}</Button>}
          </form>
          <ProviderWork client={chat.client} sessionId={id} onChange={chat.history.refresh} />
        </>}
        {!id && <p>{c.noSelection}</p>}
        <ResourceStatus resource={chat.history} />
        {chat.history.data?.items.map(message => <div key={message.id} className="grid min-w-0 gap-2 border-t py-3"><p className="text-xs text-muted-foreground">{message.direction === "in" ? messages.steward.foundation.you : "Chrona"} · {new Date(message.at).toLocaleString(locale)}</p><MessageContent message={message} lang={locale} /></div>)}
      </section>
    </div>
  </PageColumn>;
}
