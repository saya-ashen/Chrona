import { useRef, useState } from "react";
import { staleResponse } from "../model/management";
export function useStewardMutation(refresh: () => void) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "stale" | "mutationError" | null>(null);
  async function run(operation: () => Promise<unknown>) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setNotice(null);
    try { await operation(); setNotice("saved"); refresh(); return true; }
    catch (error) { if (staleResponse(error)) { setNotice("stale"); refresh(); } else setNotice("mutationError"); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, notice, run, reset: () => setNotice(null) };
}
