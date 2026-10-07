import { useState } from "react";
import { Link } from "react-router-dom";
import { Folder } from "lucide-react";
import { localizeHref, useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import type { LibraryReceipt } from "@chrona/contracts";
import { useLibrary } from "../hooks/use-library";
import { libraryHref } from "../model/library-client";
import { LibraryOrganizeDialog } from "./library-organize-dialog";
import { LibraryHistory, LibraryReceiptNotice } from "./library-feedback";
export function PageClassification({ taskId, title }: { taskId: string; title: string }) {
  const { messages, locale } = useI18n(), c = messages.library, state = useLibrary({ view: "item", taskId });
  const [open, setOpen] = useState(false), [receipt, setReceipt] = useState<LibraryReceipt | null>(null);
  if (state.error) return <div role="alert" className="text-sm"><span>{c.readError}</span><Button variant="ghost" onClick={state.refresh}>{c.retry}</Button></div>;
  if (!state.data || state.loading) return null;
  const item = state.data.items[0];
  return <section className="space-y-3" aria-label={c.classification} data-ui-surface-kind="product-authored"><div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><Folder className="size-4" />{!item?.placements.length && <span>{c.unclassified}</span>}{item?.placements.map(p => <Link key={p.groupId} className="rounded-md bg-muted px-2 py-1 hover:text-foreground" to={localizeHref(locale, libraryHref(p.groupId, p.folderId ?? undefined, !p.folderId))}>{p.groupName} / {p.folderName ?? c.unclassified}</Link>)}{state.data.groups.length ? <Button size="sm" variant="ghost" disabled={!state.data.canOrganize} onClick={() => setOpen(true)}>{c.organize}</Button> : <Button variant="ghost" size="sm" asChild><Link to={localizeHref(locale, "/home")}>{c.newGroup}</Link></Button>}</div>{receipt && <LibraryReceiptNotice receipt={receipt} />}<LibraryHistory taskId={taskId} />{open && <LibraryOrganizeDialog taskId={taskId} title={title} close={() => setOpen(false)} saved={v => setReceipt(v.receipt)} />}</section>;
}
