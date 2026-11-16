import { useContext, useEffect, useRef, useState } from "react";
import { SystemContext } from "./action";
/** One local query: refresh keeps the mounted page, inputs and scroll position. */
export function useQuery<T>(tool: string, args: Record<string, unknown> = {}, seconds = 0, enabled = true) {
  const context = useContext(SystemContext)!;
  const call = useRef(context.call); call.current = context.call;
  const signature = JSON.stringify(args);
  const [attempt, retry] = useState(0), [data, setData] = useState<T>(), [error, setError] = useState("");
  const identity = `${tool}:${signature}`, previous = useRef(identity);
  useEffect(() => {
    if (!enabled) return;
    let active = true, pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try { const result = await call.current(tool, JSON.parse(signature) as Record<string, unknown>); if (active) { setData(result as T); setError(""); } }
      catch (error) { console.error(JSON.stringify({ component: "web", event: "system_query_failed", tool, error: String(error) })); if (active) setError(String(error)); }
      finally { pending = false; }
    };
    if (previous.current !== identity) { previous.current = identity; setData(undefined); }
    setError(""); void read();
    const timer = seconds ? setInterval(() => { if (!document.hidden) void read(); }, seconds * 1000) : undefined;
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [tool, signature, seconds, enabled, context.revision, attempt, identity]);
  return { data: enabled ? data : undefined, setData, error: enabled ? error : "", retry: () => retry(value => value + 1) };
}
export function QueryStatus({ query }: { query: { data: unknown; error: string; retry: () => void } }) {
  return query.error ? <div role="alert"><p className="error">读取失败：{query.error}</p><button type="button" onClick={query.retry}>重试</button></div> : query.data === undefined ? <p role="status" className="muted">加载中……</p> : null;
}
