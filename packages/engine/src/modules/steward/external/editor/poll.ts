import { EXECUTION_EVENT_LIMITS, type ExecutionCommand, type ExecutionEventPage } from "./contract.js";
import { handleEditorCommand } from "./protocol";

let active = 0;
function aborted() { return new DOMException("Editor request aborted", "AbortError"); }
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal, remaining: number): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(aborted()); };
    const timer = setTimeout(() => { cleanup(); reject(Object.assign(new Error("Editor read deadline reached"), { code: "unavailable" })); }, Math.max(1, remaining));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { signal.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(aborted()); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
/** Single owner HTTP slots; the routed API never receives a long waiter or business cancellation. */
export async function pollEditorEvents(request: Request, command: Extract<ExecutionCommand, { op: "events" }>, read: (input: Extract<ExecutionCommand, { op: "events" }>) => Promise<ExecutionEventPage> = handleEditorCommand): Promise<ExecutionEventPage> {
  if (request.signal.aborted) throw aborted();
  if (active >= EXECUTION_EVENT_LIMITS.ownerPolls) throw Object.assign(new Error("Editor polling capacity reached"), { code: "capacity", retryAfterMs: 250 });
  active++;
  try {
    const started = Date.now(), deadline = started + Math.min(command.waitMs, EXECUTION_EVENT_LIMITS.pollMs);
    let cursor = command.cursor;
    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal can change across the preceding awaited routed read/pause.
      if (request.signal.aborted) throw aborted();
      const page = await untilAbort(read({ ...command, cursor, waitMs: 0 }), request.signal, started + EXECUTION_EVENT_LIMITS.pollMs - Date.now());
      if (page.events.length || page.gap || page.snapshotRequired || Date.now() >= deadline) return page;
      cursor = page.cursor;
      await pause(Math.min(250, Math.max(0, deadline - Date.now())), request.signal);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Abort may win during the preceding pause.
      if (request.signal.aborted) throw aborted();
      if (Date.now() >= deadline) return page;
    }
  } finally { active--; }
}
