import { chrona, on } from "chrona";
import { createEvents, type Caller, type CallResult } from "./events";

const events = createEvents({
  dataDir: chrona.paths.data,
  contributions: () => chrona.call("modules.contributions", { section: "events" }),
  reachable: async (query: string) => ((await chrona.call("modules.tools", { query })) as { target: string }[]).map(tool => tool.target),
  call: (target, args, options) => chrona.call(target, args, options),
});
on("tool", async (event: { id: string; args: Record<string, unknown>; caller?: Caller }) => {
  // Chrona records the caller of every routed call; only the build's smoke start sends a tool event without one.
  if (!event.caller) return { result: { ignored: "no caller" } };
  return { result: await events.handle(event.id, event.args, event.caller) };
});
on("call_result", async (event: CallResult) => { events.result(event); return {}; });
