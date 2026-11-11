import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStateStore, type ComponentRenderProps } from "@json-render/react";
import type { ActivityPage } from "./activity";
import { ToolForm, ToolContract } from "./forms";
import { Credentials } from "./credentials";
import { DiagnosticRefresh, MemoryPanel, SessionWork } from "./detail-components";
import { Time } from "../display";
import type { Approval as ApprovalData, Interaction } from "./today";
import { useAction } from "./action";
import { NotificationSettings, ModuleModelSettings, RunTimeoutSettings } from "./settings-forms";
import { ChatStream } from "./chat-stream";
import { LoginForm, LoginPasswordSettings } from "./password-forms";

type Args = Record<string, unknown>;
export function SystemAction({ props }: { props: { label: string; tool: string; args: Args; confirm?: string } }) {
  const action = useAction(), [note, setNote] = useState("");
  return <div><button type="button" disabled={action.pending} onClick={() => {
    if (props.confirm && !globalThis.confirm(props.confirm)) return;
    void action.act(async () => {
      const result = await action.call(props.tool, props.args) as { status?: string } | null;
      setNote(result?.status === "pending_approval" ? "已申请，待你确认；尚未完成。请前往今天的待你决定。" : "已收到操作结果，正在刷新状态。");
      action.refresh();
    });
  }}>{action.pending ? "处理中……" : props.label}</button>{note ? <p role="status">{note}</p> : null}{action.error ? <p role="alert" className="error">{action.error}</p> : null}</div>;
}
export function AppRemoval({ props: { moduleId, name } }: { props: { moduleId: string; name: string } }) {
  const action = useAction(), [approvalId, setApprovalId] = useState(""), [approval, setApproval] = useState<ApprovalData | null>(null);
  return <div>
    {approvalId ? <div className="app-removal">
      <p>删除 {name} 及其数据、文件、日程和设置；删除前会自动备份。</p>
      {approval ? <Approval props={{ approval, destructive: true }} /> : <p role="status">删除申请已提交，尚未删除。请到<a href="/">今天的「待你决定」</a>批准或拒绝。</p>}
    </div> : <button type="button" className="danger" disabled={action.pending} onClick={() => void action.act(async () => {
      const result = await action.call("module-remove", { id: moduleId }) as { approvalId?: string };
      if (!result.approvalId) throw new Error("未收到删除申请，请刷新查看待你决定。");
      setApprovalId(result.approvalId);
      const today = await action.call("today", {}) as { approvals: ApprovalData[] };
      setApproval(today.approvals.find(item => item.id === result.approvalId) ?? null);
    })}>删除应用</button>}
    {action.error ? <p role="alert" className="error">{action.error}</p> : null}
  </div>;
}
export function Approval({ props: { approval, destructive = false } }: { props: { approval: ApprovalData; destructive?: boolean } }) {
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
    <div className="row"><button type="button" className={destructive ? "danger" : "primary"} disabled={action.pending} onClick={() => decide("approve")}>{destructive ? "确认删除" : "批准"}</button><button type="button" disabled={action.pending} onClick={() => decide("deny")}>拒绝</button></div>
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
export function ActivityMore({ props }: { props: { module: string } }) {
  const action = useAction(), store = useStateStore();
  return <div><button type="button" disabled={action.pending} onClick={() => void action.act(async () => {
    const current = store.get("/activity") as ActivityPage;
    const page = await action.call("activity", { module: props.module, before: current.before }) as ActivityPage;
    store.set("/activity", { items: [...current.items, ...page.items], before: page.before });
  })}>更早的</button>{action.error ? <p role="alert" className="error">{action.error}</p> : null}</div>;
}
function component<P>(Render: (value: { props: P }) => ReactNode) {
  return ({ element }: ComponentRenderProps<P>) => <Render props={element.props} />;
}
export const systemComponents = { AppRemoval: component(AppRemoval), ChatStream: component(ChatStream), NotificationSettings: component(NotificationSettings), ModuleModelSettings: component(ModuleModelSettings), RunTimeoutSettings: component(RunTimeoutSettings), Approval: component(Approval), Question: component(Question), SystemAction: component(SystemAction), ActivityMore: component(ActivityMore), LoginForm: component(LoginForm), LoginPasswordSettings,
  ToolForm: component(ToolForm), ToolContract: component(ToolContract), Credentials: component(Credentials), DiagnosticRefresh: component(DiagnosticRefresh), MemoryPanel, SessionWork: component(SessionWork) };
