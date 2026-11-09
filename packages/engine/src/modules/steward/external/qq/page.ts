const state = (path: string) => ({ $state: path });
const bind = (path: string) => ({ $bindState: path });

export const SETTINGS_PAGE = {
  id: "settings",
  purpose: "settings" as const,
  title: "QQ 设置",
  layout: "document" as const,
  data: { preferences: { tool: "ui-settings" } },
  spec: {
    root: "layout",
    state: { saveStatus: "" },
    elements: {
      layout: { type: "Stack", props: { gap: "md" }, children: ["intro", "form", "saved", "failed"] },
      intro: { type: "Text", props: { text: "设置仅用于 QQ 的会话记忆。留空记忆提供应用可关闭记忆。", variant: "muted" }, children: [] },
      form: { type: "Card", props: { title: "会话记忆" }, visible: state("/preferences"), children: ["fields"] },
      fields: { type: "Stack", props: { gap: "md" }, children: ["provider", "recall", "retain", "save"] },
      provider: { type: "Input", props: { label: "记忆提供应用", name: "provider", type: "text", placeholder: "例如 memory-local；留空关闭记忆", value: bind("/preferences/provider") }, children: [] },
      recall: { type: "Switch", props: { label: "自动回忆", name: "autoRecall", checked: bind("/preferences/autoRecall") }, children: [] },
      retain: { type: "Switch", props: { label: "自动保留记忆", name: "autoRetain", checked: bind("/preferences/autoRetain") }, children: [] },
      save: { type: "Button", props: { label: "保存设置" }, children: [], on: { press: [
        { action: "setState", params: { statePath: "/saveStatus", value: "" } },
        { action: "call", params: { tool: "ui-settings", args: { provider: state("/preferences/provider"), "auto-recall": state("/preferences/autoRecall"), "auto-retain": state("/preferences/autoRetain") }, result: "/preferences", reload: false },
          onSuccess: { set: { "/saveStatus": "saved" } }, onError: { set: { "/saveStatus": "error" } } },
      ] } },
      saved: { type: "Alert", props: { title: "设置已保存", type: "success" }, visible: { $state: "/saveStatus", eq: "saved" }, children: [] },
      failed: { type: "Alert", props: { title: "保存失败", message: "设置未保存，请检查输入后重试。", type: "error" }, visible: { $state: "/saveStatus", eq: "error" }, children: [] },
    },
  },
};
