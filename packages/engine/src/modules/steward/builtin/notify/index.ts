import { chrona, on } from "chrona";
import { openStore } from "./store";
import { createNotify, type Caller, type CallResult } from "./notify";

const store = openStore(chrona.paths.data);
const notify = createNotify({ store, publicUrl: process.env.CHRONA_PUBLIC_URL ?? null,
  call: (target, args, options) => chrona.call(target, args, options), status: callId => chrona.callStatus(callId) });

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
  if (event.id === "channel" && event.caller?.kind === "module") {
    const target = `${event.caller.module}.${String(event.args.tool)}`;
    try {
      // Discovery checks modules visibility; registration does not change the tool's audience.
      const output = await chrona.call("modules.tools", { query: target });
      if (!Array.isArray(output) || !output.some(tool => tool && typeof tool === "object" && "target" in tool && tool.target === target)) {
        return { result: { error: "forbidden", message: "Delivery tool must belong to the caller and grant notify access" } };
      }
    } catch { return { result: { error: "unavailable", message: "Could not check delivery tool; register again" } }; }
  }
  const result = notify.handle(event.id, event.args, event.caller ?? { kind: "kernel" }, new Date(event.now));
  if (["send", "channel", "retry"].includes(event.id)) setTimeout(() => void tick(), 0);
  return { result };
});
on("call_result", async (event: CallResult) => { notify.result(event, new Date()); return {}; });
setInterval(() => void tick(), 15_000);
void tick();
