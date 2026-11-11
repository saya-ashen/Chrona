import { THINKING_LEVELS } from "./configuration";

const state = (path: string) => ({ $state: path });
const bind = (path: string) => ({ $bindState: path });
const node = (type: string, props: Record<string, unknown>, children: string[] = []) => ({ type, props, children });
const status = (value: string) => ({ action: "setState", params: { statePath: "/saveStatus", value } });
const locked = { $cond: { $state: "/saveStatus", eq: "saving" }, $then: true, $else: false };
const thinkingLabels = { off: "关闭", minimal: "最少", low: "较少", medium: "中等", high: "较多", xhigh: "更多", max: "最多" };
const save = (args: Record<string, unknown>) => [status("saving"), {
  action: "call", params: { tool: "configure", args, result: "/policy", reload: false },
  onSuccess: status("saved"), onError: status("failed"),
}];

export const SETTINGS_PAGE = {
  id: "settings", title: "Pi 设置", layout: "document" as const, purpose: "settings" as const,
  data: { policy: { tool: "configure", args: { view: true } }, models: { tool: "models", args: {} } },
  spec: {
    root: "settings", state: { saveStatus: "", modelStatus: "" },
    elements: {
      settings: node("Stack", { gap: "lg" }, ["help", "loading", "invalid", "form", "saving", "saved", "failed"]),
      help: node("Text", { text: "选择 Pi 配置目录、模型和思考强度。留空可继承宿主和所选 Pi 配置。Pi 会继续加载该目录中的技能、扩展、提示模板和上下文。保存不会调用模型。" }),
      loading: { ...node("Text", { text: "正在读取 Pi 设置；若读取失败，请重新打开此页面。", variant: "muted" }), visible: { $state: "/policy", not: true } },
      invalid: { ...node("Alert", { title: "Pi 设置暂时不可用", message: "未取得有效的设置表单。请重新打开页面，检查配置目录和读取权限，并确认当前仍有所有者权限。", type: "error" }), visible: { $and: [state("/policy"), { $state: "/policy/form", not: true }] } },
      form: { ...node("Card", { title: "Pi 配置" }, ["effectiveProfile", "profileSource", "sourceHelp", "effectiveModel", "effectiveThinking", "warnings", "profile", "profileHelp", "model", "localModel", "refreshModels", "modelHelp", "modelFailed", "thinking", "scope", "save", "clear"]), visible: state("/policy/form") },
      effectiveProfile: node("Text", { text: { $template: "当前目录：${/policy/effective/profile}" } }),
      profileSource: node("Text", { text: { $template: "目录来源：${/policy/effective/profileSource}；状态：${/policy/effective/profileStatus}" }, variant: "muted" }),
      sourceHelp: node("Text", { text: "configuration 表示你在本应用明确选择；host.agentDir 表示宿主指定；env.PI_CODING_AGENT_DIR 表示服务环境；default.HOME/.pi/agent 表示当前服务用户的默认目录，可能与交互用户不同。", variant: "muted" }),
      effectiveModel: node("Text", { text: { $template: "当前模型：${/policy/effective/model}（来源：${/policy/effective/modelSource}）" } }),
      effectiveThinking: node("Text", { text: { $template: "当前思考强度：${/policy/effective/thinking}（来源：${/policy/effective/thinkingSource}）" } }),
      warnings: node("Text", { text: state("/policy/effective/warnings"), variant: "muted" }),
      profile: node("Input", { label: "配置目录（规范绝对路径）", name: "profile", value: bind("/policy/form/profile"), disabled: locked }),
      profileHelp: node("Text", { text: "填写已存在的目录，不使用符号链接。留空继承宿主、服务环境或服务用户的默认目录。", variant: "muted" }),
      model: node("Input", { label: "模型（提供方/模型 ID）", name: "model", value: bind("/policy/form/model"), disabled: locked }),
      localModel: node("Select", { label: "从当前已保存目录选择模型", name: "local-model", value: bind("/policy/form/model"), options: state("/models/options") }),
      refreshModels: { ...node("Button", { label: "刷新本地模型列表", disabled: locked }), on: { press: [{ action: "call", params: { tool: "models", args: {}, result: "/models", reload: false }, onSuccess: { action: "setState", params: { statePath: "/modelStatus", value: "loaded" } }, onError: { action: "setState", params: { statePath: "/modelStatus", value: "failed" } } }] } },
      modelHelp: node("Text", { text: "模型列表仅从已保存目录的 models.json 和 settings.json 读取 ID，不访问账号或联网验证。更换目录后请先保存，再刷新列表。也可直接填写模型 ID；留空表示继承。", variant: "muted" }),
      modelFailed: { ...node("Alert", { title: "本地模型列表读取失败", message: "请检查当前目录和读取权限后刷新。模型 ID 仍可手动填写。", type: "error" }), visible: { $state: "/modelStatus", eq: "failed" } },
      thinking: node("Select", { label: "思考强度", name: "thinking", value: bind("/policy/form/thinking"), options: [{ value: "", label: "继承所选 Pi 配置" }, ...THINKING_LEVELS.map(value => ({ value, label: thinkingLabels[value] }))] }),
      scope: node("Text", { text: "新建会话使用保存后的设置，已有和排队中的会话继续使用原设置。凭据由宿主或 Pi 配置管理，本页不读取或保存凭据。", variant: "muted" }),
      save: { ...node("Button", { label: "保存 Pi 设置", disabled: locked }), on: { press: save({ form: state("/policy/form"), view: true }) } },
      clear: { ...node("Button", { label: "恢复继承设置", disabled: locked }), on: { press: save({ clear: true, view: true }) } },
      saving: { ...node("Text", { text: "正在保存 Pi 设置…", variant: "muted" }), visible: { $state: "/saveStatus", eq: "saving" } },
      saved: { ...node("Alert", { title: "Pi 设置已保存", message: "新建会话将使用新设置，已有会话保留原设置。更换目录后可刷新本地模型列表。", type: "success" }), visible: { $state: "/saveStatus", eq: "saved" } },
      failed: { ...node("Alert", { title: "保存失败", message: "请检查目录是否为已存在的规范绝对路径、模型 ID 和思考强度，并确认当前调用仍有所有者权限。输入已保留，可修改后重试。", type: "error" }), visible: { $state: "/saveStatus", eq: "failed" } },
    },
  },
};

/** Web persists pages. Retry a rejected/unavailable registration until this activation succeeds. */
export function settingsRegistration(call: (target: string, args: Record<string, unknown>) => Promise<unknown>) {
  let active = false, registered = false, pending = false;
  async function refresh() {
    if (!active || registered || pending) return;
    pending = true;
    try {
      const result = await call("web.page-set", SETTINGS_PAGE);
      if (result && typeof result === "object" && "error" in result) throw new Error("Page registration rejected");
      registered = true;
    } catch { console.error("Pi 设置页面登记失败，稍后重试"); }
    finally { pending = false; }
  }
  return { async activate() { active = true; registered = false; await refresh(); }, refresh };
}
