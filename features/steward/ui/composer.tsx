import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Badge, Button, Textarea } from "@shared/ui";
import { Link } from "react-router-dom";
import type { StewardClient } from "../model/client";
import { useComposer } from "../hooks/use-composer";

export function Composer({
  client,
  lang,
  refresh,
  onPendingChange,
}: {
  client: StewardClient;
  lang: string;
  refresh: () => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { messages } = useI18n();
  const copy = messages.steward.foundation;
  const composer = useComposer(client, refresh, onPendingChange);
  return (
    <div className="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
      <form
        className="flex min-w-0 items-end gap-2 rounded-lg border bg-background p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void composer.send();
        }}
      >
        <Textarea
          aria-label={copy.composer}
          placeholder={copy.composer}
          maxLength={4000}
          rows={1}
          className="min-h-9 max-h-40 min-w-0 flex-1 resize-none [field-sizing:content]"
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
          {copy.send}
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
      {composer.exchange && (
        <section
          aria-label={copy.reply}
          className="grid min-w-0 gap-2 border-l-2 border-primary bg-muted/40 p-3 text-sm"
        >
          <p className="whitespace-pre-wrap text-muted-foreground">
            {copy.you} · {composer.exchange.text}
          </p>
          <p className="whitespace-pre-wrap">{composer.exchange.response.reply}</p>
          <div className="flex flex-wrap gap-2">
            {composer.exchange.response.effects.map((effect, index) =>
              effect.affairId ? (
                <Badge variant="outline" key={index} asChild>
                  <Link to={`/${lang}/affairs/${encodeURIComponent(effect.affairId)}`}>
                    {effect.label}
                  </Link>
                </Badge>
              ) : (
                <Badge variant="outline" key={index}>
                  {effect.label}
                </Badge>
              ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}
