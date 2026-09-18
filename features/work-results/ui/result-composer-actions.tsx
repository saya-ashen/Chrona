import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import type { useResultCommand } from "../hooks/use-result-command";

type Props = { command: ReturnType<typeof useResultCommand>; localError: string | null; disabled: boolean; needsReconcile: boolean; canReconcile: boolean; publish: () => void; close: () => void; reconcile: () => void };
export function ResultComposerActions({ command, localError, disabled, needsReconcile, canReconcile, publish, close, reconcile }: Props) {
  const c = useI18n().messages.workResults;
  const error = localError ?? (command.error ? c[command.error] : null);
  return <>
    {error && <p role="alert">{error}</p>}{command.pending && <p>{c.pending}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={disabled} onClick={publish}>{command.busy ? c.busy : c.publish}</Button>
      {command.pending && <><Button type="button" variant="outline" disabled={command.busy} onClick={() => void command.retry()}>{c.retry}</Button><Button type="button" variant="outline" disabled={command.busy} onClick={command.clear}>{c.discard}</Button></>}
      <Button type="button" variant="outline" disabled={command.busy || !!command.pending} onClick={close}>{c.cancel}</Button>
      {needsReconcile && <Button type="button" variant="outline" disabled={!canReconcile} onClick={reconcile}>{c.reconcile}</Button>}
    </div>
  </>;
}
