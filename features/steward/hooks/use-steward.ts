import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStewardClient, type StewardClient } from "../model/client";
import { decisionInput, type AttentionDecision } from "../model/today";

export function useStewardClient(workspaceId: string) { return useMemo(() => createStewardClient(workspaceId), [workspaceId]); }
export function useStewardResource<T>(load: (signal?: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);
  const previousLoad = useRef(load);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    // Refresh the same resource without unmounting its local answers/results.
    // A new loader (workspace, affair or filter) must not retain old scoped data.
    if (previousLoad.current !== load) setData(null);
    previousLoad.current = load;
    void load(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, generation]);
  return { data, loading, error, refresh };
}
export function useAttentionDecision(client: StewardClient, refresh: () => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const locked = useRef(false);
  async function decide(id: string, decision: AttentionDecision) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false);
    try { await client.decideAttention(id, decisionInput(decision, new Date())); refresh(); }
    catch { setError(true); }
    finally { locked.current = false; setBusy(false); }
  }
  return { busy, error, decide, clearError: () => setError(false) };
}
