import { chrona, on, onDisconnect, ModelError, type CallTarget } from "chrona";
import { createPiProvider, PI_MODEL_ENVIRONMENT_KEYS, type PiProviderOptions } from "@chrona/pi";
import { createPiApplication, publicError } from "./application";
import { createBrowsers } from "./browser";

function hostObject(name: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(process.env[name] ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new Error("Pi host configuration is invalid"); }
}
const options: PiProviderOptions = { chronaExtension: "", agentUrl: "", ...hostObject("CHRONA_PROVIDER_CONFIGURATION") };
const environment = hostObject("CHRONA_PROVIDER_MODEL_ENV");
for (const key of PI_MODEL_ENVIRONMENT_KEYS) {
  const value = environment[key];
  if (typeof value === "string") process.env[key] = value;
}
delete process.env.CHRONA_PROVIDER_MODEL_ENV;
delete process.env.CHRONA_PROVIDER_CONFIGURATION;
function target(value: string): CallTarget {
  if (/^(agent|runtime-callback)\./.test(value)) return value as CallTarget;
  const boundary = value.indexOf("."), moduleId = chrona.dependencies[value.slice(0, boundary)];
  if (!moduleId) throw new Error("Pi application dependency unavailable");
  return { moduleId, tool: value.slice(boundary + 1) };
}
const application = createPiApplication({ data: chrona.paths.data, options: { ...options, browsers: createBrowsers({ configured: process.env.CHRONA_STEWARD_BROWSER }) },
  createProvider: createPiProvider, call: (value, args) => chrona.call(target(value), args),
});
on("activated", () => application.activate());
on("tool", async event => {
  try { return { result: await application.handle(event.id, event.args, event.caller, event.call?.id) }; }
  catch (error) { const safe = publicError(error); throw new ModelError(safe.code, safe.message); }
});
setInterval(() => void application.refreshSettings(), 60_000).unref();
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  void application.stop().then(() => process.exit(0), () => process.exit(1));
}
onDisconnect(stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
