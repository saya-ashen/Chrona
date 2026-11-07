import type { StewardPorts } from "./ports";
import type { z } from "zod";
import type { callerSchema } from "@chrona/contracts/steward";
type Caller = z.infer<typeof callerSchema>;
type Context = { workspaceId: string; caller: Caller; run?: { moduleRunId?: string; eventKey?: string } };
type Origin = Context & { caller: Extract<Caller, { kind: "module" }> };
const calls = new WeakMap<StewardPorts["db"], Map<string, { origin: Origin; name: string; args: Record<string, unknown> }>>();
/** Only live routed deliveries can delegate the original caller's authority to the shipped Agent. */
export function retainAgentCaller(ports: StewardPorts, id: string, origin: Context, name: string, args: Record<string, unknown>) {
  if (origin.caller.kind !== "module") return () => {};
  let entries = calls.get(ports.db);
  if (!entries) { entries = new Map(); calls.set(ports.db, entries); }
  entries.set(id, { origin: { ...origin, caller: origin.caller }, name, args });
  return () => { entries!.delete(id); };
}
export function agentCaller(ports: StewardPorts, id: string) { return calls.get(ports.db)?.get(id); }
