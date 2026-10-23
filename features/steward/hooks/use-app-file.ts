import { useEffect, useRef, useState } from "react";
import type { FileContent } from "@chrona/contracts";
import { stewardError, type StewardClient } from "../model/client";
import { toggleCheckbox } from "../model/app-file";

export function useAppFile(client: StewardClient, appId: string, initial: FileContent, refresh: () => void) {
  const [file, setFile] = useState(initial);
  const [draft, setDraft] = useState(initial.content);
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState<FileContent | null>(null);
  const [notice, setNotice] = useState<"conflict" | "error" | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const appliedInitial = useRef(initial);
  const latestInitial = useRef(initial);
  useEffect(() => {
    latestInitial.current = initial;
    if (editing || pending || appliedInitial.current.revision === initial.revision && appliedInitial.current.content === initial.content) return;
    appliedInitial.current = initial;
    setFile(initial); setDraft(initial.content);
  }, [initial, editing, pending]);
  // An acknowledged write/read is newer than refresh props received during it.
  function acceptFile(next: FileContent) {
    appliedInitial.current = latestInitial.current;
    setFile(next);
  }
  async function changeCheckbox(line: number, checked: boolean) {
    if (busy.current) return;
    busy.current = true; setPending(true); setNotice(null);
    const previous = file;
    try {
      setFile({ ...file, content: toggleCheckbox(file.content, line, checked) });
      acceptFile(await client.toggleCheckbox(appId, { path: file.path, line, checked, baseRevision: file.revision }));
      refresh();
    } catch (error) {
      setFile(previous);
      const stale = stewardError(error).status === 409;
      setNotice(stale ? "conflict" : "error");
      // Roll back first, then load a fresh revision so the next explicit toggle can succeed.
      if (stale) {
        try { acceptFile(await client.file(appId, previous.path)); } catch { /* Keep the rollback and conflict notice. */ }
      }
    }
    finally { busy.current = false; setPending(false); }
  }
  async function save() {
    if (busy.current) return;
    busy.current = true; setPending(true); setNotice(null);
    try {
      const saved = await client.saveFile(appId, { path: file.path, content: draft, baseRevision: conflict ? conflict.revision : file.revision });
      acceptFile(saved); setDraft(saved.content); setConflict(null); setEditing(false); refresh();
    } catch (error) {
      if (stewardError(error).status === 409) {
        setNotice("conflict");
        try { setConflict(await client.file(appId, file.path)); } catch { setNotice("error"); }
      } else setNotice("error");
    } finally { busy.current = false; setPending(false); }
  }
  function edit() { setDraft(file.content); setConflict(null); setNotice(null); setEditing(true); }
  function cancel() { if (conflict) acceptFile(conflict); setConflict(null); setEditing(false); setNotice(null); }
  return { file, draft, setDraft, editing, edit, cancel, conflict, notice, pending, save, changeCheckbox };
}
