import { useRef, useState } from "react";
import { stewardError, type StewardClientError } from "../model/client";

export function useStewardMutation(refresh: () => void | Promise<void>) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<StewardClientError | null>(null);
  async function run<T>(operation: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
    if (locked.current) return { ok: false };
    locked.current = true; setPending(true); setError(null);
    try {
      const data = await operation();
      await refresh();
      return { ok: true, data };
    } catch (cause) {
      setError(stewardError(cause));
      return { ok: false };
    } finally { locked.current = false; setPending(false); }
  }
  return { pending, error, run, reset: () => setError(null) };
}
