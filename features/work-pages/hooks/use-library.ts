import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { LibraryAction, LibraryRead, LibraryView, LibraryWrite, LibraryWriteResult } from "@chrona/contracts";
import { LIBRARY_CHANGED, readLibrary, writeLibrary } from "../model/library-client";
import { pageError } from "../model/client";
export function useLibrary(input: Partial<LibraryRead>) {
  const key = JSON.stringify(input), location = useLocation();
  const [data, setData] = useState<LibraryView | null>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true), [reload, setReload] = useState(0);
  useEffect(() => { const update = () => setReload(n => n + 1); window.addEventListener(LIBRARY_CHANGED, update); return () => window.removeEventListener(LIBRARY_CHANGED, update); }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(false);
    void readLibrary(JSON.parse(key) as Partial<LibraryRead>, controller.signal).then(v => { if (!controller.signal.aborted) setData(v); }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, reload, location.pathname]);
  return { data, error, loading, refresh: () => setReload(n => n + 1) };
}
export function useLibraryCommand(onSaved?: (value: LibraryWriteResult) => void) {
  const [pending, setPending] = useState<LibraryWrite | null>(null), [error, setError] = useState<ReturnType<typeof pageError> | null>(null), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function send(input: LibraryWrite) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setPending(input); setError(null);
    try {
      const result = await writeLibrary(input); setPending(null);
      window.dispatchEvent(new Event(LIBRARY_CHANGED)); onSaved?.(result);
    } catch (cause) { const kind = pageError(cause); setError(kind); if (kind !== "unknown") setPending(null); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, pending, error, clearError: () => setError(null), save: (revision: string, action: LibraryAction) => send({ requestId: crypto.randomUUID(), expectedRevision: revision, action }), retry: () => pending ? send(pending) : Promise.resolve() };
}
