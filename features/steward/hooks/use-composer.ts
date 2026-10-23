import { useState } from "react";
import type { ChatReply } from "@chrona/contracts";
import type { StewardClient } from "../model/client";
import { useStewardMutation } from "./use-steward-mutation";

export function useComposer(client: StewardClient, refresh: () => void | Promise<void>, onPendingChange?: (pending: boolean) => void, sessionId?: string, viewKey?: string, onSession?: (id: string) => void) {
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState("");
  const [exchange, setExchange] = useState<{ text: string; response: ChatReply; viewKey?: string } | null>(null);
  const mutation = useStewardMutation(refresh);
  async function send(value = text) {
    const input = value.trim();
    if (!input || mutation.pending) return;
    setAttempt(input);
    onPendingChange?.(true);
    try {
      const result = await mutation.run(() => client.chat({ text: input, ...(sessionId ? { sessionId } : {}) }));
      if (result.ok) { onSession?.(result.data.sessionId); setExchange({ text: input, response: result.data, viewKey }); setText(""); }
    } finally { onPendingChange?.(false); }
  }
  return { text, setText, exchange, ...mutation, send, retry: () => send(attempt) };
}
