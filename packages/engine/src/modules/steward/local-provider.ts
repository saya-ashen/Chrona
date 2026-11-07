import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { runtimeStartSchema, runtimeOperationSchema, runtimeOutcomeSchema, runtimeEventSchema, runtimeHealthSchema, runtimeCompletionSchema, runtimeTranscriptSchema, providerAnswerSchema, THINKING_LEVELS, type ProviderAdapter, type ProviderRunInput, type RuntimeEvent } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError, callSync, kernelOrigin, registerLocalModule, type Json } from "./module-calls";
import { tool, json } from "./system/shared";
import { authenticateRun } from "./run-auth";

const operations = new WeakMap<StewardPorts, Map<string, Operation>>();
const callbacks = new WeakMap<StewardPorts, Map<string, Pick<ProviderRunInput, "events" | "detail">>>();
type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
type Operation = { workspaceId: string; digest: string; handle: ReturnType<ProviderAdapter["start"]>; outcome?: Outcome; failure?: boolean };
function state(ports: StewardPorts) {
  let value = operations.get(ports);
  if (!value) { value = new Map(); operations.set(ports, value); }
  return value;
}
const operationInput = runtimeOperationSchema.extend({ message: z.string().max(2 * 1024 * 1024).optional(), images: runtimeStartSchema.shape.images });
const completionInput = z.object({ model: z.string().min(1).max(500), thinking: z.enum(THINKING_LEVELS).optional(), system: z.string().max(200_000).optional(), prompt: z.string().max(2 * 1024 * 1024), maxOutputTokens: z.number().int().positive().max(32_000), timeoutMs: z.number().int().positive().max(300_000) }).strict();
function owned(ports: StewardPorts, workspaceId: string, id: string) {
  const value = state(ports).get(id);
  if (!value || value.workspaceId !== workspaceId) throw new CallError("not_found", "Provider operation not found");
  return value;
}
async function event(ports: StewardPorts, workspaceId: string, callbackId: string, value: RuntimeEvent) {
  return (await callSync(ports, kernelOrigin(workspaceId), "runtime-callback.event", { callbackId, event: value })).output;
}
function providerInput(ports: StewardPorts, workspaceId: string, raw: unknown): ProviderRunInput {
  const { callbacks: callbackId, operationId: _id, deadline, ...input } = runtimeStartSchema.parse(raw);
  return { ...input, deadline: new Date(deadline), ...(callbackId ? {
    events: {
      progress: async value => { await event(ports, workspaceId, callbackId, { kind: "progress", value }); },
      usage: async value => { await event(ports, workspaceId, callbackId, { kind: "usage", value }); },
      resources: async value => { await event(ports, workspaceId, callbackId, { kind: "resources", value }); },
      async question(value, signal) {
        const requestId = randomUUID();
        const abort = () => { void event(ports, workspaceId, callbackId, { kind: "interrupt", requestId }).catch(() => {}); };
        signal.addEventListener("abort", abort, { once: true });
        try {
          const answer = event(ports, workspaceId, callbackId, { kind: "question", requestId, value });
          if (signal.aborted) abort();
          return providerAnswerSchema.parse(await answer);
        } finally { signal.removeEventListener("abort", abort); }
      },
    },
    detail: { async append(value) { await event(ports, workspaceId, callbackId, { kind: "detail", value }); } },
  } : {}) };
}
async function providerHealth(provider: ProviderAdapter | undefined) {
  return json({ name: provider?.name ?? "unconfigured", supportsRunModel: provider?.supportsRunModel ?? false, complete: !!provider?.complete, ...(provider ? await provider.health() : { available: false, sandboxed: false, error: null }) });
}
async function reserveStart(ports: StewardPorts, workspaceId: string, input: z.infer<typeof runtimeStartSchema>, digest: string) {
  await ports.db.$transaction(async tx => {
    const authenticated = await authenticateRun(tx, input.token, ports.now());
    const { run } = authenticated;
    if (authenticated.workspaceId !== workspaceId || run.id !== input.runId || input.operationId !== run.id || run.cwd !== input.cwd || run.lane !== input.lane || !run.deadlineAt || new Date(input.deadline) > run.deadlineAt) throw new CallError("forbidden", "Provider start exceeds the claimed Run");
    const id = `local-provider-start:${run.id}`;
    if (await tx.audit.findUnique({ where: { id } })) throw new CallError("unknown", "Provider start was already offered; original outcome requires reconciliation");
    await tx.audit.create({ data: { id, workspaceId, actorKey: "kernel", kind: "local_provider_start", subjectId: run.id, details: { digest }, createdAt: ports.now() } });
  });
}
async function startOperation(ports: StewardPorts, workspaceId: string, provider: ProviderAdapter, args: Record<string, unknown>) {
  const input = runtimeStartSchema.parse(args), digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const existing = state(ports).get(input.operationId);
  if (existing) {
    if (existing.workspaceId !== workspaceId || existing.digest !== digest) throw new CallError("conflict", "Provider operation identity changed");
    return { operationId: input.operationId };
  }
  if (state(ports).size >= 64) throw new CallError("capacity", "Provider operations full");
  try { await reserveStart(ports, workspaceId, input, digest); }
  catch (error) {
    const current = state(ports).get(input.operationId);
    if (!current || current.workspaceId !== workspaceId || current.digest !== digest) throw error;
    return { operationId: input.operationId };
  }
  let handle: ReturnType<ProviderAdapter["start"]>;
  try { handle = provider.start(providerInput(ports, workspaceId, input)); }
  catch { throw new CallError("unknown", "Provider launch remains unconfirmed"); }
  const row: Operation = { workspaceId, digest, handle };
  state(ports).set(input.operationId, row);
  void handle.done.then(outcome => { row.outcome = runtimeOutcomeSchema.parse(outcome); }).catch(() => { row.failure = true; });
  return { operationId: input.operationId };
}
async function waitOperation(row: Operation) {
  try { return json(runtimeOutcomeSchema.parse(await row.handle.done)); }
  catch { throw new CallError("unknown", "Provider completion remains unconfirmed"); }
}
async function controlOperation(ports: StewardPorts, workspaceId: string, name: string, args: Record<string, unknown>) {
  const row = owned(ports, workspaceId, String(args.operationId));
  if (name === "status") return json({ operationId: args.operationId, outcome: row.outcome ?? null, failure: row.failure ?? false });
  if (name === "wait") return waitOperation(row);
  if (name === "inject") {
    if (row.outcome || row.failure) throw new CallError("conflict", "Provider operation ended");
    if (typeof args.message !== "string") throw new CallError("invalid", "Message required");
    await row.handle.inject(args.message, args.images as ProviderRunInput["images"]); return { accepted: true };
  }
  if (name === "abort") { await row.handle.abort(); return { requested: true }; }
  if (name === "release") {
    if (!row.outcome) throw new CallError("conflict", "Provider completion remains unconfirmed");
    state(ports).delete(String(args.operationId)); return { released: true };
  }
  throw new CallError("not_found", "Provider tool not found");
}
export function registerProviderModule() {
  const declarations = [
    ["health", z.object({}).strict(), runtimeHealthSchema], ["start", runtimeStartSchema, runtimeOperationSchema],
    ["status", runtimeOperationSchema, runtimeOperationSchema.extend({ outcome: runtimeOutcomeSchema.nullable(), failure: z.boolean() })], ["wait", runtimeOperationSchema, runtimeOutcomeSchema],
    ["inject", operationInput, z.object({ accepted: z.literal(true) }).strict()], ["abort", runtimeOperationSchema, z.object({ requested: z.literal(true) }).strict()], ["release", runtimeOperationSchema, z.object({ released: z.literal(true) }).strict()],
    ["complete", completionInput, runtimeCompletionSchema], ["transcript", z.object({ sessionDir: z.string().max(8192), limit: z.number().int().min(1).max(300) }).strict(), runtimeTranscriptSchema],
  ] as const;
  registerLocalModule({ name: "agent", description: "Local Provider capability", unrecorded: declarations.map(([name]) => name),
    tools: declarations.map(([name, input, output]) => tool(name, "Trusted Provider operation", {}, [], { input, output, visibility: ["kernel"] })),
    async handle({ ports, workspaceId }, name, args) {
      const provider = ports.provider;
      if (name === "health") return providerHealth(provider);
      if (!provider) throw new CallError("unavailable", "Provider unconfigured");
      if (name === "complete") {
        if (!provider.complete) throw new CallError("unavailable", "Completion unconfigured");
        try { return json(await provider.complete(completionInput.parse(args))); }
        catch (error) { throw new CallError("failed", (error as { code?: string } | null)?.code === "timeout" ? "timeout" : "provider_error"); }
      }
      if (name === "transcript") return json(provider.transcript ? await provider.transcript(args as { sessionDir: string; limit: number }) : []);
      if (name === "start") return startOperation(ports, workspaceId, provider, args);
      return controlOperation(ports, workspaceId, name, args);
    },
  });
}

/** Kernel-local subscribers are addressed by an opaque, workspace-bound reference; no callback crosses the wire. */
export function retainProviderCallbacks(ports: StewardPorts, workspaceId: string, input: Pick<ProviderRunInput, "events" | "detail">) {
  let map = callbacks.get(ports);
  if (!map) { map = new Map(); callbacks.set(ports, map); }
  const id = randomUUID(), controllers = new Map<string, AbortController>(), interrupted = new Set<string>();
  map.set(id, input);
  callbackOwners.set(input, { workspaceId, controllers, interrupted });
  return { id, release() { for (const controller of controllers.values()) controller.abort(); map!.delete(id); callbackOwners.delete(input); } };
}
const callbackOwners = new WeakMap<object, { workspaceId: string; controllers: Map<string, AbortController>; interrupted: Set<string> }>();
async function dispatchCallback(target: Pick<ProviderRunInput, "events" | "detail">, owner: NonNullable<ReturnType<typeof callbackOwners.get>>, value: RuntimeEvent): Promise<Json> {
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
  registerLocalModule({ name: "runtime-callback", description: "Run-bound event delivery", unrecorded: ["event"],
    tools: [tool("event", "Run-bound Provider event", {}, [], { input: z.object({ callbackId: z.string().uuid(), event: runtimeEventSchema }).strict(), output: providerAnswerSchema.nullable(), visibility: ["kernel"] })],
    async handle({ ports, workspaceId }, _name, args): Promise<Json> {
      const target = callbacks.get(ports)?.get(String(args.callbackId)), owner = target && callbackOwners.get(target);
      if (!target || owner?.workspaceId !== workspaceId) throw new CallError("not_found", "Run callback ended");
      return dispatchCallback(target, owner, runtimeEventSchema.parse(args.event));
    },
  });
}
