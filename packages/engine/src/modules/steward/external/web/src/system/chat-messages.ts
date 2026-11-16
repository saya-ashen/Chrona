import type { ReplyEvent, Subscribe } from "./adapter";

export type ChatSession = { id: string; title?: string | null; createdAt: string; source: string };
import type { Execution } from "./chat-execution";
export type { ApplicationDelivery, Execution } from "./chat-execution";
export const continueRequest = (runId: string) => ({ runId, requestKey: `web-continue:${runId}` });
export type Message = {
  id: string; direction: string; text: string; execution?: Execution; progress?: string;
  attachments?: { name: string; ref?: string | null }[] };
export function selectedSession(path: string, sessions: ChatSession[]) {
  const parts = path.split("/").filter(Boolean);
  return parts[0] === "sessions" && parts[1] ? decodeURIComponent(parts[1]) : path === "/chat/new" ? null : sessions[0]?.id ?? null;
}
/** Subscribe before the initial read; reconcile buffered replies against persisted message ids. */
export function openMessages(
  session: string, subscribe: Subscribe, load: () => Promise<Message[]>,
  handlers: { show: (items: Message[]) => void; reply: () => void; fail: (error: Error) => void }) {
  const { show, reply, fail } = handlers;
  let stopped = false, loaded = false, reading: Promise<void> | null = null;
  const messages: Message[] = [], early: Message[] = [];
  const append = (message: Message) => {
    const index = messages.findIndex(item => item.id === message.id);
    if (index >= 0) messages[index] = { ...messages[index], ...message };
    else messages.push(message);
  };
  const unsubscribe = subscribe((event: ReplyEvent) => {
    if (stopped || event.type !== "reply" || event.session !== session || !event.message) return;
    try {
      const message: Message = {
        id: event.message, direction: "out", text: event.text ?? "",
        attachments: JSON.parse(event.attachments ?? "[]"), ...(event.execution ? { execution: event.execution, progress: event.progress } : {}) };
      reply();
      if (!loaded || reading) early.push(message);
      if (loaded) { append(message); show([...messages]); }
    } catch (error) { fail(error as Error); }
  });
  const reload = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (reading) return reading;
    reading = load().then(items => {
      if (stopped) return;
      items.forEach(append); early.forEach(append); early.length = 0; loaded = true; show([...messages]);
    }).catch((error: Error) => { if (!stopped) fail(error); }).finally(() => { reading = null; });
    return reading;
  };
  const ready = reload();
  return {
    ready, reload,
    append: (message: Message) => { append(message); if (!stopped) show([...messages]); },
    close: () => { stopped = true; unsubscribe(); },
  };
}
