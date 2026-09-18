import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { workResults as wr } from "@chrona/contracts";
import { Button, Card, CardContent, Label, Textarea } from "@shared/ui";
import { resultReviewReason } from "../model/state";
import type { ResultScope } from "../model/client";
import { useResultCommand } from "../hooks/use-result-command";

type Props = { scope: ResultScope; view: wr.WorkResultView; context: wr.WorkResultContext; onSaved: () => void };
export function ResultReview({ scope, view, context, onSaved }: Props) {
  const c = useI18n().messages.workResults;
  const [feedback, setFeedback] = useState("");
  const command = useResultCommand(() => { setFeedback(""); onSaved(); });
  const reason = resultReviewReason(context, view, false), acceptReason = resultReviewReason(context, view, true);
  function review(decision: "accept" | "request_changes" | "reject") {
    if (!view.result || !view.version) return;
    void command.send({ method: "review", input: { ...scope, requestId: crypto.randomUUID(), expectedRevision: view.result.editRevision,
      versionId: view.version.id, decision, ...(feedback.trim() ? { feedback } : {}) } });
  }
  return <Card data-ui-surface-kind="product-authored"><CardContent className="space-y-3 pt-6">
    <p>{c.reviewNote}</p><Label htmlFor="result-feedback">{c.feedback}</Label>
    <Textarea id="result-feedback" maxLength={8000} value={feedback} disabled={command.busy || !!command.pending || !!reason} onChange={(e) => setFeedback(e.target.value)} />
    {(reason || acceptReason) && <p>{c[(reason ?? acceptReason)!]}</p>}
    <div className="flex flex-wrap gap-2">{(["accept", "request_changes", "reject"] as const).map((decision) => <Button key={decision} variant={decision === "accept" ? "default" : "outline"} disabled={command.busy || !!command.pending || !!(decision === "accept" ? acceptReason : reason)} onClick={() => review(decision)}>{c[decision]}</Button>)}</div>
    {command.error && <p role="alert">{c[command.error]}</p>}
    {command.pending && <><p>{c.pending}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={command.busy} onClick={() => void command.retry()}>{c.retry}</Button><Button variant="outline" disabled={command.busy} onClick={command.clear}>{c.discard}</Button></div></>}
  </CardContent></Card>;
}
