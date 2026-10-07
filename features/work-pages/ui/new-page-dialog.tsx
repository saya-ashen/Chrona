import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { localizeHref, useI18n } from "@chrona/i18n";
import { apiJson } from "@shared/http";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from "@shared/ui";
import type { WorkCapture, WorkReceipt } from "@chrona/contracts";
import { pageError } from "../model/client";
import { LIBRARY_CHANGED } from "../model/library-client";
import { useLibrary, useLibraryCommand } from "../hooks/use-library";
import { LibraryCommandFeedback, LibraryReadFeedback } from "./library-feedback";
type Props = { open: boolean; close: () => void; onCreated?: () => void; placement?: { groupId: string; folderId: string; revision: string } };
function PageCreationDialog({ open, close, onCreated, placement }: Props) {
  const { messages, locale } = useI18n(), c = messages.workPages, navigate = useNavigate();
  const [title, setTitle] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<ReturnType<typeof pageError> | null>(null), [pending, setPending] = useState<WorkCapture | null>(null), [created, setCreated] = useState<string | null>(null);
  const lock = useRef(false);
  function openCreated(taskId: string) { close(); void navigate(localizeHref(locale, `/tasks/${taskId}`)); }
  const classification = useLibraryCommand(v => { if (v.receipt.taskId) openCreated(v.receipt.taskId); });
  const locked = busy || !!pending || classification.busy || !!classification.pending;
  async function save(input: WorkCapture) {
    if (lock.current || created) return; lock.current = true; setBusy(true); setPending(input); setError(null);
    try {
      const result = await apiJson<WorkReceipt>("/api/work-records/capture", { method: "POST", body: JSON.stringify(input) });
      const taskId = result.receipt.taskId;
      setPending(null); setCreated(taskId); onCreated?.(); window.dispatchEvent(new Event(LIBRARY_CHANGED));
      if (placement) await classification.save(placement.revision, { type: "assign", taskId, placements: [{ groupId: placement.groupId, destination: { type: "folder", folderId: placement.folderId } }] });
      else openCreated(taskId);
    } catch (cause) { const kind = pageError(cause); setError(kind); if (kind !== "unknown") setPending(null); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={v => { if (!v && !locked) close(); }}><DialogContent>
    <DialogHeader><DialogTitle>{c.newPage}</DialogTitle><DialogDescription>{c.createHint}</DialogDescription></DialogHeader>
    {created ? <div className="space-y-4"><p>{messages.library.partialCreated}</p><LibraryCommandFeedback command={classification} refresh={() => openCreated(created)} />{!locked && <Button onClick={() => openCreated(created)}>{messages.library.open}</Button>}</div> : <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save({ requestId: crypto.randomUUID(), title: title.trim(), context: { kind: "general", organizer: "", participants: [], agenda: "" }, sources: [], nextAction: "" }); }}>
      <Label htmlFor="page-name">{c.name}</Label><Input id="page-name" autoFocus required maxLength={500} placeholder={c.namePlaceholder} value={title} disabled={locked} onChange={e => setTitle(e.target.value)} />
      {error && <p role="alert" className="text-sm">{c[error]}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={locked} onClick={close}>{c.cancel}</Button>{pending ? <Button type="button" disabled={busy} onClick={() => void save(pending)}>{busy ? c.saving : c.retrySave}</Button> : <Button disabled={busy || !title.trim()} type="submit">{c.create}</Button>}</div>
    </form>}
  </DialogContent></Dialog>;
}

function FolderPageCreationDialog(props: Props & { groupId: string; folderId: string }) {
  const { messages } = useI18n();
  const state = useLibrary({ view: "catalog", groupId: props.groupId, folderId: props.folderId });
  const [placement, setPlacement] = useState<Props["placement"]>();
  useEffect(() => {
    if (!placement && state.data && !state.loading && !state.error) {
      setPlacement({ groupId: props.groupId, folderId: props.folderId, revision: state.data.revision });
    }
  }, [placement, state.data, state.loading, state.error, props.groupId, props.folderId]);
  // Freeze the read revision and keep the form mounted through capture's change
  // event. Otherwise a refresh can discard a pending classification retry.
  if (placement) return <PageCreationDialog {...props} placement={placement} />;
  return <Dialog open={props.open} onOpenChange={v => { if (!v) props.close(); }}><DialogContent>
    <DialogHeader><DialogTitle>{messages.workPages.newPage}</DialogTitle><DialogDescription>{messages.workPages.createHint}</DialogDescription></DialogHeader>
    <LibraryReadFeedback state={state} /><Button variant="ghost" onClick={props.close}>{messages.workPages.cancel}</Button>
  </DialogContent></Dialog>;
}

export function NewPageDialog(props: Props) {
  const location = useLocation(), params = new URLSearchParams(location.search);
  const groupId = params.get("group"), folderId = params.get("folder");
  if (!props.placement && location.pathname.endsWith("/home") && groupId && folderId) {
    return <FolderPageCreationDialog {...props} groupId={groupId} folderId={folderId} />;
  }
  return <PageCreationDialog {...props} />;
}
