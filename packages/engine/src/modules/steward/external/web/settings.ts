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

const state = (path: string) => ({ $state: path });
const bind = (path: string) => ({ $bindState: path });
const node = (type: string, props: Args, children: string[] = []) => ({ type, props, children });
export const WEB_SETTINGS_PAGE = {
  id: "settings", title: "Web 设置", purpose: "settings", layout: "document",
  data: { config: { tool: "ui-settings" }, preferences: { tool: "ui-preferences" } },
  spec: { root: "root", state: { saved: false, failed: false }, elements: {
    root: node("Stack", { gap: "lg" }, ["title", "description", "card", "preferences"]),
    title: node("Heading", { text: "Web 设置", level: "h1" }),
    description: node("Text", { text: "这些偏好只影响 Web 对话。MCP 和 QQ 在各自应用中设置。", variant: "muted" }),
    card: node("Card", { title: "对话记忆" }, ["provider", "hint", "recall", "retain", "save", "saved", "failed"]),
    provider: node("Input", { label: "记忆应用", name: "provider", placeholder: "留空关闭，例如 memory-local", value: bind("/config/provider") }),
    hint: node("Text", { text: "填写已安装的记忆应用名称；应用暂不可用时，已保存的偏好仍会保留。", variant: "muted" }),
    recall: node("Switch", { label: "自动回忆", name: "autoRecall", checked: bind("/config/autoRecall") }),
    retain: node("Switch", { label: "自动保留对话记忆", name: "autoRetain", checked: bind("/config/autoRetain") }),
    save: { ...node("Button", { label: "保存 Web 设置" }), on: { press: [
      { action: "setState", params: { statePath: "/saved", value: false } },
      { action: "setState", params: { statePath: "/failed", value: false } },
      { action: "call", params: { tool: "ui-settings", args: { provider: state("/config/provider"), "auto-recall": state("/config/autoRecall"), "auto-retain": state("/config/autoRetain") }, result: "/config", reload: false }, onSuccess: { set: { "/saved": true } }, onError: { set: { "/failed": true } } },
    ] } },
    saved: { ...node("Text", { text: "Web 设置已保存。" }), visible: { $state: "/saved" } },
    failed: { ...node("Text", { text: "保存未完成，请核对输入并重试。" }), visible: { $state: "/failed" } },
    preferences: node("Card", { title: "记忆应用保存的偏好" }, ["preferenceList"]),
    preferenceList: { ...node("Stack", { gap: "md" }, ["preferenceText", "forget"]), repeat: { statePath: "/preferences/items", key: "id" } },
    preferenceText: node("Text", { text: { $item: "text" } }),
    forget: { ...node("Button", { label: "删除这条偏好", variant: "secondary" }), on: { press: { action: "call", params: { tool: "ui-preferences", args: { forget: { $item: "id" } }, result: "/preferences", reload: false } } } },
  } },
};
