import { javascript } from "./settings-bundle.js";
import type { Settings } from "./budget";

export function settingsForm(settings: Settings) {
  return { "daily-cap": String(settings.dailyCap), timezone: settings.timezone, "digest-at": settings.digestAt,
    "quiet-start": settings.quietHours?.start ?? "", "quiet-end": settings.quietHours?.end ?? "" };
}
/** Form controls send strings; the existing settings path validates the complete resulting policy. */
export function parseSettingsForm(raw: unknown): Settings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const form = raw as Record<string, unknown>;
  if (Object.keys(form).sort().join(",") !== "daily-cap,digest-at,quiet-end,quiet-start,timezone" || Object.values(form).some(value => typeof value !== "string")) return null;
  const values = form as Record<string, string>;
  if (!/^\d+$/.test(values["daily-cap"].trim())) return null;
  const start = values["quiet-start"].trim(), end = values["quiet-end"].trim();
  if (Boolean(start) !== Boolean(end)) return null;
  return { dailyCap: Number(values["daily-cap"]), timezone: values.timezone.trim(), digestAt: values["digest-at"].trim(), quietHours: start && end ? { start, end } : null };
}

export const SETTINGS_PAGE = {
  id: "settings", title: "通知设置", layout: "document", purpose: "settings", tools: ["ui-settings"],
  javascript,
};

/** Web persists registrations across restarts. Retry only until this activation is registered. */
export function settingsRegistration(call: (target: string, args: Record<string, unknown>) => Promise<unknown>) {
  let active = false, registered = false, pending = false;
  async function refresh() {
    if (!active || registered || pending) return;
    pending = true;
    try {
      const result = await call("web.page-set", SETTINGS_PAGE);
      if (result && typeof result === "object" && "error" in result) throw new Error("Page registration rejected");
      registered = true;
    }
    catch (error) { console.error(JSON.stringify({ component: "notify", event: "settings_registration_failed", error: String(error) })); }
    finally { pending = false; }
  }
  return { async activate() { active = true; registered = false; await refresh(); }, refresh };
}
