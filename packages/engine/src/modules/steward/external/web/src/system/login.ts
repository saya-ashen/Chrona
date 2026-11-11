import type { Spec } from "@json-render/core";

export type LoginMode = "login" | "setup" | "bootstrap" | "error";
export function loginSpec(message?: string, mode: LoginMode = "login"): Spec {
  const descriptions = {
    login: "请输入登录密码。",
    setup: "首次使用，请设置登录密码。此后使用密码登录。",
    bootstrap: "设置首个密码需要原访问授权。可输入已有的访问密钥以完成首次设置；仅用于这次授权。",
    error: "无法读取登录状态，请重试。",
  };
  return { root: "login", elements: {
    login: { type: "Card", props: { title: mode === "setup" || mode === "bootstrap" ? "设置登录密码" : "登录" }, children: ["message", "form"] },
    message: { type: "Text", props: { text: message ?? descriptions[mode], variant: mode === "error" ? "default" : "muted" }, children: [] },
    form: { type: "LoginForm", props: { mode }, children: [] },
  } };
}
