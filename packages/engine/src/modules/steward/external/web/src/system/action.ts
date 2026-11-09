import { createContext, useContext, useRef, useState } from "react";

type Args = Record<string, unknown>;
export const SystemContext = createContext<{ call: (tool: string, args: Args) => Promise<unknown>; refresh: () => void } | null>(null);
export function useAction() {
  const context = useContext(SystemContext)!;
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false);
  const act = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { await work(); } catch (error) { setError((error as Error).message); }
    finally { busy.current = false; setPending(false); }
  };
  return { ...context, pending, error, act };
}
