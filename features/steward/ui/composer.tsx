import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Badge, Button, Textarea } from "@shared/ui";
import { Link, useLocation } from "react-router-dom";
import type { StewardClient } from "../model/client";
import { useComposer } from "../hooks/use-composer";
import { fileKind } from "../model/affair-file";
import { AffairDownload } from "./affair-asset";

export function Composer({
  client,
  lang,
  refresh,
  onPendingChange,
  affairId,
}: {
  client: StewardClient;
  lang: string;
  refresh: () => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void;
  affairId?: string;
}) {
  const { messages } = useI18n();
  const copy = messages.steward.foundation;
  const location = useLocation();
  const composer = useComposer(client, refresh, onPendingChange, affairId, location.key);
  return (
    <div className="grid min-w-0 gap-2.5 [overflow-wrap:anywhere]">
      <form
        className="flex min-w-0 items-end gap-2 rounded-[10px] border bg-card py-2.5 pl-3.5 pr-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          void composer.send();
        }}
      >
        <Textarea
          aria-label={affairId ? messages.steward.affairCenter.supplement : copy.composer}
          placeholder={affairId ? messages.steward.affairCenter.supplementHint : copy.composer}
          maxLength={8000}
          rows={1}
          className="min-h-[26px] max-h-40 min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-1 text-[15px] shadow-none focus-visible:ring-0 [field-sizing:content]"
          value={composer.text}
          disabled={composer.pending}
          onChange={(event) => composer.setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void composer.send();
            }
          }}
        />
        <Button type="submit" disabled={composer.pending || !composer.text.trim()}>
          {affairId ? messages.steward.affairCenter.supplement : copy.send}
        </Button>
      </form>
      {composer.pending && <p role="status">{copy.pending}</p>}
      {composer.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {copy[composer.error.messageKey]}
            <Button variant="outline" onClick={() => void composer.retry()}>
              {copy.retry}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {composer.exchange && composer.exchange.viewKey === location.key && (
        <section
          aria-label={copy.reply}
          className="grid min-w-0 gap-2 border-l-2 rounded-r-md border-primary-border bg-primary-soft/45 px-3.5 py-3 text-[13px]"
        >
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
            {copy.you} · {composer.exchange.text}
          </p>
          {composer.exchange.response.messages.filter(message => message.direction === "out").map(message => (
            <article key={message.id} className="grid gap-2">
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.affairId && <Badge variant="outline" className="w-fit rounded-full border-primary-border bg-card text-primary" asChild><Link to={`/${lang}/affairs/${encodeURIComponent(message.affairId)}`}>{messages.steward.affairs.title}</Link></Badge>}
              <div className="flex flex-wrap gap-2">
                {message.attachments.map((attachment, index) => message.affairId && attachment.path ? (
                  fileKind(attachment.path) !== "binary"
                    ? <Link key={index} className="underline" to={`/${lang}/affairs/${encodeURIComponent(message.affairId)}?${new URLSearchParams({ path: attachment.path })}`}>{attachment.name}</Link>
                    : <AffairDownload key={index} client={client} affairId={message.affairId} path={attachment.path} label={attachment.name} />
                ) : <span key={index}>{attachment.name}</span>)}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
