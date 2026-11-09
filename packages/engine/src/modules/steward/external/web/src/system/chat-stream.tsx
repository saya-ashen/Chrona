import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Subscribe } from "./adapter";
import { openMessages, continueRequest, type Execution, type Message } from "./chat";
import { Transcript } from "./detail-components";
import { useAction } from "./action";

export const ChatHost = createContext<{ subscribe: Subscribe; navigate: (path: string, replace?: boolean) => void } | null>(null);
function Attachment({ message, file }: { message: string; file: { name: string; ref?: string | null } }) {
  const action = useAction();
  if (!file.ref || !message) return <span className="muted">{file.name}</span>;
  return <><a href="#" aria-disabled={action.pending} onClick={event => {
    event.preventDefault();
    void action.act(async () => {
      const blob = await action.call("file", { message, ref: file.ref }) as Blob, url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = file.name; link.click();
      // Revoking right after click() can cancel the download in Safari and Firefox.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }}>{file.name}</a>{action.error ? <span role="alert" className="error"> {action.error}</span> : null}</>;
}
export const historicalConversation = (session: string | null, building: boolean) => building || !!session && !session.startsWith("web-agent:");
function messageRequest(previous: { text: string; requestKey: string } | null, text: string) {
  return previous?.text === text ? previous : { text, requestKey: crypto.randomUUID() };
}
function Reply({ message }: { message: Message }) {
  const state = message.execution;
  if (!state || state.status === "finished") return <>{message.text}</>;
  return <><div className="chat-outcome" role={state.status === "cancelled" ? "status" : "alert"}>
    <strong>{state.status === "cancelled" ? "处理已停止" : "本次执行失败，尚未完成"}</strong>
    <p>{state.reason}</p>
  </div>{message.progress ? <div className="chat-progress"><small>已产生的过程文字（不代表完成）</small><p>{message.progress}</p></div> : null}</>;
}
function activeLabel(state: Execution) {
  if (state.status === "unknown") return "执行是否停止尚未确认，请等待状态更新；暂不能继续。";
  if (state.status === "queued") return "Chrona 正在排队……";
  if (state.phase === "recovering") return "Chrona 正在恢复处理，请等待；暂不能继续。";
  return "Chrona 正在处理……";
}
export function ChatStream({ props: { session, building } }: { props: { session: string | null; building: boolean } }) {
  const host = useContext(ChatHost)!, action = useAction();
  const [messages, setMessages] = useState<Message[]>([]), [loading, setLoading] = useState(!!session), [loadError, setLoadError] = useState("");
  const [execution, setExecution] = useState<Execution | null>(null), [executionReady, setExecutionReady] = useState(false), [executionError, setExecutionError] = useState("");
  const [text, setText] = useState(""), [status, setStatus] = useState("");
  const list = useRef<HTMLDivElement>(null), stream = useRef<ReturnType<typeof openMessages> | null>(null);
  const pendingMessage = useRef<{ text: string; requestKey: string } | null>(null);
  const readOnly = historicalConversation(session, building);
  const executionBlocked = action.pending || loading || !executionReady || !!executionError;
  useEffect(() => {
    if (!session) return;
    const opened = openMessages(session, host.subscribe, () => action.call("messages", { id: session }) as Promise<Message[]>, { show: items => { setMessages(items); setLoading(false); }, reply: () => setStatus(""), fail: error => { setLoadError(error.message); setLoading(false); } });
    stream.current = opened;
    return () => { opened.close(); stream.current = null; };
  }, [session, host]);
  useEffect(() => {
    if (!session || readOnly) return;
    let stopped = false, reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const current = await action.call("execution", { id: session }) as Execution | null;
        if (!stopped) { setExecution(current); setExecutionReady(true); setExecutionError(""); }
      } catch (error) { if (!stopped) setExecutionError((error as Error).message); }
      finally { reading = false; }
    };
    void read(); const timer = setInterval(() => { void read(); }, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [session, readOnly]);
  const readExecution = async () => {
    if (session) { setExecution(await action.call("execution", { id: session }) as Execution | null); setExecutionReady(true); setExecutionError(""); setStatus(""); }
  };
  const continueRun = () => {
    if (!session || !execution || (!execution.pendingContinuation && (!execution.canContinue || execution.active)) || executionBlocked) return;
    void action.act(async () => {
      // One explicit action per source run; the same identity survives reload and duplicate tabs.
      await action.call("continue", { id: session, ...(execution.pendingContinuation ?? continueRequest(execution.runId)) });
      await readExecution();
      const items = await action.call("messages", { id: session }) as Message[];
      for (const message of items) stream.current?.append(message);
    });
  };
  const reconcileMessage = () => {
    const pendingAdmission = execution?.pendingAdmission;
    if (!session || !pendingAdmission || executionBlocked) return;
    void action.act(async () => {
      await action.call("reconcile", { id: session, requestKey: pendingAdmission.requestKey });
      await readExecution();
      const items = await action.call("messages", { id: session }) as Message[];
      for (const message of items) stream.current?.append(message);
    });
  };
  const stopRun = () => {
    if (!execution?.active || execution.pendingAdmission || action.pending) return;
    void action.act(async () => { await action.call("cancel", { id: execution.runId }); setStatus("已请求停止，正在核对执行状态……"); await readExecution(); });
  };
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [messages]);
  const submit = () => {
    const value = text.trim();
    if (!value || action.pending || loading || readOnly) return;
    void action.act(async () => {
      setStatus("Chrona 正在处理……");
      pendingMessage.current = messageRequest(pendingMessage.current, value);
      const sent = await action.call("chat", { ...pendingMessage.current, ...(session ? { session } : {}) }) as { sessionId: string; messageId?: string };
      pendingMessage.current = null; setText("");
      await readExecution();
      const message = { id: sent.messageId ?? crypto.randomUUID(), direction: "in", text: value };
      if (stream.current) stream.current.append(message); else setMessages(current => [...current, message]);
      if (!session) host.navigate(`/sessions/${encodeURIComponent(sent.sessionId)}`, true);
    });
  };
  return <><div className="messages" ref={list} aria-label="消息">{loading ? <p className="muted">加载中……</p> : null}{loadError ? <p role="alert" className="error">{loadError}</p> : null}{messages.map(message => <div key={message.id} className={`bubble ${message.direction}`}>
    <Reply message={message} />{(message.attachments ?? []).map((file, index) => <div key={index}><Attachment message={message.id} file={file} /></div>)}
  </div>)}</div>{building ? <p className="muted">历史构建只供查看。自动模型创作暂不可用；可在模块目录中查找普通 author 模块的工具。</p> : null}
    {!readOnly && session ? <div className="chat-execution" aria-label="执行状态">
      {executionError ? <p role="alert" className="error">执行状态读取失败：{executionError}</p> : null}
      {!executionReady && !executionError ? <p role="status">正在核对执行状态……</p> : null}
      {execution?.pendingAdmission ? <><p role="status">消息请求是否受理尚未确认。请核对原请求，核对不会重复发送消息。</p><button type="button" disabled={executionBlocked} onClick={reconcileMessage}>核对消息请求</button></> : execution?.pendingContinuation ? <><p role="status">继续请求是否受理尚未确认。请核对原请求，核对不会重复创建处理。</p><button type="button" disabled={action.pending || !!executionError} onClick={continueRun}>核对继续请求</button></> : execution?.active ? <><p role="status">{activeLabel(execution)}</p><button type="button" disabled={action.pending || execution.status === "unknown"} onClick={stopRun}>停止处理</button></> : null}
      {execution?.replyPending ? <p role="status">执行状态已保存，正在读取回复，请等待。</p> : null}
      {execution?.canContinue ? <><p>上次处理未完成。继续时会保留原会话，先核对已完成的操作及结果。</p><button type="button" className="primary" disabled={executionBlocked} onClick={continueRun}>继续处理</button></> : null}
    </div> : null}
    {readOnly ? <p className="muted">历史会话只供查看。请从会话列表新建会话继续。</p> : <form onSubmit={event => { event.preventDefault(); submit(); }}><textarea aria-label="消息内容" name="text" rows={3} value={text} onChange={event => setText(event.target.value)} placeholder={session ? "说点什么……（Ctrl+Enter 发送）" : "新会话：说点什么……"} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <div className="row"><button className="primary" disabled={action.pending || loading}>发送</button><p role="status" className={action.error ? "error" : "muted"}>{action.error || (execution?.active ? "" : status)}</p></div>
    </form>}{session ? <Transcript session={session} open={false} /> : null}</>;
}
