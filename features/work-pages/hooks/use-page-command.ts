import { useEffect, useId, useRef, useState } from "react";
import { usePageDrafts } from "./page-drafts";
import type { PageInputsView, PageWrite } from "@chrona/contracts";
import { pageError, pageRequest, type PageAction, type PageScope } from "../model/client";

export function usePageCommand(scope: PageScope, initialRevision: string | null, onSaved: () => void) {
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [error, setError] = useState<ReturnType<typeof pageError> | null>(null);
  const [pending, setPending] = useState<PageWrite | null>(null);
  const [latest, setLatest] = useState<PageInputsView | null>(null);
  const lock = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    // A successful write in this same tab advances only a known predecessor.
    // Other tabs / remote writes still require a fresh read and reconciliation.
    const advance = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; occurrenceId: string | null; before: string | null; after: string }>).detail;
      if (detail.taskId === scope.taskId && detail.occurrenceId === scope.occurrenceId) setRevision((old) => old === detail.before ? detail.after : old);
    };
    window.addEventListener("chrona-page-input-saved", advance);
    return () => window.removeEventListener("chrona-page-input-saved", advance);
  }, [scope.taskId, scope.occurrenceId]);
  async function send(input: PageWrite) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setSaved(false); setPending(input);
    try {
      const result = await pageRequest<{ receipt: { revision: string } }>("input", input);
      window.dispatchEvent(new CustomEvent("chrona-page-input-saved", { detail: { ...scope, before: input.expectedRevision, after: result.receipt.revision } }));
      if (live.current) { setRevision(result.receipt.revision); setPending(null); setSaved(true); setLatest(null); onSaved(); }
    } catch (cause) { if (live.current) setError(pageError(cause)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  return { busy, saved, error, pending, latest, revision, changed: () => setSaved(false),
    commit: (action: PageAction) => send({ ...scope, requestId: crypto.randomUUID(), expectedRevision: revision, action }),
    retry: () => pending ? send(pending) : Promise.resolve(),
    reconcile: async () => {
      setBusy(true);
      try { setLatest(await pageRequest<PageInputsView>("read", { ...scope, limit: 20 })); } catch { setError("unknown"); }
      finally { setBusy(false); }
    },
    keepDraft: () => { if (latest) { setRevision(latest.revision); setPending(null); setError(null); setLatest(null); } },
  };
}
export type PageCommand = ReturnType<typeof usePageCommand>;
export function useUnsavedPage(dirty: boolean) {
  const id = useId(), drafts = usePageDrafts(), mark = drafts?.mark;
  useEffect(() => { mark?.(id, dirty); return () => mark?.(id, false); }, [id, mark, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return id;
}
