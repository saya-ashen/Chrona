import { useCallback, useEffect, useRef, useState } from "react";
import { readWork, searchWork, workError, writeWork } from "../model/client";
import type { WorkView, WorkSearch, WorkReceipt } from "@chrona/contracts";
function useOffsets(key: string) {
  const [offsets, setOffsets] = useState([0]);
  useEffect(() => { setOffsets([0]); }, [key]);
  return { offset: offsets.at(-1)!, previousOffset: offsets.at(-2) ?? 0, setOffset: (next: number) => setOffsets(values => {
    const index = values.indexOf(next);
    return index >= 0 ? values.slice(0, index + 1) : [...values, next];
  }) };
}
export function useWorkRecord(taskId: string) {
  const paging = useOffsets(taskId), { offset } = paging;
  const [data, setData] = useState<WorkView | null>(null), [generation, setGeneration] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState<ReturnType<typeof workError> | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    void readWork(taskId, offset, controller.signal).then(v => { if (!controller.signal.aborted) setData(v); })
      .catch(e => { if (!controller.signal.aborted) setError(workError(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [taskId, offset, generation]);
  return { data, loading, error, ...paging, refresh: useCallback(() => setGeneration(n => n + 1), []) };
}
export function useWorkInbox(attentionOnly: boolean, query: string) {
  const paging = useOffsets(`${attentionOnly}:${query}`), { offset } = paging;
  const [data, setData] = useState<WorkSearch | null>(null), [generation, setGeneration] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState<ReturnType<typeof workError> | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    void searchWork(attentionOnly, offset, query, controller.signal).then(v => { if (!controller.signal.aborted) setData(v); })
      .catch(e => { if (!controller.signal.aborted) setError(workError(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attentionOnly, query, offset, generation]);
  return { data, loading, error, ...paging, refresh: useCallback(() => setGeneration(n => n + 1), []) };
}
/** Retain exact intent for retries; never silently swap a revision after conflict. */
export function useWorkMutation(onSaved: (receipt: WorkReceipt) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<ReturnType<typeof workError> | null>(null);
  const pending = useRef<{ method: "capture" | "update"; input: Record<string, unknown> } | null>(null);
  const active = useRef(false);
  async function send() {
    if (!pending.current || active.current) return;
    active.current = true; setBusy(true); setError(null);
    try { const result = await writeWork(pending.current.method, pending.current.input); pending.current = null; onSaved(result); }
    catch (cause) { setError(workError(cause)); }
    finally { active.current = false; setBusy(false); }
  }
  return { busy, error, locked: busy || !!pending.current, invalid: () => setError("invalid"),
    run: (method: "capture" | "update", input: Record<string, unknown>) => {
      if (pending.current || active.current) return;
      pending.current = { method, input: { ...input, requestId: crypto.randomUUID() } }; void send();
    }, retry: () => void send(), discard: () => { if (!active.current) { pending.current = null; setError(null); } } };
}
export type WorkMutation = ReturnType<typeof useWorkMutation>;
