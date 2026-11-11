import { bind, locked, mutation, mutationNotice, node, state } from "./ui";

const fields = [
  ["interval-minutes", "检查间隔（分钟）", "number"], ["daily-wakes", "每日主动处理上限", "number"],
  ["quiet-start", "免打扰开始（HH:mm）", "text"], ["quiet-end", "免打扰结束（HH:mm）", "text"],
  ["timezone", "时区（例如 Asia/Shanghai）", "text"],
] as const;
const outputName = (name: string) => name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
const args = Object.fromEntries(["enabled", ...fields.map(([name]) => name)].map(name => {
  const path = `/policy/${outputName(name)}`;
  return [name, name === "interval-minutes" || name === "daily-wakes" ? { $template: `\${${path}}` } : state(path)];
}));
const notices = mutationNotice("/saveStatus");

export const SETTINGS_PAGE = {
  id: "settings", title: "持续关注设置", layout: "document" as const, purpose: "settings" as const,
  data: { policy: { tool: "ui-settings", args: {} }, sources: { tool: "ui-sources", args: {} } },
  spec: {
    root: "settings", state: { saveStatus: "", sourceStatus: "" },
    elements: {
      settings: node("Stack", { gap: "lg" }, ["help", "unavailable", "form", "pending", "unknown", "saved", "sources"]),
      sources: node("Card", { title: "关注文档变化" }, ["sourceHelp", "sourceErrors", "sourcePaths", "sourceSave", "sourcePending", "sourceUnknown", "sourceSaved"]),
      sourceHelp: node("Text", { text: "填写 Files 中的文档路径，每行一份，最多四份。保存会替换当前来源；留空可停止读取。启用主动检查后定期查看变化，仅接受不超过 2000 字符的完整文本。" }),
      sourceErrors: { ...node("Text", { text: state("/sources/errors") }), visible: state("/sources/errors") },
      sourcePaths: node("Textarea", { label: "文档路径", name: "source-paths", value: bind("/sources/paths"), disabled: locked("/sourceStatus") }),
      sourceSave: { ...node("Button", { label: "替换关注文档", disabled: locked("/sourceStatus") }), on: { press: mutation("ui-sources", { paths: state("/sources/paths") }, "/sourceStatus", "/sources") } },
      sourcePending: mutationNotice("/sourceStatus").pending,
      sourceUnknown: mutationNotice("/sourceStatus").unknown,
      sourceSaved: { ...node("Alert", { title: "关注文档已更新", type: "success" }), visible: { $state: "/sourceStatus", eq: "saved" } },
      help: node("Text", { text: "设置检查频率、每日主动处理上限和免打扰时间。保存设置后，应用按自己的安排检查关注。" }),
      unavailable: { ...node("Text", { text: "正在读取设置；若读取失败，请重新打开设置页。", variant: "muted" }), visible: { $state: "/policy", not: true } },
      form: { ...node("Card", { title: "检查与打扰偏好" }, ["enabled", ...fields.map(([name]) => name), "quietHelp", "save"]), visible: state("/policy") },
      enabled: node("Switch", { label: "启用主动检查", name: "enabled", checked: bind("/policy/enabled") }),
      ...Object.fromEntries(fields.map(([name, label, type]) => [name, node("Input", { label, name, type, value: bind(`/policy/${outputName(name)}`), disabled: locked("/saveStatus") })])),
      quietHelp: node("Text", { text: "免打扰时间使用 HH:mm 格式，可跨午夜。检查间隔和每日上限由应用校验。", variant: "muted" }),
      save: { ...node("Button", { label: "保存关注设置", disabled: locked("/saveStatus") }), on: { press: mutation("ui-settings", args, "/saveStatus", "/policy") } },
      pending: notices.pending, unknown: notices.unknown,
      saved: { ...node("Alert", { title: "关注设置已保存", type: "success" }), visible: { $state: "/saveStatus", eq: "saved" } },
    },
  },
};
