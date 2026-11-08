import { z } from "zod";
import type { StewardPorts } from "./ports";
import type { CallOrigin, Json } from "./module-calls";
import { CallError } from "./module-call-error";
import type { SystemModule, SystemTool } from "./module-system-types";
const definition = (name: string, description: string, input: z.ZodType, output: z.ZodType): SystemTool => ({ name, description, parameters: { type: "object", properties: {}, required: [] }, visibility: ["modules"], idempotent: false, input, output });
export const agentDelegationTools = [definition("agent-admit", "Builtin Agent execution admission for a live module call", z.object({ callId: z.string(), operation: z.enum(["context", "start", "status", "inject", "abort", "release", "transcript", "complete", "run", "get", "lookup", "stream", "write", "interrupt", "respond", "inspect", "placement", "locations", "cleanup"]), settle: z.boolean().optional(), execution: z.unknown().optional() }).strict(), z.unknown()),
  definition("agent-settle", "Builtin Agent model reservation settlement", z.object({ reservationId: z.string(), result: z.object({ text: z.string(), inputTokens: z.number().nullable(), outputTokens: z.number().nullable() }).strict().optional(), failed: z.boolean() }).strict(), z.null())];

type Delegate = (ports: StewardPorts, workspaceId: string, caller: CallOrigin["caller"], name: string, args: Record<string, unknown>) => Promise<Json>;
let handler: Delegate | undefined;
export let injectedAgentTools: SystemTool[] = [];
let injectedHandler: SystemModule["handle"] | undefined;
export function installInjectedAgent(tools: SystemTool[], handle: SystemModule["handle"]) { injectedAgentTools = tools; injectedHandler = handle; }
export const dispatchInjectedAgent: SystemModule["handle"] = (...args) => {
  if (!injectedHandler) throw new CallError("unavailable", "Injected Agent admission is not initialized");
  return injectedHandler(...args);
};
export function installAgentDelegation(delegate: Delegate) { handler = delegate; }
export function dispatchAgentDelegation(...args: Parameters<Delegate>) {
  if (!handler) throw new CallError("unavailable", "Agent admission is not initialized");
  return handler(...args);
}
