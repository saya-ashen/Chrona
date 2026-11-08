import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runtimeEventSchema, providerAnswerSchema, type ProviderRunInput, type RuntimeEvent } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError, registerLocalModule, type Json } from "./module-calls";
import { tool, json } from "./system/shared";
import { isAgentApplication } from "./agent-application";
import { agentDelegationTools, dispatchAgentDelegation } from "./agent-delegation-port";

type Callback = { target: Pick<ProviderRunInput, "events" | "detail">; workspaceId: string; controllers: Map<string, AbortController>; interrupted: Set<string> };
// Match moduleSupervisor's scope: service-derived ports share its original ports' callbacks.
const callbacks = new WeakMap<StewardPorts["db"], Map<string, Map<string, Callback>>>();

/** Kernel-local subscribers are addressed by an opaque, workspace-bound reference; no callback crosses the wire. */
export function retainProviderCallbacks(ports: StewardPorts, workspaceId: string, input: Pick<ProviderRunInput, "events" | "detail">) {
  let scopes = callbacks.get(ports.db);
  if (!scopes) { scopes = new Map(); callbacks.set(ports.db, scopes); }
  let map = scopes.get(ports.dataDir);
  if (!map) { map = new Map(); scopes.set(ports.dataDir, map); }
  const id = randomUUID(), controllers = new Map<string, AbortController>(), interrupted = new Set<string>();
  map.set(id, { target: input, workspaceId, controllers, interrupted });
  return { id, release() { for (const controller of controllers.values()) controller.abort(); map.delete(id); } };
}
async function dispatchCallback(target: Pick<ProviderRunInput, "events" | "detail">, owner: Callback, value: RuntimeEvent): Promise<Json> {
  if (value.kind === "interrupt") {
    const controller = owner.controllers.get(value.requestId);
    if (controller) controller.abort();
    else if (owner.interrupted.size < 12) owner.interrupted.add(value.requestId);
    return null;
  }
  if (value.kind === "question") {
    if (!target.events) throw new CallError("unavailable", "Question channel unavailable");
    const controller = new AbortController(); owner.controllers.set(value.requestId, controller);
    if (owner.interrupted.delete(value.requestId)) controller.abort();
    try { return json(await target.events.question(value.value, controller.signal)); }
    finally { owner.controllers.delete(value.requestId); }
  }
  if (value.kind === "detail") await target.detail?.append(value.value);
  else await target.events?.[value.kind](value.value as never);
  return null;
}
export function registerProviderCallbacks() {
  registerLocalModule({ name: "runtime-callback", description: "Run-bound event delivery", unrecorded: ["event", "agent-admit", "agent-settle"],
    tools: [...agentDelegationTools, tool("event", "Run-bound Provider event", {}, [], { input: z.object({ callbackId: z.string().uuid(), event: runtimeEventSchema }).strict(), output: providerAnswerSchema.nullable(), visibility: ["kernel", "modules"] })],
    async handle({ ports, workspaceId, caller }, name, args): Promise<Json> {
      if (name !== "event") return dispatchAgentDelegation(ports, workspaceId, caller, name, args);
      if (caller.kind !== "kernel" && (caller.kind !== "module" || !await isAgentApplication(ports, caller, workspaceId))) throw new CallError("forbidden", "Runtime callbacks require the builtin Agent");
      const callback = callbacks.get(ports.db)?.get(ports.dataDir)?.get(String(args.callbackId));
      if (!callback || callback.workspaceId !== workspaceId) throw new CallError("not_found", "Run callback ended");
      return dispatchCallback(callback.target, callback, runtimeEventSchema.parse(args.event));
    },
  });
}
