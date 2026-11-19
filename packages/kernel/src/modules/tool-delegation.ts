import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ExpectedModuleTarget, RoutedTarget } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { audit } from "../audit";
import { tool } from "../system/shared";
import { CallError, callSync, duplicateReply, previousCall, registerLocalModule, type Caller, type CallOrigin, type Json } from "./module-calls";
import { moduleRequestDigest } from "./module-request-digest";
import { assertExpectedTarget, resolveTarget, routedTargetName } from "./module-call-target";
import { admitted } from "./module-call-admission";
import { currentCallerManifest } from "./module-owner";

type Principal = Extract<Caller, { kind: "module" }>;
type Binding = Pick<Principal, "moduleId" | "hash">;
const input = z.object({ reference: z.string().uuid(), args: z.record(z.string(), z.json()), key: z.string().min(1).max(200),
  timeoutSeconds: z.number().int().min(1).max(600).optional() }).strict();
type Use = z.infer<typeof input> & { delegate: Principal; run?: CallOrigin["run"]; active(): boolean };
type Grant = { workspaceId: string; recipient: Binding; authorizer: Principal; target: string; invoke(request: Use): Promise<Json> };
const grants = new WeakMap<StewardPorts["db"], Map<string, Grant>>();

export function retainToolDelegation(ports: StewardPorts, grant: Grant) {
  const scoped = grants.get(ports.db) ?? new Map<string, Grant>();
  grants.set(ports.db, scoped);
  const reference = randomUUID();
  scoped.set(reference, grant);
  return { reference, release: () => { scoped.delete(reference); } };
}

async function retainOrdinaryTool(ports: StewardPorts, origin: CallOrigin, target: RoutedTarget, grant: Omit<Grant, "invoke" | "target">,
  deadline: number) {
  const { workspaceId, authorizer } = grant;
  const name = await routedTargetName(ports.db, workspaceId, target);
  const resolved = await resolveTarget(ports.db, workspaceId, name);
  if (resolved instanceof CallError) throw resolved;
  if (resolved.module.name === "secrets" || !await admitted(ports.db, authorizer, resolved.tool, workspaceId, resolved.module)) {
    throw new CallError("forbidden", "Tool delegation exceeds caller authority");
  }
  const expectedTarget = { moduleId: resolved.module.id, hash: resolved.module.activeHash };
  return retainToolDelegation(ports, { ...grant, target: name, async invoke(request) {
    const { delegate, run, active, key, reference, args: input } = request;
    const end = Math.min(deadline, ports.now().getTime() + (request.timeoutSeconds ?? 60) * 1000);
    const beforeDelivery = async () => {
      if (!run?.moduleRunId || !active() || end <= ports.now().getTime() || !await currentCallerManifest(ports.db, workspaceId, delegate)) {
        throw new CallError("forbidden", "Tool delegation has ended");
      }
    };
    await beforeDelivery();
    const delegated = { ...origin, delegate, deadline: end, beforeDelivery, waitingModuleRunId: run?.moduleRunId };
    return (await callSync(ports, delegated, target, input, { key: `delegate:${reference}:${key}`, expectedTarget,
      timeoutMs: Math.max(1, end - ports.now().getTime()) })).output;
  } });
}

export async function callWithToolDelegations(ports: StewardPorts, origin: CallOrigin, request: {
  target: RoutedTarget; delegations: Record<string, RoutedTarget>; args: Record<string, unknown>;
  timeoutMs?: number; expectedTarget?: ExpectedModuleTarget; key?: string;
}) {
  const { target: recipientTarget, delegations: targets, args, expectedTarget, key, timeoutMs = 60_000 } = request;
  if (origin.caller.kind !== "module" || typeof recipientTarget === "string") throw new CallError("invalid", "Tool delegations require an application recipient");
  const { workspaceId, caller: authorizer } = origin;
  if (key) {
    const previous = await previousCall(ports.db, origin, recipientTarget, key);
    if (previous) return duplicateReply(previous, origin, moduleRequestDigest({ args, mode: "sync", targets }), expectedTarget);
  }
  const deadline = ports.now().getTime() + timeoutMs;
  const receiver = await resolveTarget(ports.db, workspaceId, await routedTargetName(ports.db, workspaceId, recipientTarget));
  if (receiver instanceof CallError) throw receiver;
  assertExpectedTarget(receiver, expectedTarget);
  const recipient = { moduleId: receiver.module.id, hash: receiver.module.activeHash };
  const payload = { ...args }, releases: (() => void)[] = [];
  try {
    for (const [field, target] of Object.entries(targets)) {
      if (Object.hasOwn(payload, field)) throw new CallError("invalid", `Tool delegation field already exists: ${field}`);
      const grant = await retainOrdinaryTool(ports, origin, target, { workspaceId, authorizer, recipient }, deadline);
      Object.defineProperty(payload, field, { value: grant.reference, enumerable: true });
      releases.push(grant.release);
    }
    return await callSync(ports, { ...origin, deadline }, recipientTarget, payload, { timeoutMs, expectedTarget: recipient, key,
      delegationRequest: { args, targets } });
  } finally {
    for (const release of releases) release();
  }
}

export function registerToolDelegations() {
  registerLocalModule({ name: "tool-delegation", description: "Invoke an application-issued tool delegation", unrecorded: ["invoke"],
    tools: [tool("invoke", "Invoke a tool using its bound reference", {}, [], { input, output: z.json(), visibility: ["modules"] })],
    async handle({ ports, workspaceId, caller, run }, _name, raw) {
      const request = input.parse(raw);
      const scoped = grants.get(ports.db), grant = scoped?.get(request.reference);
      if (!grant || grant.workspaceId !== workspaceId || caller.kind !== "module" || caller.moduleId !== grant.recipient.moduleId || caller.hash !== grant.recipient.hash ||
          !await currentCallerManifest(ports.db, workspaceId, caller) || !await currentCallerManifest(ports.db, workspaceId, grant.authorizer)) {
        throw new CallError("forbidden", "Tool delegation requires a live grant and its approved recipient and authorizer");
      }
      await audit(ports.db, { workspaceId, actor: caller.moduleId, kind: "tool_delegation_attempted", subjectId: caller.moduleId,
        details: { target: grant.target, recipientHash: caller.hash, authorizer: grant.authorizer.moduleId, authorizerHash: grant.authorizer.hash } });
      return grant.invoke({ ...request, delegate: caller, run, active: () => scoped?.get(request.reference) === grant });
    },
  });
}
