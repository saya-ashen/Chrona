import { useState } from "react";
import { useAction } from "./action";
import { Time } from "../display";
import type { Permissions, Secret } from "./detail-types";
function RemoveField({ secret, field }: { secret: string; field?: string }) {
  const action = useAction();
  return <span><button type="button" disabled={action.pending} onClick={() => {
    if (!globalThis.confirm(field ? `删除 ${secret} 的 ${field}？` : `删除整份凭据 ${secret}？`)) return;
    void action.act(async () => { await action.call("secret-remove", { id: secret, field }); action.refresh(); });
  }}>{field ? "删除" : "全部删除"}</button>{action.error ? <span role="alert" className="error">{action.error}</span> : null}</span>;
}
const acceptsExtra = (secret: Secret) => !!secret.extraFields || !secret.fields.length;
function SecretForm({ secret }: { secret: Secret }) {
  const action = useAction(), [pairs, setPairs] = useState(acceptsExtra(secret) ? 1 : 0), [message, setMessage] = useState("");
  const extra = secret.extraFields, keys = extra ? extra.saved : secret.savedFields ?? [];
  return <form onSubmit={event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const entries = secret.fields.map(field => [field.name, String(data.get(field.name) ?? "")]);
    for (let i = 0; i < pairs; i++) entries.push([String(data.get(`field-${i}`)).trim(), String(data.get(`value-${i}`))]);
    const value = Object.fromEntries(entries.filter(([field, text]) => field && text));
    if (!Object.keys(value).length) { setMessage("没有要保存的字段"); return; }
    const missing = secret.fields.filter(field => !field.optional && !field.saved && !value[field.name]).map(field => field.label);
    if (missing.length && !globalThis.confirm(`还缺 ${missing.join("、")}，仍然保存？`)) return;
    const form = event.currentTarget;
    void action.act(async () => { await action.call("secret-save", { id: secret.name, value }); form.reset(); setMessage("已保存。"); action.refresh(); });
  }}>{secret.fields.map(field => <div className="row" key={field.name}><label>{field.label} <input name={field.name} type={field.plain ? "text" : "password"} autoComplete={field.plain ? "off" : "new-password"} placeholder={field.saved ? "已设置，留空不改" : field.optional ? "可选" : "必填"} /></label><span className={field.saved || field.optional ? "muted" : "error"}>{field.saved ? "已设置" : field.optional ? "可选" : "未设置"}</span>{field.saved ? <RemoveField secret={secret.name} field={field.name} /> : null}{field.description ? <span className="muted">{field.description}</span> : null}</div>)}
    {keys.length ? <ul className="plain">{keys.map(key => <li key={key}><code>{key}</code> <span className="muted">已设置</span> <RemoveField secret={secret.name} field={key} /></li>)}</ul> : null}
    {extra?.description ? <p className="muted">{extra.description}</p> : null}
    {Array.from({ length: pairs }, (_, i) => <div className="row" key={i}><input name={`field-${i}`} placeholder={extra ? extra.label : "字段名，如 apiKey"} autoComplete="off" /><input name={`value-${i}`} type="password" placeholder={extra ? extra.valueLabel : "值"} autoComplete="new-password" /></div>)}
    <div className="row">{acceptsExtra(secret) ? <button type="button" onClick={() => setPairs(value => value + 1)}>{extra ? `再加一个${extra.label}` : "加一个字段"}</button> : null}<button className="primary" disabled={action.pending}>保存</button><span role="status" className={action.error ? "error" : "muted"}>{action.error || message}</span></div></form>;
}
function OAuthPanel({ secret }: { secret: Secret }) {
  const action = useAction(), [account, setAccount] = useState(""), [result, setResult] = useState<{ url: string; redirectUri: string } | null>(null);
  const oauth = secret.oauth!, ready = secret.fields.find(field => field.name === "clientId")?.saved;
  const authorize = (who: string) => void action.act(async () => {
    const result = await action.call("authorize", { id: secret.name, value: { provider: oauth.provider, scopes: oauth.scopes.join(" "), ...(who ? { account: who } : {}) } }) as { url: string; redirectUri: string };
    setResult(result); window.open(result.url, "_blank", "noopener");
  });
  return <div><h4>授权（{oauth.provider === "google" ? "Google" : "Microsoft"}）</h4><p className="muted">范围：{oauth.scopes.join(" ")}</p>
    {oauth.authorized.length ? <ul className="plain">{oauth.authorized.map(who => <li key={who}>{who || "默认账户"} <span className="muted">已授权</span> <button type="button" disabled={action.pending} onClick={() => authorize(who)}>重新授权</button> <RemoveField secret={secret.name} field={who ? `refreshToken_${who}` : "refreshToken"} /></li>)}</ul> : null}
    {ready ? <form onSubmit={event => { event.preventDefault(); authorize(oauth.accounts ? account.trim() : ""); }}><div className="row">{oauth.accounts ? <input aria-label="账户名" placeholder="账户名，如 work" autoComplete="off" pattern="[a-z][a-z0-9_]{0,29}" value={account} onChange={event => setAccount(event.target.value)} /> : null}<button className="primary" disabled={action.pending}>{oauth.accounts ? "授权新账户" : oauth.authorized.length ? "重新授权" : "授权"}</button></div></form> : <p className="muted">先保存 Client ID（和 Client secret），再授权。</p>}
    <div role="status">{result ? <>在应用里登记回调地址 {result.redirectUri}，然后 <a href={result.url} target="_blank" rel="noopener noreferrer">打开授权页</a>（10 分钟内有效）。完成后刷新本页。</> : null}{action.error ? <p className="error">{action.error}</p> : null}</div></div>;
}
function SecretHeader({ secret, shared }: { secret: Secret; shared: string[] }) {
  return <><strong>{secret.label ?? secret.name}</strong>{secret.label ? <span className="muted"> {secret.name}</span> : null} <span className={secret.configured ? "muted" : "error"}>{secret.configured ? "已设置" : "未设置"}{secret.configured && secret.updatedAt ? <> · <Time value={secret.updatedAt} /></> : null}</span>{shared.length ? <span className="muted"> · 与 {shared.join("、")} 共用</span> : null} {secret.configured && secret.name !== "qq_bot" ? <RemoveField secret={secret.name} /> : null}</>;
}
export function Credentials({ props }: { props: { permissions: Permissions; global?: { secrets?: { name: string; modules: string[] }[] } } }) {
  return <ul className="plain">{props.permissions.secrets.map(secret => {
    const shared = (props.global?.secrets?.find(row => row.name === secret.name)?.modules ?? []).filter(name => name !== props.permissions.module);
    return <li key={secret.name}><SecretHeader secret={secret} shared={shared} />
      {secret.description ? <p className="muted">{secret.description}</p> : null}{secret.name !== "qq_bot" ? <SecretForm secret={secret} /> : null}{secret.oauth ? <OAuthPanel secret={secret} /> : null}</li>;
  })}</ul>;
}
