import { useEffect, useState } from "react";
import { useStateStore } from "@json-render/react";
import { useAction } from "./action";
import { Time } from "../display";
type TranscriptItem = { kind: string; text: string; tool?: string; args?: string; error?: boolean };
export function Transcript({ session, open }: { session: string; open: boolean }) {
  const action = useAction(), [expanded, setExpanded] = useState(open), [items, setItems] = useState<TranscriptItem[] | null>(null);
  useEffect(() => {
    if (!expanded || items !== null) return;
    let stopped = false;
    void action.act(async () => { const result = await action.call("transcript", { id: session }) as TranscriptItem[]; if (!stopped) setItems(result); });
    return () => { stopped = true; };
  }, [expanded, session]);
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>过程</summary><div className="transcript">{action.error ? <p className="error">{action.error}</p> : items === null ? <p className="muted">加载中……</p> : items.length ? items.map((item, i) => item.kind === "text" ? <p key={i}>{item.text}</p> : item.kind === "tool" ? <p key={i} className="muted">▶ <code>{item.tool}</code> {item.args}</p> : <pre key={i} className={item.error ? "error" : undefined}>{item.text || "（无输出）"}</pre>) : <p className="muted">还没有过程记录。</p>}</div></details>;
}
export function SessionWork({ props }: { props: { session: { id: string; createdAt: string; status: string }; open: boolean } }) {
  return <div id={`session-${props.session.id}`}><Time value={props.session.createdAt} /> · {props.session.status === "active" ? "进行中" : "已结束"} <Transcript session={props.session.id} open={props.open} /></div>;
}
export function DiagnosticRefresh({ props }: { props: { id: string } }) {
  const action = useAction(), store = useStateStore();
  return <button type="button" disabled={action.pending || !store.get("/diagnostics")} onClick={() => void action.act(async () => {
    store.set("/diagnostics", undefined);
    store.set("/diagnostics", await action.call("diagnostics", { id: props.id }));
  })}>刷新诊断</button>;
}
type MemoryState = { provider?: string; available: boolean; autoRecall: boolean; autoRetain: boolean; last24h: { retained: number; recalled: number; forgotten: number } };
type MemoryItem = { id: string; content: string; at?: string };
function memoryText(state: MemoryState) {
  return `${state.provider ? `提供者 ${state.provider}${state.available ? "" : "（不可用）"}` : "未启用"} · 自动检索${state.autoRecall ? "开" : "关"} · 自动写入${state.autoRetain ? "开" : "关"} · 24 小时内写入 ${state.last24h.retained}、检索 ${state.last24h.recalled}、删除 ${state.last24h.forgotten}`;
}
export function MemoryPanel() {
  const action = useAction(), [state, setState] = useState<MemoryState | null>(null), [items, setItems] = useState<MemoryItem[]>([]), [note, setNote] = useState("");
  useEffect(() => { let stopped = false; void action.call("memory", {}).then(result => { if (!stopped) setState(result as MemoryState); }).catch(() => {}); return () => { stopped = true; }; }, []);
  return <section><h2>记忆</h2><p className="muted">{state ? memoryText(state) : "状态读取失败"}</p>
    <form onSubmit={event => {
      event.preventDefault(); const query = String(new FormData(event.currentTarget).get("query")); setNote("检索中……"); setItems([]);
      void action.act(async () => { const result = await action.call("memory", { query }) as { items: MemoryItem[] }; setItems(result.items); setNote(result.items.length ? "" : "没有找到。只用全文检索时请换关键词试试。"); });
    }}><div className="row"><input name="query" required placeholder="关键词" /><button className="primary" disabled={action.pending}>检索</button></div></form><p role="status" className={action.error ? "error" : "muted"}>{action.error || note}</p>
    <ul className="plain">{items.map(item => <li key={item.id}>{item.content} {item.at ? <Time value={item.at} /> : null} <button type="button" disabled={action.pending} onClick={() => {
      if (!globalThis.confirm("删除这条记忆？")) return;
      void action.act(async () => { await action.call("forget", { id: item.id }); setItems(current => current.filter(row => row.id !== item.id)); });
    }}>删除</button></li>)}</ul></section>;
}
