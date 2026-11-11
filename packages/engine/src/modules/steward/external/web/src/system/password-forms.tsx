import { useState, type FormEvent } from "react";
import { useAction } from "./action";
import type { LoginMode } from "./login";

function passwordError(password: string, confirmation: string) {
  if (password.length < 10 || password.length > 256) return "密码长度应为 10–256 个字符。";
  if (password !== confirmation) return "两次输入的密码不一致。";
  return "";
}
function NewPasswordFields({ disabled }: { disabled: boolean }) {
  return <>
    <label>新密码<input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={256} disabled={disabled} /></label>
    <label>确认新密码<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={256} disabled={disabled} /></label>
    <p className="muted">请使用 10–256 个字符的密码。</p>
  </>;
}
export function LoginForm({ props: { mode = "login" } }: { props: { mode?: LoginMode } }) {
  const action = useAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void action.act(async () => {
      if (mode === "bootstrap") { await action.call("auth-status", { accessKey: String(values.get("accessKey") ?? "").trim() }); return; }
      const password = String(values.get("password") ?? "");
      if (mode === "setup") {
        const error = passwordError(password, String(values.get("confirmPassword") ?? ""));
        if (error) throw new Error(error);
      }
      await action.call(mode === "setup" ? "auth-setup" : "login", { password });
    });
  };
  if (mode === "error") return <div><button type="button" disabled={action.pending} onClick={() => void action.act(async () => { await action.call("auth-status", {}); })}>重新读取登录状态</button>{action.error ? <p role="alert" className="error">{action.error}</p> : null}</div>;
  return <form onSubmit={submit}>
    {mode === "bootstrap" ? <label>原访问密钥<input name="accessKey" type="password" autoComplete="off" required disabled={action.pending} /></label>
      : mode === "setup" ? <NewPasswordFields disabled={action.pending} />
      : <label>登录密码<input name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={action.pending} /></label>}
    <button className="primary" disabled={action.pending}>{action.pending ? "处理中……" : mode === "bootstrap" ? "验证原访问授权" : mode === "setup" ? "设置密码并登录" : "登录"}</button>
    {action.error ? <p role="alert" className="error">{action.error}</p> : null}
  </form>;
}
export function LoginPasswordSettings() {
  const action = useAction(), [message, setMessage] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget, values = new FormData(form);
    setMessage("");
    void action.act(async () => {
      const password = String(values.get("password") ?? "");
      const error = passwordError(password, String(values.get("confirmPassword") ?? ""));
      if (error) throw new Error(error);
      await action.call("auth-password", { currentPassword: String(values.get("currentPassword") ?? ""), password });
      form.reset();
      setMessage("登录密码已更新。其他浏览器的登录已失效，当前浏览器保持登录。");
    });
  };
  return <form onSubmit={submit}>
    <label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} disabled={action.pending} /></label>
    <NewPasswordFields disabled={action.pending} />
    <button className="primary" disabled={action.pending}>{action.pending ? "正在更新……" : "更新登录密码"}</button>
    {message ? <p role="status" className="ok">{message}</p> : null}
    {action.error ? <p role="alert" className="error">{action.error}</p> : null}
  </form>;
}
