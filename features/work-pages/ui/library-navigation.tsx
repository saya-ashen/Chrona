import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Folder, FolderPlus, Layers, Settings2 } from "lucide-react";
import { localizeHref, useI18n } from "@chrona/i18n";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@shared/ui";
import type { LibraryView, LibraryGroup, LibraryWriteResult } from "@chrona/contracts";
import { useLibrary } from "../hooks/use-library";
import { libraryHref } from "../model/library-client";
import { LibraryEditDialog, type LibraryEditor } from "./library-edit-dialog";
import { LibraryReadFeedback } from "./library-feedback";
function LibraryNavLinks({ data, group, params }: { data: LibraryView; group?: LibraryGroup; params: URLSearchParams }) {
  const { messages, locale } = useI18n(), c = messages.library, href = (p: string)=>localizeHref(locale,p);
  if (!group) return <>{data.groups.map(g=><Link key={g.id} to={href(libraryHref(g.id))} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"><Layers className="size-4 shrink-0" /><span className="truncate">{g.name}</span></Link>)}</>;
  const folderId = params.get("folder"), unclassified = params.get("unclassified") === "1";
  return <>{data.folders.map(f=><Link key={f.id} to={href(libraryHref(group.id,f.id))} aria-current={folderId === f.id ? "page" : undefined} className={cn("flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted",folderId === f.id && "bg-primary-soft text-primary")}><Folder className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="text-xs text-muted-foreground">{f.count}</span></Link>)}<Link to={href(libraryHref(group.id,undefined,true))} aria-current={unclassified ? "page" : undefined} className={cn("flex justify-between rounded-lg px-2 py-2 text-sm hover:bg-muted",unclassified && "bg-primary-soft text-primary")}><span>{c.unclassified}</span><span>{group.unclassifiedCount}</span></Link></>;
}
function LibraryNavActions({ data, group, edit }: { data: LibraryView | null; group?: LibraryGroup; edit: (e: LibraryEditor)=>void }) {
  const { messages } = useI18n(), c = messages.library;
  return <div className="flex flex-col items-stretch gap-1">{group && data?.canOrganize && <Button variant="ghost" className="h-auto justify-start py-2 text-left whitespace-normal" onClick={()=>edit({kind:"folder",groupId:group.id})}><FolderPlus className="size-4 shrink-0" /><span className="min-w-0 break-words">{c.newFolder}</span></Button>}{data?.canConfigure && <Button variant="ghost" className="h-auto justify-start py-2 text-left whitespace-normal" onClick={()=>edit({kind:"group",group})}><Settings2 className="size-4 shrink-0" /><span className="min-w-0 break-words">{group ? c.manageGroup : c.newGroup}</span></Button>}</div>;
}
export function LibraryNavigation() {
  const { messages, locale } = useI18n(), c = messages.library, [params] = useSearchParams(), navigate = useNavigate();
  const groupId = params.get("group") ?? undefined;
  const state = useLibrary({view:"catalog",groupId}), [editor,setEditor] = useState<LibraryEditor | null>(null);
  const group = state.data?.groups.find(g=>g.id===groupId);
  function go(id?: string) { void navigate(localizeHref(locale,libraryHref(id))); }
  function saved(value: LibraryWriteResult) { go(value.receipt.changes.some(v=>v.kind==="group_deleted") ? undefined : groupId); }
  const ready = !state.loading && !state.error && state.data;
  return <section className="min-w-0 space-y-3 p-4" aria-label={c.groups}>
    <label className="text-xs font-medium text-muted-foreground" htmlFor="library-sidebar-group">{c.classifyBy}</label>
    <Select value={groupId ?? "all"} onValueChange={v=>go(v === "all" ? undefined : v)}><SelectTrigger id="library-sidebar-group" className="w-full min-w-0"><SelectValue placeholder={c.all} /></SelectTrigger><SelectContent><SelectItem value="all">{c.all}</SelectItem>{state.data?.groups.map(g=><SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select>
    <LibraryReadFeedback state={state} />{ready && <div className="space-y-1"><LibraryNavLinks data={ready} group={group} params={params} /></div>}
    <LibraryNavActions data={state.data} group={group} edit={setEditor} />
    {editor && <LibraryEditDialog editor={editor} close={()=>setEditor(null)} saved={saved} />}
  </section>;
}
