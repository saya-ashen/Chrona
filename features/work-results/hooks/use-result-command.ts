import { useState } from "react";
import { errorKind, resultRequest } from "../model/client";

type Command = { method: "submit" | "review"; input: unknown };
export function useResultCommand(onSaved: () => void) {
  const [pending, setPending] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorKind> | null>(null);
  async function send(command: Command) {
    setPending(command); setBusy(true); setError(null);
    try { await resultRequest(command.method, command.input); setPending(null); onSaved(); }
    catch (cause) { setError(errorKind(cause)); }
    finally { setBusy(false); }
  }
  return { pending, busy, error, send, retry: () => pending ? send(pending) : Promise.resolve(), clear: () => { setPending(null); setError(null); } };
}
