import { Card } from "../ui";
import { LoginForm } from "./password-forms";
import type { LoginMode } from "./types";
export type { LoginMode } from "./types";
export function LoginPage({ message, mode = "login" }: { message?: string; mode?: LoginMode }) {
  const descriptions = {
    login: "请输入登录密码。",
    setup: "首次使用，请设置登录密码。此后使用密码登录。",
    bootstrap: "设置首个密码需要原访问授权。可输入已有的访问密钥以完成首次设置；仅用于这次授权。",
    error: "无法读取登录状态，请重试。",
  };
  return (
    <Card title={mode === "setup" || mode === "bootstrap" ? "设置登录密码" : "登录"}>
      <p className="muted">{message ?? descriptions[mode]}</p>
      <LoginForm props={{ mode }} />
    </Card>
  );
}
