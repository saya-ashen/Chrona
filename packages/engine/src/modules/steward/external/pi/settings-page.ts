import { javascript } from "./settings-bundle.js";
export const SETTINGS_PAGE = {
  id: "settings", title: "Pi 设置", layout: "document", purpose: "settings", tools: ["configure", "models"],
  javascript,
};
/** Retry only until the current activation has registered successfully. */
export function settingsRegistration(call: (target: string, args: Record<string, unknown>) => Promise<unknown>) {
  let active = false, registered = false, pending = false;
  async function refresh() {
    if (!active || registered || pending) return;
    pending = true;
    try {
      const result = await call("web.page-set", SETTINGS_PAGE);
      if (result && typeof result === "object" && "error" in result) throw new Error("Page registration rejected");
      registered = true;
    } catch (error) { console.error(JSON.stringify({ component: "pi", event: "settings_registration_failed", error: String(error) })); }
    finally { pending = false; }
  }
  return { async activate() { active = true; registered = false; await refresh(); }, refresh };
}
