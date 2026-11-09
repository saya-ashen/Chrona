import type { CallOrigin } from "./module-call-types";
import type { StewardPorts } from "./ports";

// Host-private proof for the exact, independently admitted invocation only.
const entries = new WeakMap<CallOrigin, StewardPorts["db"]>();
export function isAgentContextEntry(ports: StewardPorts, origin: CallOrigin) {
  return entries.get(origin) === ports.db;
}
export async function withAgentContextEntry<T>(ports: StewardPorts, origin: CallOrigin, invoke: () => Promise<T>): Promise<T> {
  entries.set(origin, ports.db);
  try { return await invoke(); }
  finally { entries.delete(origin); }
}
