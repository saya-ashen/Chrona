import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { callAgent } from "./agent";
import { readCodingWork } from "./storage";
import { readPrivate } from "./mutations";
import { serializeConversation } from "./sessions";
import type { CodingContext } from "./types";

/** Reconcile only existing admissions. Never dispatch or replay an uncertain operation. */
export async function observeCodingEvidence(context: CodingContext) {
  let files: string[];
  try { files = await readdir(join(context.dir, "sessions")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const name of files.filter(name => /^run-[a-f0-9]{64}\.json$/.test(name))) {
    const value = await readPrivate<{ workId: string; run?: unknown }>(context, name);
    if (!value) continue;
    try {
      if (!value.run) {
        const work = await readCodingWork(context, value.workId);
        await callAgent(context, "lookup-start", { commandKey: work.start.commandKey });
      }
      await callAgent(context, "get", { workId: value.workId });
    }
    catch (error) {
      // Kernel availability is transient; an unknown run cannot become stopped here.
      if (!["unavailable", "not_found"].includes((error as { code?: string }).code ?? "")) throw error;
    }
  }
}
/** Entry calls once at startup; disposal stops future sweeps without interrupting an atomic freeze. */
export function startCodingEvidenceObserver(context: CodingContext, onError: (error: unknown) => void = error => console.error("Coding evidence observation failed", error)) {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const sweep = async () => {
    try { await serializeConversation(() => observeCodingEvidence(context)); }
    catch (error) { onError(error); }
    if (!stopped) { timer = setTimeout(() => void sweep(), 1000); timer.unref(); }
  };
  void sweep();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
