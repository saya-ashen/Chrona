import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStewardSession } from "./use-steward-session";
import { useStewardResource } from "./use-steward";
import { useStewardMutation } from "./use-steward-mutation";

export function useChat() {
  const shared = useStewardSession();
  const [search, setSearch] = useSearchParams();
  const id = search.get("sessionId") ?? shared.sessionId;
  const client = shared.today.client;
  const sessions = useStewardResource(client.sessions, true, String(shared.revision));
  const history = useStewardResource(useCallback((signal?: AbortSignal) => id ? client.chatMessages(id, signal) : Promise.resolve({ items: [] }), [client, id]), true, String(shared.revision));
  const selected = useStewardResource(useCallback((signal?: AbortSignal) => id ? client.session(id, signal) : Promise.resolve(null), [client, id]), true, String(shared.revision));
  const [title, setTitle] = useState("");
  const refresh = () => { sessions.refresh(); selected.refresh(); shared.refresh(); };
  const mutation = useStewardMutation(refresh);
  const select = (sessionId: string) => { shared.setSessionId(sessionId); setSearch({ sessionId }); setTitle(""); };
  const create = async () => {
    const result = await mutation.run(() => client.newSession(`web:${crypto.randomUUID()}`));
    if (result.ok) select(result.data.id);
  };
  const rename = () => id && mutation.run(() => client.updateSession(id, { title: title.trim() }));
  const end = () => id && mutation.run(() => client.updateSession(id, { status: "ended" }));
  return { client, id, sessions, history, selected, title, setTitle, mutation, select, create, rename, end, setSessionId: shared.setSessionId };
}
