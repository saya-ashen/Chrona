import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Textarea } from "@shared/ui";
import type { StewardClient } from "../model/client";

export function GeneratedPageFeedback({ client, affairId, path, readOnly }: { client: StewardClient; affairId: string; path: string; readOnly: boolean }) {
  const { messages } = useI18n();
  const c = messages.steward.generatedPage;
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "sent" | "error">("idle");
  if (readOnly) return null;
  const send = async () => {
    setStatus("pending");
    try { await client.uiEvent(affairId, { kind: "feedback", path, text: text.trim() }); setStatus("sent"); }
    catch { setStatus("error"); }
  };
  return <div className="mt-4 grid justify-items-start gap-2">
    {status === "sent" ? <p role="status" className="text-xs text-muted-foreground">{c.sent}</p> : <>
      <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{c.feedback}</Button>
      {expanded && <form className="grid w-full gap-2" onSubmit={event => { event.preventDefault(); void send(); }}>
        <Textarea aria-label={c.feedback} value={text} maxLength={2000} onChange={event => setText(event.target.value)} />
        <Button className="justify-self-start" size="sm" disabled={!text.trim() || status === "pending"}>{c.send}</Button>
        {status === "error" && <p role="alert">{c.failed}</p>}
      </form>}
    </>}
  </div>;
}
