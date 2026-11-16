import { javascript } from "./settings-bundle.js";
import { memoryForget, memoryPreferences } from "./memory";
import type { createPreferences } from "./settings-store";

type Args = Record<string, unknown>;
type Call = (target: string, args?: Args) => Promise<unknown>;
const invalid = () => Object.assign(new Error("设置参数无效"), { code: "invalid" });
const object = (value: unknown): value is Args => !!value && typeof value === "object" && !Array.isArray(value);
const hardCaps = new Set(["maxCallsPerEvent", "maxOutputTokens", "dailyCalls", "eventTimeoutMs", "moduleDailyCalls"]);

/** Global Settings reads and writes kernel governance only. Applications own their pages and saves. */
export async function settingsView(call: Call) {
  const kernel = await call("settings.get") as Args;
  const usage = await call("activity.usage", { limit: 100 }) as { items: unknown[] };
  return { settings: { timezone: kernel.timezone, runTimeoutMinutes: kernel.runTimeoutMinutes, moduleModel: kernel.moduleModel, wake: kernel.wake, modelUsage: usage.items } };
}
export async function updateSettings(call: Call, body: unknown) {
  if (!object(body) || Object.entries(body).some(([key, value]) => key === "timezone" ? typeof value !== "string"
    : key === "runTimeoutMinutes" ? value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 525600)
    : key === "moduleModel" ? value !== null && (!object(value) || Object.keys(value).some(field => !hardCaps.has(field))) : true)) throw invalid();
  if (Object.keys(body).length) await call("settings.update", body);
  return settingsView(call);
}

/** Form adaptation stays inside Web and touches only Web's private preferences. */
export async function webSettings(call: Call, preferences: ReturnType<typeof createPreferences>, args: Args) {
  if (Object.keys(args).some(key => !["provider", "auto-recall", "auto-retain"].includes(key))) throw invalid();
  if (Object.keys(args).length) {
    if (typeof args.provider !== "string" || typeof args["auto-recall"] !== "boolean" || typeof args["auto-retain"] !== "boolean") throw invalid();
    await preferences.update({ provider: args.provider.trim() || null, autoRecall: args["auto-recall"], autoRetain: args["auto-retain"] });
  }
  const config = await preferences.read();
  return { ...config, provider: config.provider ?? "" };
}
/** Provider-owned data is loaded independently; its failure cannot disguise a successful local save. */
export async function webPreferences(call: Call, args: Args) {
  if (Object.keys(args).some(key => key !== "forget")) throw invalid();
  if (Object.hasOwn(args, "forget")) {
    if (typeof args.forget !== "string" || !args.forget) throw invalid();
    await memoryForget(call, "web", args.forget);
  }
  return { items: await memoryPreferences(call, "web") };
}

export const WEB_SETTINGS_PAGE = {
  id: "settings", title: "Web 设置", purpose: "settings", layout: "document", tools: ["ui-settings", "ui-preferences"], props: { preferences: true },
  javascript,
};
