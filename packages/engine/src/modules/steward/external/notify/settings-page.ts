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

const state = (path: string) => ({ $state: path });
const node = (type: string, props: Record<string, unknown>, children: string[] = []) => ({ type, props, children });
const status = (value: string) => ({ action: "setState", params: { statePath: "/saveStatus", value } });
const fields = [
  ["daily-cap", "每日主动通知上限（0–50）", "number"],
  ["timezone", "时区（例如 Asia/Shanghai）", "text"],
  ["digest-at", "每日摘要时间（HH:mm）", "text"],
  ["quiet-start", "免打扰开始（HH:mm）", "text"],
  ["quiet-end", "免打扰结束（HH:mm）", "text"],
];
export const SETTINGS_PAGE = {
  id: "settings", title: "通知设置", layout: "document", purpose: "settings",
  data: { policy: { tool: "ui-settings", args: {} } },
  spec: {
    root: "settings", state: { saveStatus: "" },
    elements: {
      settings: node("Stack", { gap: "lg" }, ["help", "form", "saved", "failed"]),
      help: node("Text", { text: "设置主动通知的每日上限、时区和摘要时间。免打扰可跨午夜；开始和结束都留空即可关闭。对你请求的回复不占主动通知额度。" }),
      form: { ...node("Card", { title: "通知偏好" }, [...fields.map(([name]) => name), "save"]), visible: state("/policy/form") },
      ...Object.fromEntries(fields.map(([name, label, type]) => [name, node("Input", { name, label, type, value: { $bindState: `/policy/form/${name}` } })])),
      save: { ...node("Button", { label: "保存通知设置", disabled: { $cond: { $state: "/saveStatus", eq: "saving" }, $then: true, $else: false } }), on: { press: [status("saving"), {
        action: "call", params: { tool: "ui-settings", args: { form: state("/policy/form") }, result: "/policy", reload: false }, onSuccess: status("saved"), onError: status("failed"),
      }] } },
      saved: { ...node("Alert", { title: "通知设置已保存", type: "success" }), visible: { $state: "/saveStatus", eq: "saved" } },
      failed: { ...node("Alert", { title: "保存失败", message: "请填写 0–50 的整数上限、有效时区和时间；免打扰开始与结束须同时填写或同时留空。请确认当前应用仍有所有者权限后重试。", type: "error" }), visible: { $state: "/saveStatus", eq: "failed" } },
    },
  },
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
    catch { console.error("通知设置页面登记失败，稍后重试"); }
    finally { pending = false; }
  }
  return { async activate() { active = true; registered = false; await refresh(); }, refresh };
}
