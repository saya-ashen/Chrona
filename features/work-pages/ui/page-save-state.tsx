import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import type { PageCommand } from "../hooks/use-page-command";
export function PageSaveState({ command, versionId }: { command: PageCommand; versionId?: string }) {
  const c = useI18n().messages.workPages;
  const stale = Boolean(versionId && command.latest && command.latest.headVersionId !== versionId);
  return <div className="space-y-2 text-sm" data-ui-surface-kind="product-authored">
    {command.saved && <p role="status" className="text-muted-foreground">{c.saved}</p>}
    {command.error && <p role="alert">{c[command.error]}</p>}
    <div className="flex flex-wrap gap-2">
      {command.error === "unknown" && command.pending && <Button variant="outline" size="sm" disabled={command.busy} onClick={() => void command.retry()}>{c.retrySave}</Button>}
      {command.error === "conflict" && <Button variant="outline" size="sm" disabled={command.busy} onClick={() => void command.reconcile()}>{c.reconcile}</Button>}
    </div>
    {command.latest && <div className="space-y-2 border-l-2 pl-3">
      <p>{stale ? c.newVersion : c.conflict}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(command.latest.entries.map((e) => ({ kind: e.kind, form: e.formKey, ...e.content })), null, 2)}</pre>
      {!stale && command.latest.canRespond && <Button variant="outline" size="sm" onClick={command.keepDraft}>{c.confirmDraft}</Button>}
    </div>}
  </div>;
}
