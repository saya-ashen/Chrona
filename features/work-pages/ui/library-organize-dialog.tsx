import { useEffect, useRef, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import type { LibraryAction, LibraryView, LibraryWriteResult } from "@chrona/contracts";
import { useLibrary, useLibraryCommand } from "../hooks/use-library";
import { LibraryCommandFeedback, LibraryReadFeedback } from "./library-feedback";
type PlacementValues = { destination: string; name: string; protect: boolean };
function missingFolderName(destination: string, name: string) { return destination === "create" && !name.trim(); }
function PlacementFields({ values, change, data, disabled, locked, currentName }: { values: PlacementValues; change: (v: PlacementValues) => void; data: LibraryView | null; disabled: boolean; locked: boolean; currentName?: string | null }) {
  const { messages } = useI18n(), c = messages.library;
  return <><p className="text-xs text-muted-foreground">{c.classification}：{currentName ?? c.unclassified}</p>
    <div className="space-y-2"><Label htmlFor="library-destination">{c.folders}</Label><Select value={values.destination} onValueChange={destination => change({ ...values, destination })} disabled={disabled}><SelectTrigger id="library-destination" className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{c.unclassified}</SelectItem>{data?.folders.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}<SelectItem value="create">＋ {c.newFolder}</SelectItem></SelectContent></Select></div>
    {values.destination === "create" && <div className="space-y-2"><Label htmlFor="placement-folder-name">{c.name}</Label><Input id="placement-folder-name" required maxLength={100} value={values.name} disabled={locked} onChange={e => change({ ...values, name: e.target.value })} /></div>}
    {data && !data.canOrganize && <p className="text-sm">{c.readOnly}</p>}
    <Label className="flex items-start gap-3"><Checkbox checked={values.protect} disabled={disabled} onCheckedChange={v => change({ ...values, protect: v === true })} />{c.protected}</Label><p className="text-xs text-muted-foreground">{c.protectedHint}</p>
  </>;
}
function PlacementForm({ taskId, groupId, close, saved, lockedChanged }: { taskId: string; groupId: string; close: () => void; saved: (v: LibraryWriteResult) => void; lockedChanged: (locked: boolean) => void }) {
  const { messages } = useI18n(), c = messages.library, state = useLibrary({ view: "item", taskId, groupId });
  const [destination, setDestination] = useState("none"), [name, setName] = useState(""), [protect, setProtect] = useState(true), [dirty, setDirty] = useState(false), initialized = useRef(false);
  const command = useLibraryCommand(v => { saved(v); close(); });
  const current = state.data?.items[0]?.placements.find(p => p.groupId === groupId);
  const [revision, setRevision] = useState<string | null>(null), reconcile = useRef(false);
  useEffect(() => {
    if (!state.data || state.loading || state.error) return;
    if (!initialized.current) { setDestination(current?.folderId ?? "none"); setProtect(current?.protected ?? true); setRevision(state.data.revision); initialized.current = true; }
    else if (reconcile.current) { setRevision(state.data.revision); reconcile.current = false; }
  }, [state.data, state.loading, state.error, current]);
  function compare() { reconcile.current = true; state.refresh(); }
  useEffect(() => { lockedChanged(dirty || command.busy || !!command.pending); }, [dirty, command.busy, command.pending, lockedChanged]);
  const locked = command.busy || !!command.pending, disabled = locked || state.loading || state.error || !state.data?.canOrganize || !revision;
  function save() {
    if (disabled || !revision) return;
    const target: Extract<LibraryAction, { type: "assign" }>["placements"][number]["destination"] = destination === "create" ? { type: "create", name: name.trim(), description: "" } : destination === "none" ? { type: "unclassified" } : { type: "folder", folderId: destination };
    void command.save(revision, { type: "assign", taskId, placements: [{ groupId, destination: target, protect }] });
  }
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); save(); }}>
    <LibraryReadFeedback state={state} />
    <PlacementFields values={{ destination, name, protect }} change={v => { setDestination(v.destination); setName(v.name); setProtect(v.protect); setDirty(true); }} data={state.data} disabled={!!disabled} locked={locked} currentName={current?.folderName} />
    <LibraryCommandFeedback command={command} refresh={compare} />
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={locked} onClick={close}>{c.cancel}</Button>{!command.pending && <Button disabled={disabled || missingFolderName(destination, name)}>{c.save}</Button>}</div>
  </form>;
}
export function LibraryOrganizeDialog({ taskId, title, close, saved }: { taskId: string; title: string; close: () => void; saved: (v: LibraryWriteResult) => void }) {
  const { messages } = useI18n(), c = messages.library, state = useLibrary({ view: "item", taskId });
  const [selected, setSelected] = useState(""), [locked, setLocked] = useState(false);
  const groupId = selected || state.data?.groups[0]?.id;
  return <Dialog open onOpenChange={v => { if (!v && !locked) close(); }}><DialogContent className="max-h-[85vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{c.organize} · {title}</DialogTitle><DialogDescription>{c.itemHint}</DialogDescription></DialogHeader>
    <LibraryReadFeedback state={state} />
    {!state.loading && !state.error && <>{!state.data?.groups.length ? <p>{c.noGroup}</p> : <><div className="space-y-2"><Label htmlFor="placement-group">{c.chooseGroup}</Label><Select value={groupId} disabled={locked} onValueChange={setSelected}><SelectTrigger id="placement-group" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{state.data.groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select></div>{groupId && <PlacementForm key={groupId} taskId={taskId} groupId={groupId} close={close} saved={saved} lockedChanged={setLocked} />}</>}</>}
  </DialogContent></Dialog>;
}
