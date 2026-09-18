import { useEffect, useState } from "react";
import { PageAuthorPreview } from "@features/work-pages";
import { useI18n } from "@chrona/i18n";
import { workResults as wr } from "@chrona/contracts";
import { Card, CardContent, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@shared/ui";
import { resultRequest, type ResultScope } from "../model/client";
import { buildResultDraft, emptyResultContent, supportingDetails } from "../model/state";
import { useResultCommand } from "../hooks/use-result-command";
import { ResultFileUpload } from "./result-file-upload";
import { ResultComposerActions } from "./result-composer-actions";

type Props = { scope: ResultScope; view: wr.WorkResultView; context: wr.WorkResultContext; onSaved: () => void; onClose: () => void; onRefresh: () => void };
export function ResultComposer({ scope, view, context, onSaved, onClose, onRefresh }: Props) {
  const c = useI18n().messages.workResults;
  const [content, setContent] = useState<wr.WorkResultContent>(() => structuredClone(view.version?.content ?? emptyResultContent));
  const [details, setDetails] = useState(() => supportingDetails(content));
  const [revision, setRevision] = useState(view.result?.editRevision ?? null);
  const [localError, setLocalError] = useState<string | null>(null);
  const command = useResultCommand(onSaved);
  const disabled = command.busy || !!command.pending || !context.canSubmit;
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, []);
  async function attach(status: wr.ResultUploadStatus) {
    setLocalError(null);
    try {
      const parsed = JSON.parse(details) as Pick<wr.WorkResultContent, "deliverables">;
      if (!Array.isArray(parsed.deliverables) || !status.artifactRef) throw new Error("invalid");
      if (!parsed.deliverables.some((item) => item.artifactRef === status.artifactRef)) parsed.deliverables.push({ key: `file-${crypto.randomUUID()}`, title: status.filename, kind: "other", artifactRef: status.artifactRef, placement: "primary", required: true });
      setDetails(JSON.stringify(parsed, null, 2));
      // An upload can create an empty container, but never silently adopt a new head.
      if (revision === null) {
        const latest = await resultRequest<wr.WorkResultView>("read", scope);
        if (latest.result?.id === status.resultId && latest.result.headVersionId === null) setRevision(latest.result.editRevision);
        else setLocalError(c.conflict);
      }
      onRefresh();
    } catch { setLocalError(c.invalid); }
  }
  function publish() {
    setLocalError(null);
    try {
      const input = wr.publishWorkResultSchema.parse({ ...scope, requestId: crypto.randomUUID(), expectedRevision: revision, content: buildResultDraft(content, details) });
      if (new TextEncoder().encode(JSON.stringify(input)).length > wr.RESULT_REQUEST_BYTES) throw new Error("invalid");
      void command.send({ method: "submit", input });
    } catch { setLocalError(c.invalid); }
  }
  return <Card data-ui-surface-kind="product-authored" className="min-w-0">
    <CardContent className="space-y-4 pt-6">
      <h2 className="font-semibold">{c.newVersion}</h2>
      <Label htmlFor="result-title">{c.resultTitle}</Label><Input id="result-title" maxLength={256} disabled={disabled} value={content.outcome.title} onChange={(e) => setContent({ ...content, outcome: { ...content.outcome, title: e.target.value } })} />
      <Label htmlFor="result-summary">{c.summary}</Label><Textarea id="result-summary" maxLength={8000} disabled={disabled} value={content.outcome.summary} onChange={(e) => setContent({ ...content, outcome: { ...content.outcome, summary: e.target.value } })} />
      <Label htmlFor="result-readiness">{c.readiness}</Label>
      <Select disabled={disabled} value={content.readiness.status} onValueChange={(status: wr.WorkResultContent["readiness"]["status"]) => setContent({ ...content, readiness: { ...content.readiness, status } })}>
        <SelectTrigger id="result-readiness"><SelectValue /></SelectTrigger><SelectContent>{(["ready", "ready_with_caveats", "partial", "blocked"] as const).map((status) => <SelectItem key={status} value={status}>{c[status]}</SelectItem>)}</SelectContent>
      </Select>
      <Label htmlFor="result-ready-summary">{c.readinessSummary}</Label><Textarea id="result-ready-summary" maxLength={8000} disabled={disabled} value={content.readiness.summary} onChange={(e) => setContent({ ...content, readiness: { ...content.readiness, summary: e.target.value } })} />
      <ResultFileUpload scope={scope} disabled={disabled || !context.canUpload} onAttach={(status) => void attach(status)} />
      <Label htmlFor="result-details">{c.details}</Label><p className="text-sm text-muted-foreground">{c.detailsHelp}</p>
      <Textarea id="result-details" className="min-h-40 font-mono text-xs" disabled={disabled} value={details} onChange={(e) => setDetails(e.target.value)} />
      <PageAuthorPreview details={details} />
      <ResultComposerActions command={command} localError={localError} disabled={disabled} publish={publish} close={onClose}
        needsReconcile={revision !== (view.result?.editRevision ?? null) || command.error === "conflict"}
        canReconcile={!command.busy && context.canSubmit}
        reconcile={() => { setRevision(view.result?.editRevision ?? null); command.clear(); setLocalError(null); }} />
    </CardContent>
  </Card>;
}
