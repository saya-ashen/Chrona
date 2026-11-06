import { EXECUTION_EVENT_LIMITS as limits, type ExecutorFinal, type ExecutionEvent, type ExecutionRef, type ExecutionSnapshot } from "@chrona/contracts/steward";
import { CallError } from "./module-calls";
import { canonicalExecutionFinalDisplay } from "./execution-final-display";
export { canonicalExecutionFinalDisplay } from "./execution-final-display";

export function executionLifecycle(snapshot: ExecutionSnapshot): string {
  return JSON.stringify([snapshot.status, snapshot.cancelRequested, snapshot.stopConfirmed]);
}

export function executionCursor(ref: ExecutionRef, after: number, lifecycle?: string): string {
  const position: (string | number)[] = [ref.workId, ref.sessionId, ref.runId, ref.attemptId, after];
  if (lifecycle !== undefined) position.push(lifecycle);
  return Buffer.from(JSON.stringify(position)).toString("base64url");
}

/** Positions carry no authority; callers must independently authorize the attempt first. */
export function executionPosition(ref: ExecutionRef, cursor?: string): { after: number; lifecycle: string | null } {
  if (cursor === undefined) return { after: 0, lifecycle: null };
  if (cursor.length > 1024 || !/^[\w-]+$/.test(cursor)) throw new CallError("invalid", "Invalid execution cursor");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(cursor, "base64url").toString()); }
  catch { throw new CallError("invalid", "Invalid execution cursor"); }
  if (!Array.isArray(value) || (value.length !== 5 && value.length !== 6) || !Number.isSafeInteger(value[4]) || value[4] < 0) throw new CallError("invalid", "Invalid execution cursor");
  if (value.length === 6 && (typeof value[5] !== "string" || value[5].length > 128)) throw new CallError("invalid", "Invalid execution lifecycle position");
  if (value[0] !== ref.workId || value[1] !== ref.sessionId || value[2] !== ref.runId || value[3] !== ref.attemptId) throw new CallError("conflict", "Execution cursor reference mismatch");
  return { after: value[4] as number, lifecycle: value.length === 6 ? value[5] as string : null };
}

/** A bounded recoverable display, never a controller or question-answer authority. */
export function reduceExecutionEvent(snapshot: ExecutionSnapshot, event: ExecutionEvent): ExecutionSnapshot {
  const next = { ...snapshot, highWatermark: event.seq, missing: snapshot.missing || event.seq !== snapshot.highWatermark + 1 };
  const p = event.payload;
  switch (p.type) {
    case "message":
      if (p.role === "assistant") next.finalMessage = { messageId: p.messageId, text: p.text, truncated: !p.complete };
      break;
    case "text_delta": {
      const prior = next.finalMessage?.messageId === p.messageId ? next.finalMessage : null;
      const text = (prior?.text ?? "") + p.delta;
      next.finalMessage = { messageId: p.messageId, text: text.slice(0, 24_000), truncated: true };
      break;
    }
    case "question": next.questions = [...snapshot.questions.filter(q => q.requestId !== p.question.requestId), p.question].slice(-12); break;
    case "state": next.status = p.status; next.cancelRequested = p.cancelRequested; next.stopConfirmed = p.stopConfirmed; break;
    case "gap": next.missing = true; break;
    default: break;
  }
  return next;
}

export function retainedExecutionSnapshot(snapshot: ExecutionSnapshot, now: Date): ExecutionSnapshot {
  return { ...snapshot, questions: snapshot.questions.map(q => ({ ...q,
    status: q.status === "pending" ? Date.parse(q.expiresAt) <= now.getTime() ? "expired" : "interrupted" : q.status })) };
}

/** No buffered queue: append resolves only after its bounded SQLite write commits. */
export function executionWait(signal: AbortSignal | undefined, ms: number): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, Math.min(ms, limits.flushMs));
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}

export function assertCanonicalExecutionFinalDisplay(final: Pick<ExecutorFinal, "finalMessage" | "outcome">) {
  const canonical = canonicalExecutionFinalDisplay(final);
  if (canonical.finalMessage?.text !== final.finalMessage?.text || canonical.outcome.error !== final.outcome.error) throw new CallError("invalid", "Final display fields must be normalized before digesting");
}
