import { InlineForm } from "./layout";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import type { Ask } from "@chrona/contracts";
import { Button, Input } from "@shared/ui";
import { useAsk } from "../hooks/use-ask";
import type { StewardClient } from "../model/client";

export function AskItem({
  ask,
  client,
  refresh,
}: {
  ask: Ask;
  client: StewardClient;
  refresh: () => void;
}) {
  const { messages, locale } = useI18n(),
    copy = messages.steward.foundation;
  const mutation = useAsk(ask, client, refresh);
  return (
    <article
      className={`grid gap-2 p-4 ${ask.kind !== "suggestion" ? "border-l-2 border-l-warning" : ""}`}
    >
      <h3 className="font-medium">{ask.title}</h3>
      {ask.affairId && (
        <Link
          className="text-sm text-muted-foreground underline"
          to={`/${locale}/affairs/${encodeURIComponent(ask.affairId)}`}
        >
          {ask.affairTitle ?? ask.title}
        </Link>
      )}
      <p className="text-sm text-muted-foreground">{ask.detail}</p>
      {ask.questions.map((question, index) => (
        <p key={index} className="text-sm">
          {question.question} {question.why}
        </p>
      ))}
      {ask.kind === "question" ? (
        <InlineForm
          onSubmit={(event) => {
            event.preventDefault();
            void mutation.submitAnswer();
          }}
        >
          <Input
            className="min-w-0 flex-1"
            aria-label={`${copy.answer}: ${ask.title}`}
            value={mutation.answer}
            onChange={(event) => mutation.setAnswer(event.target.value)}
            maxLength={2000}
            disabled={mutation.pending}
          />
          <Button disabled={mutation.pending || !mutation.answer.trim()}>{copy.answer}</Button>
        </InlineForm>
      ) : (
        <AskActions ask={ask} mutation={mutation} />
      )}
      {mutation.pending && <p role="status">{copy.pending}</p>}
      {mutation.error && <p role="alert">{copy[mutation.error.messageKey]}</p>}
    </article>
  );
}

function AskActions({ ask, mutation }: { ask: Ask; mutation: ReturnType<typeof useAsk> }) {
  const copy = useI18n().messages.steward.foundation;
  return <div className="flex flex-wrap gap-2">
          {ask.kind === "approval" ? (
            <>
              <Button
                disabled={mutation.pending}
                onClick={() => void mutation.resolve({ decision: "approve", scope: "once" })}
              >
                {copy.approveOnce}
              </Button>
              <Button
                variant="outline"
                disabled={mutation.pending}
                onClick={() => void mutation.resolve({ decision: "approve", scope: "affair" })}
              >
                {copy.approveAffair}
              </Button>
              <Button
                variant="ghost"
                disabled={mutation.pending}
                onClick={() => void mutation.resolve({ decision: "deny" })}
              >
                {copy.deny}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={mutation.pending}
                onClick={() => void mutation.resolve({ decision: "accept_suggestion" })}
              >
                {copy.acceptSuggestion}
              </Button>
              <Button
                variant="ghost"
                disabled={mutation.pending}
                onClick={() => void mutation.resolve({ decision: "dismiss" })}
              >
                {copy.dismiss}
              </Button>
              <Button
                variant="ghost"
                disabled={mutation.pending}
                onClick={() => void mutation.resolve({ decision: "never_again" })}
              >
                {copy.neverAgain}
              </Button>
            </>
          )}
        </div>;
}
