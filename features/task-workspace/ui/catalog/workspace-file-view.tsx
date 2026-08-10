import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, LockKeyhole } from "lucide-react";
import { useI18n } from "@chrona/i18n";
import { Badge, Button, cn } from "@shared/ui";
import { MarkdownContent } from "../../../../shared/ui/markdown-content";
import {
  approveResultFileAccess,
  requestResultFileAccess,
  type ResultFileAccessRequest,
} from "../../model/task-actions-client";
import { filePreviewErrorMessage, formatFileSize } from "./workspace-registry-utilities";

type FileProps = Record<string, unknown>;
type Preview = { displayPath?: string; contentKind?: "markdown" | "json" | "text" | "csv"; contentPreview?: string; contentTruncated?: boolean; contentBytes?: number; previewError?: string };
type AccessState = "idle" | "requesting" | "approving" | "granted" | "error";

function propText(props: FileProps, key: string) { return typeof props[key] === "string" ? props[key] : undefined; }
function filePath(props: FileProps) { return propText(props, "displayPath") ?? propText(props, "uri") ?? propText(props, "path"); }
function accessFailure(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }

function useFileAccess(props: FileProps, copy: Record<string, string | undefined>) {
  const taskId = propText(props, "accessTaskId") ?? null;
  const requestedPath = propText(props, "accessRequestedPath") ?? null;
  const [request, setRequest] = useState<ResultFileAccessRequest | null>(null);
  const [state, setState] = useState<AccessState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const requestAccess = async () => {
    if (!taskId || !requestedPath) return;
    setState("requesting"); setError(null);
    try { const next = await requestResultFileAccess({ taskId, path: requestedPath }); setRequest(next); setState(next.status === "already_allowed" ? "granted" : "idle"); }
    catch (cause) { setState("error"); setError(accessFailure(cause, copy.fileAccessRequestFailed ?? "Failed to request file access.")); }
  };
  const approve = async () => {
    if (!taskId || !request?.requestId) return;
    setState("approving"); setError(null);
    try { const result = await approveResultFileAccess({ taskId, requestId: request.requestId }); setPreview(result.preview); setState("granted"); }
    catch (cause) { setState("error"); setError(accessFailure(cause, copy.fileAccessApprovalFailed ?? "Failed to read the approved file.")); }
  };
  return { approve, error, preview, request, requestAccess, requestedPath, setRequest, setState, state, taskId };
}

function FileMetadata({ kind, path, props, size }: { kind?: string; path?: string; props: FileProps; size: string | null }) {
  const { messages } = useI18n(); const copy = messages.components.taskWorkspace;
  return <div className="min-w-0 flex-1"><p className="break-words font-medium text-foreground">{propText(props, "title") ?? path ?? "File"}</p>{path ? <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{path}</p> : null}<div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">{kind ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{kind}</Badge> : null}{size ? <span>{size}</span> : null}{props.contentTruncated ? <span>{copy.filePreviewTruncated ?? "Preview truncated"}</span> : null}</div></div>;
}

function FileButtons({ copied, downloadHref, onCopy, onToggle, open, path, previewAvailable }: { copied: boolean; downloadHref?: string; onCopy: () => void; onToggle: () => void; open: boolean; path?: string; previewAvailable: boolean }) {
  const { messages } = useI18n(); const copy = messages.components.taskWorkspace;
  return <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{previewAvailable ? <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-2 text-[11px]" onClick={onToggle} aria-expanded={open}>{open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}{open ? copy.artifactHidePreview ?? "Hide preview" : copy.artifactPreview ?? "Preview"}</Button> : null}{downloadHref ? <Button asChild variant="ghost" size="sm" className="h-7 rounded-full px-2 text-[11px]"><a href={downloadHref} download><Download className="size-3.5" aria-hidden />{copy.downloadArtifact ?? "Download"}</a></Button> : null}{path ? <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-2 text-[11px]" onClick={onCopy}>{copied ? copy.artifactPathCopied ?? "Copied" : copy.copyArtifactPath ?? "Copy path"}</Button> : null}</div>;
}

function FileHeader({ copied, kind, onCopy, onToggle, open, path, props, size }: { copied: boolean; kind?: string; onCopy: () => void; onToggle: () => void; open: boolean; path?: string; props: FileProps; size: string | null }) {
  return <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><FileMetadata kind={kind} path={path} props={props} size={size} /><FileButtons copied={copied} downloadHref={propText(props, "downloadHref")} onCopy={onCopy} onToggle={onToggle} open={open} path={path} previewAvailable={Boolean(propText(props, "contentPreview"))} /></div>;
}

function AccessRequest({ access, copy }: { access: ReturnType<typeof useFileAccess>; copy: Record<string, string | undefined> }) {
  const pending = access.state === "requesting" || access.state === "approving";
  if (access.request) return null;
  return <><Button type="button" variant="outline" size="sm" className="mt-2 h-7 rounded-full px-2 text-[11px]" disabled={pending} onClick={() => void access.requestAccess()}><LockKeyhole className="size-3.5" aria-hidden />{access.state === "requesting" ? copy.fileAccessChecking ?? "Checking..." : copy.fileAccessRequest ?? "Request access"}</Button><p className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-xs text-foreground/80">{copy.fileAccessRequired ?? "This file is outside Chrona's generated-file directory. Review the path before allowing a one-time read."}</p></>;
}

function ApprovalRequest({ access, copy }: { access: ReturnType<typeof useFileAccess>; copy: Record<string, string | undefined> }) {
  const request = access.request;
  if (request?.status !== "permission_required" || access.state === "granted") return null;
  const approving = access.state === "approving";
  return <div className="mt-2 space-y-2 rounded-lg border border-warning/35 bg-warning/10 p-3 text-xs" role="group" aria-label={copy.fileAccessReviewLabel ?? "File access review"}><p className="font-medium text-foreground">{copy.fileAccessReviewTitle ?? "Allow Chrona to read this file once?"}</p><p className="break-all font-mono text-[11px] text-muted-foreground">{request.canonicalPath}</p><div className="flex flex-wrap gap-2 text-muted-foreground">{request.extension ? <span>{request.extension}</span> : null}{typeof request.size === "number" ? <span>{formatFileSize(request.size)}</span> : null}</div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={approving} onClick={() => void access.approve()}>{approving ? copy.fileAccessReading ?? "Reading..." : copy.fileAccessAllowOnce ?? "Allow once"}</Button><Button type="button" size="sm" variant="outline" disabled={approving} onClick={() => { access.setRequest(null); access.setState("idle"); }}>{copy.fileAccessCancel ?? "Cancel"}</Button></div></div>;
}

function FileAccessControls({ access, copy, props }: { access: ReturnType<typeof useFileAccess>; copy: Record<string, string | undefined>; props: FileProps }) {
  if (props.previewError !== "permission_required" || !access.taskId || !access.requestedPath) return null;
  return <><AccessRequest access={access} copy={copy} /><ApprovalRequest access={access} copy={copy} /></>;
}

function FilePreview({ content, kind, open, truncated }: { content?: string; kind?: string; open: boolean; truncated: boolean }) {
  if (!content || !open) return null;
  const height = content.length > 1200 || truncated ? "max-h-[70vh]" : "max-h-80";
  return kind === "markdown" ? <div className={cn("mt-2 min-w-0 max-w-full overflow-auto rounded-lg bg-muted/25 px-3 py-2 text-sm leading-6 text-foreground", height)}><MarkdownContent className="py-0">{content}</MarkdownContent></div> : <pre className={cn("mt-2 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/35 p-2 text-xs leading-5 text-foreground/80", height)}>{content}</pre>;
}

function useDisplay(props: FileProps, preview: Preview | null, copy: Record<string, string | undefined>) {
  const content = preview?.contentPreview ?? propText(props, "contentPreview");
  const kind = preview?.contentKind ?? propText(props, "contentKind");
  const error = preview ? filePreviewErrorMessage(preview.previewError, copy) : filePreviewErrorMessage(props.previewError, copy);
  return { content, error, kind, path: filePath(props), size: formatFileSize(preview?.contentBytes ?? props.contentBytes), truncated: Boolean(preview?.contentTruncated ?? props.contentTruncated) };
}

export function FileView({ props }: { props: FileProps }) {
  const { messages } = useI18n(); const copy = messages.components.taskWorkspace;
  const [open, setOpen] = useState(false); const [copied, setCopied] = useState(false);
  const access = useFileAccess(props, copy); const display = useDisplay(props, access.preview, copy);
  useEffect(() => {
    if (access.preview?.contentPreview) setOpen(true);
  }, [access.preview?.contentPreview]);
  const copyPath = () => { if (!display.path) return; void navigator.clipboard?.writeText(display.path).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); }); };
  return <article className="min-w-0 w-full max-w-full border-t border-border/60 py-2 text-sm first:border-t-0"><FileHeader copied={copied} kind={display.kind} onCopy={copyPath} onToggle={() => setOpen((value) => !value)} open={open} path={display.path} props={{ ...props, contentPreview: display.content }} size={display.size} />{display.error && props.previewError !== "permission_required" ? <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">{display.error}</p> : null}<FileAccessControls access={access} copy={copy} props={props} />{access.error ? <p className="mt-2 text-xs font-medium text-destructive" role="alert">{access.error}</p> : null}<FilePreview content={display.content} kind={display.kind} open={open} truncated={display.truncated} /></article>;
}
