import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ComponentRenderProps } from "@json-render/react";
import { Time } from "../display";
import type { Approval as ApprovalData, Interaction } from "./today";

type Args = Record<string, unknown>;
export const SystemContext = createContext<{ call: (tool: string, args: Args) => Promise<unknown>; refresh: () => void } | null>(null);
function useAction() {
  const context = useContext(SystemContext)!;
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false);
  const act = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { await work(); } catch (error) { setError((error as Error).message); }
    finally { busy.current = false; setPending(false); }
  };
  return { ...context, pending, error, act };
}
export function SystemAction({ props }: { props: { label: string; tool: string; args: Args; confirm?: string } }) {
  const action = useAction();
  return <div><button type="button" disabled={action.pending} onClick={() => {
    if (props.confirm && !globalThis.confirm(props.confirm)) return;
    void action.act(async () => { await action.call(props.tool, props.args); action.refresh(); });
  }}>{props.label}</button>{action.error ? <p role="alert" className="error">{action.error}</p> : null}</div>;
}
export function Approval({ props: { approval } }: { props: { approval: ApprovalData } }) {
  const action = useAction(), [result, setResult] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const decide = (decision: string) => void action.act(async () => {
    const resolved = await action.call("resolve", { id: approval.id, decision }) as { status: string };
    let running = "";
    if (approval.moduleId && decision === "approve") {
      try {
        const apps = await action.call("modules", {}) as { id: string; name: string; activeHash?: string }[];
        const app = apps.find(item => item.id === approval.moduleId);
        if (app) running = ` · ${app.name} 当前版本 ${String(app.activeHash ?? "").slice(0, 8)}`;
      } catch { running = " · 当前版本读取失败，请刷新查看"; }
    }
    setResult(`${resolved.status === "denied" ? "已拒绝" : "已批准"}：${approval.title}${running}`);
    timer.current = setTimeout(action.refresh, 4000);
  });
  if (result) return <div role="status" className="ok">{result}</div>;
  return <div className="approval"><div><strong>{approval.title}</strong> <Time value={approval.createdAt} /></div>
    {approval.detail ? <div>{approval.detail}</div> : null}
    {approval.preview ? <details><summary>详情</summary><pre>{approval.preview}</pre></details> : null}
    <div className="row"><button type="button" className="primary" disabled={action.pending} onClick={() => decide("approve")}>批准</button><button type="button" disabled={action.pending} onClick={() => decide("deny")}>拒绝</button></div>
    {action.error ? <p role="alert" className="error">未处理：{action.error}</p> : null}</div>;
}
export function Question({ props: { interaction } }: { props: { interaction: Interaction } }) {
  const action = useAction(), { question } = interaction;
  const [value, setValue] = useState(question.prefill ?? "");
  const send = (answer: Args) => void action.act(async () => { await action.call("answer", { id: interaction.id, answer }); action.refresh(); });
  const submit = (value: unknown) => send({ decision: "submit", value });
  const choices = question.method === "confirm" ? [<button key="yes" type="button" className="primary" disabled={action.pending} onClick={() => submit(true)}>是</button>, <button key="no" type="button" disabled={action.pending} onClick={() => submit(false)}>否</button>]
    : question.method === "select" ? (question.options ?? []).map((option, index) => <button key={index} type="button" disabled={action.pending} onClick={() => submit(index)}>{option}</button>)
    : [<button key="submit" type="button" className="primary" disabled={action.pending} onClick={() => submit(value)}>提交</button>];
  return <div><div><strong>{question.title}</strong> <Time value={interaction.expiresAt} /> 前</div>{question.message ? <div>{question.message}</div> : null}
    {question.method === "editor" ? <textarea aria-label={question.title} rows={6} value={value} onChange={event => setValue(event.target.value)} /> : null}
    {question.method === "input" ? <input aria-label={question.title} type="text" value={value} onChange={event => setValue(event.target.value)} /> : null}
    <div className="row">{choices}<button type="button" disabled={action.pending} onClick={() => send({ decision: "cancel" })}>不回答</button></div>
    {action.error ? <p role="alert" className="error">{action.error}</p> : null}</div>;
}
export function LoginForm() {
  const action = useAction(), [key, setKey] = useState("");
  return <form onSubmit={event => { event.preventDefault(); void action.act(async () => { await action.call("login", { key }); }); }}>
    <div className="row"><input aria-label="访问密钥" name="key" type="password" autoComplete="current-password" required value={key} onChange={event => setKey(event.target.value)} /><button className="primary" disabled={action.pending}>保存</button></div>
    {action.error ? <p role="alert" className="error">{action.error}</p> : null}</form>;
}
function component<P>(Render: (value: { props: P }) => ReactNode) {
  return ({ element }: ComponentRenderProps<P>) => <Render props={element.props} />;
}
export const systemComponents = { Approval: component(Approval), Question: component(Question), SystemAction: component(SystemAction), LoginForm };
