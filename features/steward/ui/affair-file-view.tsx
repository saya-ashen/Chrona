import { useCallback } from "react";
import { useI18n } from "@chrona/i18n";
import type { FileContent } from "@chrona/contracts";
import { Button, Checkbox, MarkdownContent, Textarea } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { fileKind, markdownImages, markdownParts } from "../model/affair-file";
import { useStewardResource } from "../hooks/use-steward";
import { useAffairFile } from "../hooks/use-affair-file";
import { ResourceStatus } from "./resource-status";
import { FilePanel } from "./file-panel";

type FileProps = { client: StewardClient; affairId: string; path: string; refresh: () => void };
export function AffairFileView(props: FileProps) {
  const { client, affairId, path } = props;
  const kind = fileKind(path);
  const c = useI18n().messages.steward.affairFile;
  if (kind === "binary") return <a href={client.rawUrl(affairId, path)} download>{c.download}: {path}</a>;
  if (kind === "image") return <div className="grid gap-3"><img className="max-w-full" src={client.rawUrl(affairId, path)} alt={path} /><a href={client.rawUrl(affairId, path)} download>{c.download}</a></div>;
  return <LoadedFile {...props} />;
}
function LoadedFile(props: FileProps) {
  const { client, affairId, path } = props;
  const resource = useStewardResource(useCallback((signal?: AbortSignal) => client.file(affairId, path, signal), [client, affairId, path]));
  return <><ResourceStatus resource={resource} />{resource.data && <EditableFile key={path} {...props} initial={resource.data} />}</>;
}
export function EditableFile({ client, affairId, initial, refresh }: Omit<FileProps, "path"> & { initial: FileContent }) {
  const c = useI18n().messages.steward.affairFile;
  const f = useAffairFile(client, affairId, initial, refresh);
  return <div className="grid min-w-0 gap-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="break-all font-medium">{f.file.path}</h2>
      {!f.editing && <Button variant="outline" disabled={f.pending} onClick={f.edit}>{c.edit}</Button>}
    </header>
    {f.notice && <p role="alert">{c[f.notice]}</p>}
    {f.editing ? <form className="grid min-w-0 gap-3" onSubmit={event => { event.preventDefault(); void f.save(); }}>
      <label className="grid min-w-0 gap-2">{f.conflict ? c.mine : c.editor}<Textarea aria-label={c.editor} className="min-h-80 font-mono" value={f.draft} onChange={event => f.setDraft(event.target.value)} disabled={f.pending} /></label>
      {f.conflict && <section className="min-w-0"><h3>{c.theirs}</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{f.conflict.content}</pre></section>}
      <div className="flex flex-wrap gap-2"><Button disabled={f.pending} type="submit">{f.conflict ? c.retry : c.save}</Button><Button variant="outline" disabled={f.pending} type="button" onClick={f.cancel}>{c.cancel}</Button></div>
    </form> : fileKind(f.file.path, f.file.mime) === "markdown" ? <AffairMarkdown content={f.file.content} path={f.file.path} client={client} affairId={affairId} pending={f.pending} toggle={f.changeCheckbox} /> : <pre className="overflow-auto whitespace-pre-wrap break-words">{f.file.content}</pre>}
  </div>;
}
function AffairMarkdown({ content, path, client, affairId, pending, toggle }: { content: string; path: string; client: StewardClient; affairId: string; pending: boolean; toggle: (line: number, checked: boolean) => Promise<void> }) {
  const c = useI18n().messages.steward.affairFile;
  return <div className="grid min-w-0 gap-3">{markdownParts(content).map((part, index) => {
    if (part.kind === "panel") return <FilePanel key={`${path}:${index}:${JSON.stringify(part.spec)}`} spec={part.spec} client={client} affairId={affairId} />;
    if (part.kind === "invalidPanel") return <div key={index}><p role="alert">{c.invalidPanel}</p><MarkdownContent>{part.text}</MarkdownContent></div>;
    if (part.kind === "task") return <div key={index} className="flex min-w-0 items-start gap-2"><Checkbox aria-label={part.text || `${c.pages} ${part.line}`} className="mt-2" checked={part.checked} disabled={pending} onCheckedChange={value => void toggle(part.line, value === true)} /><MarkdownContent>{markdownImages(part.text, path, source => client.rawUrl(affairId, source))}</MarkdownContent></div>;
    return <MarkdownContent key={index}>{markdownImages(part.text, path, source => client.rawUrl(affairId, source))}</MarkdownContent>;
  })}</div>;
}
