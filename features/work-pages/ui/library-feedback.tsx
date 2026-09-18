import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Skeleton } from "@shared/ui";
import type { LibraryChange, LibraryReceipt } from "@chrona/contracts";
import { useLibrary, type useLibraryCommand } from "../hooks/use-library";
const changeLabels = { group_created: "createdGroup", group_updated: "updatedGroup", group_deleted: "deletedGroup", folder_created: "createdFolder", folder_reused: "reusedFolder", folder_updated: "updatedFolder", folder_deleted: "deletedFolder", classified: "placed", placement_preserved: "preserved" } as const;
export function LibraryChangeLine({ change }: { change: LibraryChange }) {
  const { messages } = useI18n(), c = messages.library;
  const key = changeLabels[change.kind as keyof typeof changeLabels];
  return <span>{key ? c[key] : c.classification}：{change.groupName}{change.folderId !== undefined && <> / {change.folderName ?? c.unclassified}</>}</span>;
}
export function LibraryReceiptNotice({ receipt }: { receipt: LibraryReceipt }) {
  const { messages } = useI18n(), c = messages.library;
  return <div role="status" className="rounded-lg border bg-muted/30 p-4 text-sm"><p className="font-medium">{c.saved}</p><ul className="mt-2 space-y-1">{receipt.changes.map((v, i) => <li key={i}><LibraryChangeLine change={v} /></li>)}</ul></div>;
}
export function LibraryCommandFeedback({ command, refresh }: { command: ReturnType<typeof useLibraryCommand>; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.library;
  return <>{command.error && <div role="alert" className="space-y-2 text-sm"><p>{c[command.error]}</p>{command.error === "conflict" && <Button type="button" variant="outline" onClick={() => { command.clearError(); refresh(); }}>{c.compare}</Button>}</div>}{command.pending && <Button type="button" disabled={command.busy} onClick={() => void command.retry()}>{command.busy ? c.saving : c.retrySave}</Button>}</>;
}
export function LibraryReadFeedback({ state }: { state: ReturnType<typeof useLibrary> }) {
  const { messages } = useI18n(), c = messages.library;
  if (state.loading) return <div role="status" className="space-y-2"><p className="text-sm text-muted-foreground">{c.loading}</p><Skeleton className="h-16" /></div>;
  if (state.error) return <div role="alert"><p>{c.readError}</p><Button type="button" variant="outline" onClick={state.refresh}>{c.retry}</Button></div>;
  return null;
}
function HistoryEntries({ taskId }: { taskId?: string }) {
  const { messages, locale } = useI18n(), c = messages.library, [offset, setOffset] = useState(0), state = useLibrary({ view: "history", taskId, offset, limit: 10 });
  return <div className="space-y-4 pt-4"><LibraryReadFeedback state={state} />{!state.loading && !state.error && <>{!state.data?.history.length && <p className="text-sm text-muted-foreground">{c.noHistory}</p>}{state.data?.history.map(r => <div key={r.commandId} className="rounded-lg border p-3 text-sm"><p className="mb-2 text-muted-foreground">{r.actorKey.startsWith("external:") ? c.byAgent : c.byOwner} · {new Date(r.recordedAt).toLocaleString(locale)}</p><ul className="space-y-1">{r.changes.map((v,i) => <li key={i}><LibraryChangeLine change={v} /></li>)}</ul></div>)}<div className="flex gap-2">{offset > 0 && <Button variant="ghost" onClick={() => setOffset(Math.max(0, offset - 10))}>{c.previous}</Button>}{state.data?.nextOffset != null && <Button variant="ghost" onClick={() => setOffset(state.data!.nextOffset!)}>{c.next}</Button>}</div></>}</div>;
}
export function LibraryHistory({ taskId }: { taskId?: string }) {
  const { messages } = useI18n(), [open, setOpen] = useState(false);
  return <details onToggle={e => setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm text-muted-foreground">{messages.library.history}</summary>{open && <HistoryEntries taskId={taskId} />}</details>;
}
