import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Subscribe } from "./adapter";
import { openMessages, type Message } from "./chat";
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
export function ChatStream({ props: { session, building } }: { props: { session: string | null; building: boolean } }) {
  const host = useContext(ChatHost)!, action = useAction();
  const [messages, setMessages] = useState<Message[]>([]), [loading, setLoading] = useState(!!session), [loadError, setLoadError] = useState("");
  const [text, setText] = useState(""), [status, setStatus] = useState("");
  const list = useRef<HTMLDivElement>(null), stream = useRef<ReturnType<typeof openMessages> | null>(null);
  useEffect(() => {
    if (!session) return;
    const opened = openMessages(session, host.subscribe, () => action.call("messages", { id: session }) as Promise<Message[]>, { show: items => { setMessages(items); setLoading(false); }, reply: () => setStatus(""), fail: error => { setLoadError(error.message); setLoading(false); } });
    stream.current = opened;
    return () => { opened.close(); stream.current = null; };
  }, [session, host]);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [messages]);
  const submit = () => {
    const value = text.trim();
    if (!value || action.pending || loading) return;
    if (building && !globalThis.confirm("停止当前构建，并保留已有文件按新需求继续？已提交的版本和审批不会撤回。")) return;
    void action.act(async () => {
      setStatus(building ? "正在修改需求……" : "Chrona 正在处理……");
      const sent = await action.call(building ? "revise-build" : "chat", building ? { id: session, requirements: value } : { text: value, ...(session ? { session } : {}) }) as { sessionId: string; messageId?: string };
      setText("");
      const message = { id: sent.messageId ?? crypto.randomUUID(), direction: "in", text: value };
      if (stream.current) stream.current.append(message); else setMessages(current => [...current, message]);
      if (building) setStatus("已按新需求继续构建。");
      if (!session) host.navigate(`/sessions/${encodeURIComponent(sent.sessionId)}`, true);
    });
  };
  return <><div className="messages" ref={list} aria-label="消息">{loading ? <p className="muted">加载中……</p> : null}{loadError ? <p role="alert" className="error">{loadError}</p> : null}{messages.map(message => <div key={message.id} className={`bubble ${message.direction}`}>
    {message.text}{(message.attachments ?? []).map((file, index) => <div key={index}><Attachment message={message.id} file={file} /></div>)}
  </div>)}</div>{building ? <p className="muted">可停止构建或修改需求；修改会先停止旧处理，保留已有文件后继续。已提交版本和审批不会撤回；结果仍发回原对话。</p> : null}
    <form onSubmit={event => { event.preventDefault(); submit(); }}><textarea aria-label="消息内容" name="text" rows={3} value={text} onChange={event => setText(event.target.value)} placeholder={building ? "补充或修改构建需求……" : session ? "说点什么……（Ctrl+Enter 发送）" : "新会话：说点什么……"} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <div className="row"><button className="primary" disabled={action.pending || loading}>{building ? "修改需求并继续" : "发送"}</button>{building ? <button type="button" disabled={action.pending} onClick={() => {
        if (!globalThis.confirm("停止构建？已有文件保留，已提交的版本和审批不会撤回。")) return;
        void action.act(async () => { await action.call("stop-build", { id: session }); setStatus("构建已停止，可修改需求后继续。"); });
      }}>停止构建</button> : null}<p role="status" className={action.error ? "error" : "muted"}>{action.error || status}</p></div>
    </form>{session ? <Transcript session={session} open={building} /> : null}</>;
}
