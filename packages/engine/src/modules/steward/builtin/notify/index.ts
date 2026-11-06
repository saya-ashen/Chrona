import { chrona, on } from "chrona";
import { openStore } from "./store";
import { createNotify, type Caller, type CallResult } from "./notify";
import type { Directory } from "./registry";

const store = openStore(chrona.paths.data);
const notify = createNotify({ store, publicUrl: process.env.CHRONA_PUBLIC_URL ?? null,
  call: (target, args, options) => chrona.call(target, args, options), status: callId => chrona.callStatus(callId),
  directory: async () => ({ modules: await chrona.call("modules.list", {}), tools: await chrona.call("modules.tools", {}) }) as Directory });

// Deliveries run beside events; one pass at a time.
let busy = false, again = false;
async function tick() {
  if (busy) { again = true; return; }
  busy = true;
  const pass = async () => { again = false; await notify.tick(new Date()); return again; };
  try {
    let rerun = await pass();
    while (rerun) rerun = await pass();
  } catch (error) { console.error(JSON.stringify({ component: "notify", event: "tick_failed", error: String(error).slice(0, 500) })); }
  finally { busy = false; }
}
on("tool", async (event: { id: string; args: Record<string, unknown>; caller?: Caller; now: string }) => {
  if (["channel", "status"].includes(event.id)) {
    try { await notify.refresh(); }
    catch { return { result: { error: "unavailable", message: "Could not check current channels; try again when the module directory is available" } }; }
  }
  const result = notify.handle(event.id, event.args, event.caller ?? { kind: "kernel" }, new Date(event.now));
  if (["send", "channel", "retry"].includes(event.id)) setTimeout(() => void tick(), 0);
  return { result };
});
on("call_result", async (event: CallResult) => { notify.result(event, new Date()); return {}; });
setInterval(() => void tick(), 15_000);
void tick();
