import { useEffect, useRef, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { workResults as wr } from "@chrona/contracts";
import { resultRequest, type ResultScope } from "../model/client";
import { beginFile, readUploadRecovery, restoreUpload, saveUploadRecovery, sendFile, type UploadRecovery } from "../model/files";

export function useResultFileUpload(scope: ResultScope) {
  const c = useI18n().messages.workResults;
  const [file, setFile] = useState<File | null>(null);
  const [recovery, setRecovery] = useState<UploadRecovery | null>(() => readUploadRecovery(scope));
  const [status, setStatus] = useState<wr.ResultUploadStatus | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function remember(value: UploadRecovery) {
    setRecovery(value);
    if (!saveUploadRecovery(value)) setError(c.recoveryLost);
  }
  async function transfer(resume: boolean) {
    if (!file) return;
    setBusy(true); setError(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const entry = resume && recovery ? recovery : await beginFile(file, scope);
      remember(entry);
      const current = await restoreUpload(entry); setStatus(current);
      remember({ ...entry, uploadId: current.uploadId });
      await sendFile(file, entry, current, setStatus, abort.signal);
    } catch (cause) { setError(cause instanceof Error && cause.message === "uploadMismatch" ? c.uploadMismatch : c.error); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!recovery) return;
    setBusy(true); setError(null);
    try { const restored = await restoreUpload(recovery); setStatus(restored); remember({ ...recovery, uploadId: restored.uploadId }); }
    catch { setError(c.error); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!status) return;
    setBusy(true); setError(null);
    try { setStatus(await resultRequest<wr.ResultUploadStatus>("file", { ...scope, action: { type: "cancel", uploadId: status.uploadId } })); }
    catch { setError(c.error); } finally { setBusy(false); }
  }
  return { file, setFile, recovery, status, busy, error, transfer, restore, cancel };
}
