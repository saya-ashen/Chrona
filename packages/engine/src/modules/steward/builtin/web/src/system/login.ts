import type { Spec } from "@json-render/core";

export function loginSpec(message?: string): Spec {
  return { root: "login", elements: {
    login: { type: "Card", props: { title: "访问密钥" }, children: ["message", "form"] },
    message: { type: "Text", props: { text: message ?? "请输入 Chrona 的 API_KEY。它只保存在这个浏览器里。", variant: "muted" }, children: [] },
    form: { type: "LoginForm", props: {}, children: [] },
  } };
}
