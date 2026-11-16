import { readItems } from "./pagination";
import { applicationCall } from "./kernel-client";
import { chrona, on } from "chrona";
import { createEvents, type Caller, type CallResult, type Directory } from "./events";

const events = createEvents({
  dataDir: chrona.paths.data,
  directory: async () => ({ modules: await readItems(applicationCall, "modules.list", {}), tools: await readItems(applicationCall, "modules.describe", {}) }) as Directory,
  call: (target, args, options) => applicationCall(target, args, options),
});
on("activated", async () => { await startup; await events.reconcile(); return {}; });
on("tool", async (event: { id: string; args: Record<string, unknown>; caller?: Caller }) => {
  // Chrona records the caller of every routed call; only the build's smoke start sends a tool event without one.
  if (!event.caller) return { result: { ignored: "no caller" } };
  await startup;
  return { result: await events.handle(event.id, event.args, event.caller) };
});
on("call_result", async (event: CallResult) => { events.result(event); return {}; });
// Startup checks provide no routed calls. A failed initial directory read leaves the store untouched;
// activation and every real tool call retry and require a current directory before using declarations.
const startup = events.reconcile().catch(error => { console.error("Events startup reconciliation deferred:", String(error)); });
