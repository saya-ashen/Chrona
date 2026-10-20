import { useCallback } from "react";
import { useI18n } from "@chrona/i18n";
import type { FileContent } from "@chrona/contracts";
import { Button, Checkbox, MarkdownContent, Textarea } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { fileKind, markdownParts, omitReadmeSummary, pageName } from "../model/affair-file";
import { useStewardResource } from "../hooks/use-steward";
import { useAffairFile } from "../hooks/use-affair-file";
import { ResourceStatus } from "./resource-status";
import { FilePanel } from "./file-panel";
import { AffairAsset, AffairDownload } from "./affair-asset";
import { useAffairMarkdown } from "./affair-markdown";

type FileProps = { client: StewardClient; affairId: string; path: string; refresh: () => void; readOnly?: boolean; refreshVersion?: string; summaryShown?: boolean };
export function AffairFileView(props: FileProps) {
  const { client, affairId, path } = props;
  const kind = fileKind(path);
  if (kind === "binary" || kind === "image" || kind === "audio" || kind === "video") return <AffairAsset client={client} affairId={affairId} path={path} revision={props.refreshVersion} />;
  return <LoadedFile {...props} />;
}
function LoadedFile(props: FileProps) {
  const { client, affairId, path } = props;
  const resource = useStewardResource(useCallback((signal?: AbortSignal) => client.file(affairId, path, signal), [client, affairId, path]), false, props.refreshVersion);
  return <><ResourceStatus resource={resource} />{resource.data && <EditableFile key={path} {...props} initial={resource.data} />}</>;
}
export function EditableFile({ client, affairId, initial, refresh, readOnly = false, summaryShown, refreshVersion }: Omit<FileProps, "path"> & { initial: FileContent }) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairFile;
  const f = useAffairFile(client, affairId, initial, refresh);
  return <div className="grid min-w-0 overflow-hidden rounded-[10px] border bg-card">
    <header className="flex flex-wrap items-baseline gap-2.5 border-b px-4 py-3"><h2 className="break-all text-lg font-semibold">{pageName(f.file.path)}</h2>
      <time className="ml-auto text-xs tabular-nums text-muted-foreground" dateTime={f.file.updatedAt}>{new Date(f.file.updatedAt).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
      {!readOnly && !f.editing && <Button variant="outline" disabled={f.pending} onClick={f.edit}>{c.edit}</Button>}
    </header>
    <div className="affair-result-body min-w-0 p-4">
    {f.notice && <p role="alert">{c[f.notice]}</p>}
    {f.editing ? <form className="grid min-w-0 gap-3" onSubmit={event => { event.preventDefault(); void f.save(); }}>
      <label className="grid min-w-0 gap-2">{f.conflict ? c.mine : c.editor}<Textarea aria-label={c.editor} className="min-h-80 font-mono" value={f.draft} onChange={event => f.setDraft(event.target.value)} disabled={f.pending} /></label>
      {f.conflict && <section className="min-w-0"><h3>{c.theirs}</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{f.conflict.content}</pre></section>}
      <div className="flex flex-wrap gap-2"><Button disabled={f.pending} type="submit">{f.conflict ? c.retry : c.save}</Button><Button variant="outline" disabled={f.pending} type="button" onClick={f.cancel}>{c.cancel}</Button></div>
    </form> : <FileReadView file={f.file} summaryShown={summaryShown} client={client} affairId={affairId} revision={refreshVersion} pending={f.pending || readOnly} toggle={f.changeCheckbox} />}
    </div>
    {!f.editing && <footer className="border-t px-4 py-2 text-xs"><AffairDownload client={client} affairId={affairId} path={f.file.path} label={c.download} /></footer>}
  </div>;
}
type MarkdownProps = { content: string; path: string; client: StewardClient; affairId: string; revision?: string; pending: boolean; toggle: (line: number, checked: boolean) => Promise<void> };
function FileReadView({ file, summaryShown, ...props }: Omit<MarkdownProps, "content" | "path"> & { file: FileContent; summaryShown?: boolean }) {
  if (fileKind(file.path, file.mime) !== "markdown") return <pre className="overflow-auto whitespace-pre-wrap break-words">{file.content}</pre>;
  return <AffairMarkdown {...props} path={file.path} content={summaryShown ? omitReadmeSummary(file.content, file.path) : file.content} />;
}
function AffairMarkdown({ content, path, client, affairId, revision, pending, toggle }: MarkdownProps) {
  const c = useI18n().messages.steward.affairFile;
  const components = useAffairMarkdown(client, affairId, path, revision);
  return <div className="grid min-w-0 gap-3">{markdownParts(content).map((part, index) => {
    if (part.kind === "panel") return <FilePanel key={`${path}:${index}:${JSON.stringify(part.spec)}`} spec={part.spec} client={client} affairId={affairId} />;
    if (part.kind === "invalidPanel") return <div key={index}><p role="alert">{c.invalidPanel}</p><MarkdownContent>{part.text}</MarkdownContent></div>;
    if (part.kind === "task") return <div key={index} className="flex min-w-0 items-start gap-2"><Checkbox aria-label={part.text || `${c.pages} ${part.line}`} className="mt-1" checked={part.checked} disabled={pending} onCheckedChange={value => void toggle(part.line, value === true)} /><MarkdownContent components={components}>{part.text}</MarkdownContent></div>;
    return <MarkdownContent key={index} components={components}>{part.text}</MarkdownContent>;
  })}</div>;
}
