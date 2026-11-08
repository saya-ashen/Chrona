import { memoryView } from "./memory";

type Args = Record<string, unknown>;
type Call = (target: string, args?: Args) => Promise<unknown>;
const invalid = () => Object.assign(new Error("设置参数无效"), { code: "invalid" });
const object = (value: unknown): value is Args => !!value && typeof value === "object" && !Array.isArray(value);

/** The UI projection stays private to Web; each owner supplies its own settings. */
export async function settingsView(call: Call) {
  const [kernel, builds, notifications, memory, status, grants, schedules, secrets] = await Promise.all([
    call("settings.get"), call("modules.build-settings"), call("notify.settings"), memoryView(call, "web"), call("notify.status"),
    call("approvals.grants"), call("schedules.list"), call("secrets.list"),
  ]) as [Args, Args, { settings: unknown }, { provider: string | null }, { chat: unknown }, unknown, unknown, unknown];
  const preferences = memory.provider ? await call(`${memory.provider}.preferences`) : [];
  return { settings: { ...kernel, ...builds, notifications: notifications.settings, memory, chat: status.chat }, grants, preferences, schedules, secrets };
}

function memoryValues(value: unknown) {
  if (!object(value) || Object.keys(value).some(key => !["provider", "autoRecall", "autoRetain"].includes(key))
    || (Object.hasOwn(value, "provider") && value.provider !== null && typeof value.provider !== "string")
    || ["autoRecall", "autoRetain"].some(key => Object.hasOwn(value, key) && typeof value[key] !== "boolean")) throw invalid();
  const names: Record<string, string> = { provider: "memory-provider", autoRecall: "memory-auto-recall", autoRetain: "memory-auto-retain" };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [names[key]!, key === "provider" && item === null ? "" : item]));
}
export async function updateSettings(call: Call, body: unknown) {
  const shapes: Record<string, (value: unknown) => boolean> = { timezone: value => typeof value === "string", moduleModel: value => value === null || object(value), builds: object, notifications: object, memory: object };
  if (!object(body) || Object.entries(body).some(([key, value]) => !shapes[key]?.(value))) throw invalid();
  const memory = Object.hasOwn(body, "memory") ? memoryValues(body.memory) : undefined;
  const kernel = Object.fromEntries(Object.entries(body).filter(([key]) => key === "timezone" || key === "moduleModel"));
  if (Object.keys(kernel).length) await call("settings.update", { settings: JSON.stringify(kernel) });
  if (Object.hasOwn(body, "builds")) await call("modules.build-settings", { limits: body.builds });
  if (Object.hasOwn(body, "notifications")) {
    const result = await call("notify.settings", { settings: JSON.stringify(body.notifications) }) as { error?: string; message?: string };
    if (result.error) throw Object.assign(new Error(result.message ?? result.error), { code: result.error });
  }
  if (memory) await call("modules.settings-set", { module: "web", values: JSON.stringify(memory) });
  return settingsView(call);
}
