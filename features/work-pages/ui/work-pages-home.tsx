import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { PageFrame } from "@shared/ui";
import type { LibraryItem, LibraryReceipt, LibraryView } from "@chrona/contracts";
import { NewPageDialog } from "./new-page-dialog";
import { useLibrary } from "../hooks/use-library";
import { libraryLocation, type LibraryLocation } from "../model/library-location";
import { LibraryEditDialog, type LibraryEditor } from "./library-edit-dialog";
import { LibraryOrganizeDialog } from "./library-organize-dialog";
import { LibraryHistory, LibraryReadFeedback, LibraryReceiptNotice } from "./library-feedback";
import { LibraryFolders, LibraryGroups, LibraryHeader, LibraryItems, LibraryToolbar, selectedFolder } from "./library-directory";
function LibraryContents({ data, location, edit, organize, changePage }: { data: LibraryView; location: LibraryLocation; edit: (e: LibraryEditor)=>void; organize: (item: LibraryItem)=>void; changePage: (offset: number)=>void }) {
  return <>{!location.groupId && !location.query && <LibraryGroups groups={data.groups} />}{location.directory && location.groupId && <LibraryFolders data={data} groupId={location.groupId} edit={edit} />}<LibraryItems data={data} location={location} organize={organize} changePage={changePage} /><LibraryHistory /></>;
}
function creationPlacement(data: LibraryView | null, location: LibraryLocation) {
  const folder = selectedFolder(data,location.folderId);
  return folder && data ? { groupId: folder.groupId, folderId: folder.id, revision: data.revision } : undefined;
}
export function WorkPagesHome({ workspaceId: _workspaceId }: { workspaceId: string }) {
  const { messages } = useI18n(), [params, setParams] = useSearchParams(), location = libraryLocation(params);
  const state = useLibrary({ view: "browse", groupId: location.groupId, folderId: location.folderId, unclassified: location.unclassified || location.directory, query: location.query, offset: location.offset, limit: 20 });
  const [create, setCreate] = useState(false), [editor, setEditor] = useState<LibraryEditor | null>(null), [organize, setOrganize] = useState<LibraryItem | null>(null), [receipt, setReceipt] = useState<LibraryReceipt | null>(null);
  function changePage(next: number) { const p = new URLSearchParams(params); p.set("offset", String(next)); setParams(p); }
  function search(value: string) { const p = new URLSearchParams(params); if(value) p.set("q",value); else p.delete("q"); p.delete("offset"); setParams(p,{replace:true}); }
  function chooseGroup(id: string) { setParams(id === "all" ? {} : { group: id }); }
  function saved(value: { receipt: LibraryReceipt }) {
    setReceipt(value.receipt);
    if(value.receipt.changes.some(v=>v.kind==="group_deleted")) setParams({});
    else if(value.receipt.changes.some(v=>v.kind==="folder_deleted")) chooseGroup(location.groupId ?? "all");
  }
  const ready = !state.loading && !state.error && state.data;
  return <PageFrame mode="main" data-domain="content-library" className="mx-auto w-full max-w-[1360px] space-y-7 px-0 py-2 sm:py-4">
    <LibraryHeader data={state.data} location={location} create={()=>setCreate(true)} />
    <p className="max-w-[75ch] text-muted-foreground">{messages.library.intro}</p>
    <LibraryToolbar data={state.data} location={location} search={search} chooseGroup={chooseGroup} edit={setEditor} />
    {state.data && !state.data.writesEnabled && <p className="text-sm text-muted-foreground">{messages.library.readOnly}</p>}
    {receipt && <LibraryReceiptNotice receipt={receipt} />}<LibraryReadFeedback state={state} />
    {ready && <LibraryContents data={ready} location={location} edit={setEditor} organize={setOrganize} changePage={changePage} />}
    {create && <NewPageDialog open close={()=>setCreate(false)} onCreated={state.refresh} placement={creationPlacement(state.data,location)} />}
    {editor && <LibraryEditDialog editor={editor} close={()=>setEditor(null)} saved={saved} />}
    {organize && <LibraryOrganizeDialog taskId={organize.id} title={organize.title} close={()=>setOrganize(null)} saved={saved} />}
  </PageFrame>;
}
