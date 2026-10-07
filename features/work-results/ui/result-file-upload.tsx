import { useI18n } from "@chrona/i18n";
import { workResults as wr } from "@chrona/contracts";
import { Button, Input, Label } from "@shared/ui";
import type { ResultScope } from "../model/client";
import { useResultFileUpload } from "../hooks/use-result-file-upload";

type Upload = ReturnType<typeof useResultFileUpload>;
type Props = { scope: ResultScope; disabled: boolean; onAttach: (status: wr.ResultUploadStatus) => void };
function uploadActions(upload: Upload, disabled: boolean) {
  const locked = upload.busy || disabled || !upload.file;
  const pending = !!upload.recovery && (!upload.status || upload.status.status === "open");
  return { start: !locked && !pending, resume: !locked && (!upload.status || upload.status.status === "open"), attach: !disabled && !upload.busy };
}
function ResultUploadActions({ upload, disabled, onAttach }: { upload: Upload } & Pick<Props, "disabled" | "onAttach">) {
  const c = useI18n().messages.workResults;
  const allowed = uploadActions(upload, disabled), status = upload.status;
  return <div className="flex flex-wrap gap-2">
    <Button type="button" variant="outline" disabled={!allowed.start} onClick={() => void upload.transfer(false)}>{upload.busy ? c.uploading : c.upload}</Button>
    {upload.recovery && <><Button type="button" variant="outline" disabled={upload.busy} onClick={() => void upload.restore()}>{c.restore}</Button><Button type="button" variant="outline" disabled={!allowed.resume} onClick={() => void upload.transfer(true)}>{c.resume}</Button></>}
    {status?.status === "open" && <Button type="button" variant="outline" disabled={upload.busy} onClick={() => void upload.cancel()}>{c.cancelUpload}</Button>}
    {status?.status === "completed" && <Button type="button" disabled={!allowed.attach || !status.artifactAvailable} onClick={() => onAttach(status)}>{c.attach}</Button>}
  </div>;
}
export function ResultFileUpload({ scope, disabled, onAttach }: Props) {
  const c = useI18n().messages.workResults, upload = useResultFileUpload(scope), status = upload.status;
  return <section className="min-w-0 space-y-2" aria-label={c.upload}>
    <p className="text-sm text-muted-foreground">{c.uploadHelp}</p><Label htmlFor="result-file">{c.file}</Label>
    <Input id="result-file" type="file" disabled={upload.busy || disabled} onChange={(event) => upload.setFile(event.target.files?.[0] ?? null)} />
    {upload.recovery && !status && <p className="text-sm">{c.savedUpload}</p>}
    {status && <p role="status" className="break-all text-sm">{status.filename} · {c[status.status]} · {status.receivedBytes}/{status.sizeBytes} · {status.uploadId}</p>}
    {upload.error && <p role="alert">{upload.error}</p>}
    <ResultUploadActions upload={upload} disabled={disabled} onAttach={onAttach} />
  </section>;
}
