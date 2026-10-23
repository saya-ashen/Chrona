import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Button, Textarea } from "@shared/ui";
import { Link, useLocation } from "react-router-dom";
import type { Message } from "@chrona/contracts";
import type { StewardClient } from "../model/client";
import { useComposer } from "../hooks/use-composer";

export function MessageContent({ message, lang }: { message: Message; lang: string }) {
  return <article className="grid min-w-0 gap-2 whitespace-pre-wrap break-words">
    <p>{message.text}</p>
    <div className="flex flex-wrap gap-2">{message.attachments.map((attachment, index) => attachment.ref
      ? <Link key={index} className="underline" to={`/${lang}/apps/${encodeURIComponent(attachment.ref.split("/")[0]!)}?${new URLSearchParams({ path: attachment.ref.slice(attachment.ref.indexOf("/") + 1) })}`}>{attachment.name}</Link>
      : <span key={index}>{attachment.name}</span>)}</div>
  </article>;
}

export function Composer({ client, lang, refresh, onPendingChange, sessionId, onSession }: {
  client: StewardClient; lang: string; refresh: () => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void; sessionId?: string; onSession?: (id: string) => void;
}) {
  const copy = useI18n().messages.steward.foundation;
  const location = useLocation();
  const composer = useComposer(client, refresh, onPendingChange, sessionId, location.key, onSession);
  return <div className="grid min-w-0 gap-2.5 [overflow-wrap:anywhere]">
    <form className="flex min-w-0 items-end gap-2 rounded-lg border bg-card p-3" onSubmit={event => { event.preventDefault(); void composer.send(); }}>
      <Textarea aria-label={copy.composer} placeholder={copy.composer} maxLength={8000} rows={1}
        className="min-w-0 flex-1 resize-none" value={composer.text} disabled={composer.pending}
        onChange={event => composer.setText(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void composer.send(); } }} />
      <Button type="submit" disabled={composer.pending || !composer.text.trim()}>{copy.send}</Button>
    </form>
    {composer.pending && <p role="status">{copy.pending}</p>}
    {composer.error && <Alert variant="destructive"><AlertDescription>{copy[composer.error.messageKey]}<Button variant="outline" onClick={() => void composer.retry()}>{copy.retry}</Button></AlertDescription></Alert>}
    {composer.exchange?.viewKey === location.key && <section aria-label={copy.reply} className="grid min-w-0 gap-2 border-l-2 border-primary bg-primary-soft/45 p-3 text-sm">
      <p className="whitespace-pre-wrap text-xs text-muted-foreground">{copy.you} · {composer.exchange.text}</p>
      {composer.exchange.response.messages.filter(message => message.direction === "out").map(message => <MessageContent key={message.id} message={message} lang={lang} />)}
    </section>}
  </div>;
}
