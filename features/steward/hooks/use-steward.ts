import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStewardClient, stewardError, type StewardClientError } from "../model/client";

export function useStewardClient(workspaceId: string) {
  return useMemo(() => createStewardClient(workspaceId), [workspaceId]);
}
/** Refresh retains data; changing the loader clears data from the previous scope. */
export function useStewardResource<T>(load: (signal?: AbortSignal) => Promise<T>, poll: boolean | number = false, revision?: string) {
  const [state, setState] = useState<{ loader: typeof load; data: T | null; loading: boolean; error: StewardClientError | null }>({ loader: load, data: null, loading: true, error: null });
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(false);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    inFlight.current = true;
    setState(previous => ({ loader: load, data: previous.loader === load ? previous.data : null, loading: true, error: null }));
    void load(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ loader: load, data, loading: false, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error: stewardError(error) }));
    }).finally(() => { if (!controller.signal.aborted) inFlight.current = false; });
    return () => { controller.abort(); inFlight.current = false; };
  }, [load, generation, revision]);
  useEffect(() => {
    if (!poll) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = (event?: Event) => {
      clearInterval(timer);
      if (!document.hidden) {
        if (event && !inFlight.current) refresh();
        timer = setInterval(() => { if (!inFlight.current) refresh(); }, typeof poll === "number" ? poll : 15_000);
      }
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [poll, refresh]);
  return { data: state.loader === load ? state.data : null, loading: state.loader !== load || state.loading, error: state.loader === load ? state.error : null, refresh };
}

/** A scheduled/QQ-triggered run can start while Today is open and previously idle. */
export function useSteward(workspaceId: string, chatPending = false) {
  const client = useStewardClient(workspaceId);
  const resource = useStewardResource(client.today, true);
  useEffect(() => { if (chatPending) resource.refresh(); }, [chatPending, resource.refresh]);
  return { ...resource, client };
}
