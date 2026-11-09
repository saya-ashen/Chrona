import { SETTINGS_TIERS } from "./model-policy";
import { THINKING_LEVELS } from "@chrona/contracts/steward";

const state = (path: string) => ({ $state: path });
const bind = (path: string) => ({ $bindState: path });
const node = (type: string, props: Record<string, unknown>, children: string[] = []) => ({ type, props, children });
const status = (value: string) => ({ action: "setState", params: { statePath: "/saveStatus", value } });
const labels = { fast: "快速", balanced: "均衡", deep: "深度" };
const thinkingLabels = { off: "关闭", minimal: "最少", low: "较少", medium: "中等", high: "较多", xhigh: "更多", max: "最多" };
const save = [status("saving"), {
  action: "call", params: { tool: "configure", args: { form: { tiers: state("/policy/form/tiers"), "preferred-timeout-ms": state("/policy/form/preferredTimeoutMs") }, view: true }, result: "/policy", reload: false },
  onSuccess: status("saved"), onError: status("failed"),
}];
export const SETTINGS_PAGE = {
  id: "settings", title: "Agent 设置", layout: "document", purpose: "settings",
  data: { policy: { tool: "configure", args: { view: true } } },
  spec: {
    root: "settings", state: { saveStatus: "" },
    elements: {
      settings: node("Stack", { gap: "lg" }, ["help", "form", "saved", "failed"]),
      help: node("Text", { text: "为快速、均衡、深度任务选择模型。模型填写为提供方/模型名称；留空表示停用该档。已有自定义档位会保留。" }),
      form: { ...node("Stack", { gap: "md" }, [...SETTINGS_TIERS, "timeout", "limits", "save"]), visible: state("/policy/form") },
      ...Object.fromEntries(SETTINGS_TIERS.flatMap(tier => [
        [tier, node("Card", { title: `${labels[tier]}（${tier}）` }, [`${tier}Model`, `${tier}Thinking`])],
        [`${tier}Model`, node("Input", { label: `${labels[tier]}模型`, name: `${tier}-model`, placeholder: "提供方/模型名称", value: bind(`/policy/form/tiers/${tier}/model`) })],
        [`${tier}Thinking`, node("Select", { label: `${labels[tier]}思考强度`, name: `${tier}-thinking`, value: bind(`/policy/form/tiers/${tier}/thinking`), options: [{ value: "", label: "模型默认" }, ...THINKING_LEVELS.map(value => ({ value, label: thinkingLabels[value] }))] })],
      ])),
      timeout: node("Input", { label: "首选超时（毫秒，1–600000）", name: "preferred-timeout-ms", type: "number", value: bind("/policy/form/preferredTimeoutMs") }),
      limits: node("Text", { text: "执行仍受内核预算和超时上限约束。保存不会启动模型。", variant: "muted" }),
      save: { ...node("Button", { label: "保存 Agent 设置", disabled: { $cond: { $state: "/saveStatus", eq: "saving" }, $then: true, $else: false } }), on: { press: save } },
      saved: { ...node("Alert", { title: "Agent 设置已保存", type: "success" }), visible: { $state: "/saveStatus", eq: "saved" } },
      failed: { ...node("Alert", { title: "保存失败", message: "请检查模型名称、思考强度和整数超时，并确认当前应用仍有所有者权限后重试。", type: "error" }), visible: { $state: "/saveStatus", eq: "failed" } },
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
    catch { console.error("Agent 设置页面登记失败，稍后重试"); }
    finally { pending = false; }
  }
  return { async activate() { active = true; registered = false; await refresh(); }, refresh };
}
