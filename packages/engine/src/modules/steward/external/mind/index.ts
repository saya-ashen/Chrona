import { applicationCall } from "./kernel-client";
import { chrona, on, onDisconnect, ModelError } from "chrona";
import { z } from "zod";
import { MAIN_PAGE } from "./page";
import { SETTINGS_PAGE } from "./settings-page";
import { inputs, outputs } from "./schema";
import { MindStore } from "./store";
import { MindService } from "./service";
import { MindRuntime } from "./runtime";
import { MindSources } from "./sources";
import { MindWakeups, REVIEW_TIMER } from "./wakeups";
import type { Tool } from "./types";

const store = new MindStore(chrona.paths.data);
const service = new MindService(store);
const runtime = new MindRuntime(store, (target, args, options) => applicationCall(target, args, options));
const sources = new MindSources(store, service, () => chrona.dependencies["files"], (target, args, options) => chrona.call(target as Parameters<typeof chrona.call>[0], args, options));
const wakeups = new MindWakeups(store, (target, args, options) => applicationCall(target, args, options));
let pagesReady = false, registering = false;
async function registerPages() {
  if (pagesReady || registering) return;
  registering = true;
  try {
    for (const page of [MAIN_PAGE, SETTINGS_PAGE]) {
      const result = await chrona.call({ moduleId: chrona.dependencies["web"]!, tool: "page-set" }, page);
      if (result && typeof result === "object" && "error" in result) throw new Error("Web rejected a Mind page");
    }
    pagesReady = true;
  } catch { console.error(JSON.stringify({ component: "mind", event: "page_registration_unavailable" })); }
  finally { registering = false; }
}
async function background() {
  try { await runtime.tick(undefined, false, true); }
  catch { console.error(JSON.stringify({ component: "mind", event: "check_failed", message: "Inspect the private state and runtime error; state was not reset" })); }
}
function codedError(error: unknown): never {
  if (error instanceof ModelError) throw error;
  if (error instanceof z.ZodError) throw new ModelError("invalid", "Invalid Mind input or output");
  if (error instanceof Error && "code" in error && typeof error.code === "string" && ["invalid", "forbidden", "conflict", "capacity"].includes(error.code)) throw new ModelError(error.code, error.message);
  throw error;
}
on("activated", async () => { pagesReady = false; await registerPages(); await wakeups.sync(); return {}; });
on("timer", async event => {
  if (event.id !== REVIEW_TIMER) throw new ModelError("invalid", "Unknown Mind timer");
  await sources.poll(event.now);
  return { result: await runtime.tick(event.now) };
});
on("tool", async event => {
  try {
    if (!Object.hasOwn(inputs, event.id)) throw new ModelError("invalid", "Unknown Mind tool");
    const name = event.id as Tool;
    // These exact routes have owner-only manifest visibility. Kernel admission already
    // checked the current approved caller; preserve its identity for receipt scopes.
    const admittedOwner = ["ui-agenda", "ui-dismiss", "decisions", "note", "check", "ui-settings", "ui-sources"].includes(name)
      && (event.caller?.kind === "owner" || event.caller?.kind === "module");
    if (name === "ui-sources") {
      if (!admittedOwner) throw new ModelError("forbidden", "Source settings require an admitted owner");
      return { result: outputs[name].parse(await sources.configure(event.args)) };
    }
    let result = await service.tool(name, event.args, event.caller, event.now, admittedOwner);
    if (name === "check") result = await runtime.tick(event.now, true);
    if (name === "ui-settings" && Object.keys(event.args).length) await wakeups.sync(event.args.enabled === true);
    return { result: outputs[name].parse(result) };
  } catch (error) { codedError(error); }
});
const timer = setInterval(() => { void background(); }, 30_000);
async function maintain() {
  await registerPages();
  await wakeups.sync().catch(() => { console.error(JSON.stringify({ component: "mind", event: "wakeup_unavailable" })); });
}
const pageTimer = setInterval(() => { void maintain(); }, 60_000);
onDisconnect(() => { clearInterval(timer); clearInterval(pageTimer); });
void background();
void wakeups.sync().catch(() => { console.error(JSON.stringify({ component: "mind", event: "wakeup_unavailable" })); });
