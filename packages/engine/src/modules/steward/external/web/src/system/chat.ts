import type { Spec } from "@json-render/core";
import type { ReplyEvent, Subscribe } from "./adapter";
import { builder } from "./spec";

export type ChatSession = { id: string; title?: string | null; createdAt: string; source: string };
export type Message = { id: string; direction: string; text: string; attachments?: { name: string; ref?: string | null }[] };
export const chatData = { sessions: { tool: "sessions" } };
export function selectedSession(path: string, sessions: ChatSession[]) {
  const parts = path.split("/").filter(Boolean);
  return parts[0] === "sessions" && parts[1] ? decodeURIComponent(parts[1]) : path === "/chat/new" ? null : sessions[0]?.id ?? null;
}
export function chatSpec(state: Record<string, unknown>, path: string): Spec {
  const b = builder(), sessions = state.sessions as ChatSession[] | undefined;
  if (!sessions) return b.finish("会话", [b.text("加载中……", "muted")]);
  const current = selectedSession(path, sessions), building = sessions.find(session => session.id === current)?.source === "build";
  const list = b.node("Card", { title: "会话" }, [b.link("新会话", "/chat/new"), b.list(sessions.map(session => b.node("Link", {
    href: `/sessions/${encodeURIComponent(session.id)}`, current: session.id === current,
    ...(session.title !== null && session.title !== undefined ? { label: session.title } : {}),
  }, session.title === null || session.title === undefined ? [b.time(session.createdAt)] : [])), "还没有会话。")]);
  const stream = b.node("Card", {}, [b.node("ChatStream", { session: current, building: !!building }, [], `chat-${current ?? "new"}`)]);
  const spec = b.finish("", []);
  spec.elements[spec.root] = { type: "Grid", props: { columns: 2 }, children: [list, stream] };
  return spec;
}

/** Subscribe before the initial read; reconcile buffered replies against persisted message ids. */
export function openMessages(session: string, subscribe: Subscribe, load: () => Promise<Message[]>, handlers: { show: (items: Message[]) => void; reply: () => void; fail: (error: Error) => void }) {
  const { show, reply, fail } = handlers;
  let stopped = false, loaded = false;
  const messages: Message[] = [], early: Message[] = [], shown = new Set<string>();
  const append = (message: Message) => { if (!shown.has(message.id)) { shown.add(message.id); messages.push(message); } };
  const unsubscribe = subscribe((event: ReplyEvent) => {
    if (stopped || event.type !== "reply" || event.session !== session || !event.message) return;
    try {
      const message: Message = { id: event.message, direction: "out", text: event.text ?? "", attachments: JSON.parse(event.attachments ?? "[]") };
      reply();
      if (loaded) { append(message); show([...messages]); } else early.push(message);
    } catch (error) { fail(error as Error); }
  });
  const ready = load().then(items => {
    if (stopped) return;
    items.forEach(append); early.forEach(append); loaded = true; show([...messages]);
  }).catch((error: Error) => { if (!stopped) fail(error); });
  return { ready, append: (message: Message) => { append(message); if (!stopped) show([...messages]); }, close: () => { stopped = true; unsubscribe(); } };
}
