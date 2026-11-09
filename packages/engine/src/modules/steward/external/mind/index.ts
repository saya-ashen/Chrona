import { chrona, on, onDisconnect, ModelError } from "chrona";
import { z } from "zod";
import { MAIN_PAGE } from "./page";
import { SETTINGS_PAGE } from "./settings-page";
import { inputs, outputs } from "./schema";
import { MindStore } from "./store";
import { MindService } from "./service";
import { MindRuntime } from "./runtime";
import type { Tool } from "./types";

const store = new MindStore(chrona.paths.data);
const service = new MindService(store);
const runtime = new MindRuntime(store, (target, args, options) => chrona.call(target, args, options));
let pagesReady = false, registering = false;
async function registerPages() {
  if (pagesReady || registering) return;
  registering = true;
  try {
    for (const page of [MAIN_PAGE, SETTINGS_PAGE]) {
      const result = await chrona.call("web.page-set", page);
      if (result && typeof result === "object" && "error" in result) throw new Error("Web rejected a Mind page");
    }
    pagesReady = true;
  } catch { console.error(JSON.stringify({ component: "mind", event: "page_registration_unavailable" })); }
  finally { registering = false; }
}
async function background() {
  try { await runtime.tick(); }
  catch { console.error(JSON.stringify({ component: "mind", event: "check_failed", message: "Inspect the private state and runtime error; state was not reset" })); }
}
function codedError(error: unknown): never {
  if (error instanceof ModelError) throw error;
  if (error instanceof z.ZodError) throw new ModelError("invalid", "Invalid Mind input or output");
  if (error instanceof Error && "code" in error && typeof error.code === "string" && ["invalid", "forbidden", "conflict", "capacity"].includes(error.code)) throw new ModelError(error.code, error.message);
  throw error;
}
on("activated", async () => { pagesReady = false; await registerPages(); return {}; });
on("tool", async event => {
  try {
    if (!Object.hasOwn(inputs, event.id)) throw new ModelError("invalid", "Unknown Mind tool");
    const name = event.id as Tool;
    // These exact routes have owner-only manifest visibility. Kernel admission already
    // checked the current approved caller; preserve its identity for receipt scopes.
    const admittedOwner = ["ui-agenda", "ui-dismiss", "decisions", "note", "check", "ui-settings"].includes(name)
      && (event.caller?.kind === "owner" || event.caller?.kind === "module");
    let result = await service.tool(name, event.args, event.caller, event.now, admittedOwner);
    if (name === "check") result = await runtime.tick(event.now, true);
    return { result: outputs[name].parse(result) };
  } catch (error) { codedError(error); }
});
const timer = setInterval(() => { void background(); }, 30_000);
const pageTimer = setInterval(() => { void registerPages(); }, 60_000);
onDisconnect(() => { clearInterval(timer); clearInterval(pageTimer); });
void background();
