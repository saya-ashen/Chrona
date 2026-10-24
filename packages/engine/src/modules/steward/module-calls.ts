import { randomUUID } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { MAX_CALL_DEPTH, moduleManifestSchema, RUN_LIMITS, type callerSchema, type ModuleEvent, type ModuleManifest } from "@chrona/contracts/steward";
import type { z } from "zod";
import type { StewardPorts } from "./ports";
import { moduleSupervisor, type DeliveryStage } from "./module-supervisor";
import { validateToolArgs } from "./module-tools";
import { StewardError } from "./errors";

export type Caller = z.infer<typeof callerSchema>;
/** A JSON value as the contract carries it. */
export type Json = z.output<ReturnType<typeof z.json>>;
/** Who is calling, as Chrona knows it. `chain` holds the modules waiting on this call path (sync), `path` every module on it. */
export type CallOrigin = { workspaceId: string; caller: Caller; chain: string[]; path: string[] };
type Db = StewardPorts["db"] | Prisma.TransactionClient;
export type Tool = ModuleManifest["tools"][number];
export type CallErrorCode = "forbidden" | "not_found" | "cycle" | "invalid" | "unknown" | "failed" | "unavailable";
export class CallError extends Error {
  constructor(public readonly code: CallErrorCode, message: string) { super(message); this.name = "CallError"; }
}
/**
 * A system module: part of Chrona, in-process. Its tools are declared like a module's and reached by the same routed
 * calls (visibility, callers, uses, recorded caller, async queue); its code is Chrona's, so it is never proposed,
 * built, sandboxed or paused, and its name is reserved.
 */
export type SystemModule = { name: string; tools: Tool[]; handle(context: { ports: StewardPorts; workspaceId: string; caller: Caller }, tool: string, args: Record<string, unknown>): Promise<Json> };
const systemModules = new Map<string, SystemModule>();
export function registerSystemModule(module: SystemModule) { systemModules.set(module.name, module); }
type Target = { module: { id: string; name: string; activeHash: string; workspaceId: string }; tool: Tool; system?: SystemModule };
const MAX_ATTEMPTS = 6;
const BATCH = 20;

export function callerKey(caller: Caller) {
  return caller.kind === "module" ? `module:${caller.moduleId}` : caller.kind === "provider" ? `provider:${caller.runId}` : caller.kind === "system" ? `system:${caller.module}` : caller.kind;
}
const callerName = (caller: Caller) => caller.kind === "module" || caller.kind === "system" ? caller.module : null;
export const kernelOrigin = (workspaceId: string): CallOrigin => ({ workspaceId, caller: { kind: "kernel" }, chain: [], path: [] });
export const systemOrigin = (workspaceId: string, module: string): CallOrigin => ({ workspaceId, caller: { kind: "system", module }, chain: [], path: [] });

function splitTarget(target: string) {
  const [module, tool] = target.split(".");
  if (!module || !tool) throw new CallError("invalid", "Call target must be <module>.<tool>");
  return { module, tool };
}
async function resolveTarget(db: Db, workspaceId: string, target: string): Promise<Target | CallError> {
  const name = splitTarget(target);
  const system = systemModules.get(name.module);
  if (system) {
    const tool = system.tools.find(candidate => candidate.name === name.tool);
    return tool ? { module: { id: `system:${system.name}`, name: system.name, activeHash: "system", workspaceId }, tool, system } : new CallError("not_found", `Tool ${target} not found`);
  }
  const module = await db.module.findFirst({ where: { workspaceId, name: name.module } });
  if (!module) return new CallError("not_found", `Module ${name.module} not found`);
  if (module.status !== "active" || !module.activeHash) return new CallError("unavailable", `Module ${name.module} is not active`);
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
  const tool = manifest?.tools.find(candidate => candidate.name === name.tool);
  if (!manifest || !tool) return new CallError("not_found", `Tool ${target} not found`);
  return { module: { ...module, activeHash: module.activeHash }, tool };
}
/**
 * The target decides who may reach it: its visibility, and for modules (system ones too) its `callers` list.
 * A module reaches a `modules` tool it lists in `uses`; with `uses: ["*"]` it reaches the tools open to the user (v2-8 §3).
 */
export async function admitted(db: Db, caller: Caller, tool: Tool, target: string) {
  const name = callerName(caller);
  if (!name) return tool.visibility.includes(caller.kind as Tool["visibility"][number]);
  if (tool.callers && !tool.callers.includes(name)) return false;
  if (caller.kind !== "module") return tool.visibility.includes("modules");
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.moduleId, hash: caller.hash } } });
  const uses = moduleManifestSchema.safeParse(version?.manifest).data?.uses ?? [];
  return (uses.includes(target) && tool.visibility.includes("modules")) || (uses.includes("*") && tool.visibility.includes("owner"));
}
/** A system module's errors as call errors: its own refusals keep their code. */
function systemError(error: unknown) {
  if (error instanceof CallError) return error;
  if (error instanceof StewardError) return new CallError(error.code === "conflict" ? "failed" : error.code, error.message);
  return new CallError("failed", message(error));
}
function nextPath(origin: CallOrigin) {
  const name = callerName(origin.caller);
  return { chain: name ? [...origin.chain, name] : origin.chain, path: name ? [...origin.path, name] : origin.path };
}
function validArgs(tool: Tool, raw: unknown) {
  try { return validateToolArgs(tool, raw); }
  catch (error) { throw new CallError("invalid", error instanceof StewardError ? error.message : "Invalid call arguments"); }
}
function toolEvent(target: Target, args: Record<string, unknown>, now: Date, caller: Caller, call: { id: string; key: string | null; attempt: number; chain: string[] }): ModuleEvent {
  return { trigger: { id: target.tool.name, kind: "tool", firedAt: now.toISOString(), args, caller, call }, now: now.toISOString(), params: {} };
}
/** Maps a failed delivery: never reached the target, the target answered with an error, or lost after it was sent. */
function stageOf(error: unknown): DeliveryStage {
  return (error as { stage?: DeliveryStage } | null)?.stage ?? "lost";
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2000);

// Which modules are blocked in a sync call, on which targets (per runtime). A module waiting in one event cannot serve
// another, so a sync call to a module that is (transitively) waiting on the caller would deadlock across events too.
const waiting = new WeakMap<StewardPorts["db"], Map<string, string[]>>();
function waitsOn(graph: Map<string, string[]>, from: string, to: string, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (graph.get(from) ?? []).some(next => waitsOn(graph, next, to, seen));
}

/**
 * Synchronous routed call: waits for the target's reply. Refused when the target is already waiting on this path
 * (the target's events are serial, so it could never answer). Unknown outcomes are reported, never retried.
 */
export async function callSync(ports: StewardPorts, origin: CallOrigin, target: string, raw: unknown, { timeoutMs }: { timeoutMs?: number } = {}) {
  const resolved = await resolveTarget(ports.db, origin.workspaceId, target);
  if (resolved instanceof CallError) throw resolved;
  if (!await admitted(ports.db, origin.caller, resolved.tool, target)) throw new CallError("forbidden", `${target} does not accept calls from this caller`);
  const { chain, path } = nextPath(origin);
  if (chain.includes(resolved.module.name)) throw new CallError("cycle", `${target}: ${resolved.module.name} is waiting on this call path (${chain.join(" → ")})`);
  if (path.length >= MAX_CALL_DEPTH) throw new CallError("cycle", `Call path too deep (${path.join(" → ")})`);
  const args = validArgs(resolved.tool, raw), now = ports.now();
  const row = await ports.db.moduleInvocation.create({ data: { workspaceId: origin.workspaceId, caller: callerKey(origin.caller), callerModuleId: origin.caller.kind === "module" ? origin.caller.moduleId : null, callerHash: origin.caller.kind === "module" ? origin.caller.hash : null,
    target: resolved.module.name, tool: resolved.tool.name, args: args as Prisma.InputJsonValue, key: randomUUID(), chain: path, mode: "sync", idempotent: resolved.tool.idempotent, status: "running", attempts: 1, createdAt: now } });
  const finish = (data: Prisma.ModuleInvocationUpdateInput) => ports.db.moduleInvocation.update({ where: { id: row.id }, data: { ...data, finishedAt: ports.now() } });
  if (resolved.system) {
    // In-process: no event queue to wait on, so no deadlock to guard against.
    try {
      const output = await resolved.system.handle({ ports, workspaceId: origin.workspaceId, caller: origin.caller }, resolved.tool.name, args);
      await finish({ status: "succeeded", output: output as Prisma.InputJsonValue });
      return { callId: row.id, output };
    } catch (error) {
      const failure = systemError(error);
      await finish({ status: "failed", error: `${failure.code}: ${failure.message}`.slice(0, 2000) });
      throw failure;
    }
  }
  let graph = waiting.get(ports.db);
  if (!graph) { graph = new Map(); waiting.set(ports.db, graph); }
  const name = callerName(origin.caller), edges = graph;
  if (name && waitsOn(edges, resolved.module.name, name)) {
    await finish({ status: "failed", error: "cycle" });
    throw new CallError("cycle", `${target}: ${resolved.module.name} is waiting on ${name} in another call`);
  }
  if (name) edges.set(name, [...edges.get(name) ?? [], resolved.module.name]);
  let reply;
  try {
    reply = await moduleSupervisor(ports).deliver(resolved.module.id, resolved.module.activeHash, toolEvent(resolved, args, now, origin.caller, { id: row.id, key: null, attempt: 1, chain: path }), { chain, path, ...(timeoutMs ? { timeoutMs } : {}) });
  } catch (error) {
    const stage = stageOf(error), code = stage === "unavailable" ? "unavailable" : stage === "handler" ? "failed" : "unknown";
    await finish({ status: code === "unknown" ? "unknown" : "failed", error: message(error) });
    throw new CallError(code, code === "unknown" ? `${target}: outcome unknown (${message(error)})` : `${target}: ${message(error)}`);
  } finally {
    if (name) {
      const rest = edges.get(name) ?? [], at = rest.indexOf(resolved.module.name);
      if (at >= 0) rest.splice(at, 1);
      if (!rest.length) edges.delete(name);
    }
  }
  const output = "result" in reply ? reply.result.result ?? null : null;
  await finish({ status: "succeeded", output: output as Prisma.InputJsonValue });
  return { callId: row.id, output: output as Json };
}

/**
 * Stores an async call in the caller's transaction (an outbox): it commits with the caller's own writes.
 * A repeated `key` from the same caller returns the stored call. Chrona's own calls (and `lenient` ones, e.g. the
 * `chrona.notify` shorthand) may name a target that is not active right now: it is resolved at delivery.
 * Other module calls must name an active, admitting target.
 */
export async function enqueueCall(tx: Db, ports: StewardPorts, origin: CallOrigin, target: string, raw: unknown, { key, reply = false, lenient = false }: { key: string; reply?: boolean; lenient?: boolean }) {
  const name = splitTarget(target), caller = callerKey(origin.caller);
  const existing = await tx.moduleInvocation.findUnique({ where: { workspaceId_caller_target_tool_key: { workspaceId: origin.workspaceId, caller, target: name.module, tool: name.tool, key } } });
  if (existing) return { callId: existing.id, status: existing.status as "queued", duplicate: true };
  const resolved = await resolveTarget(tx, origin.workspaceId, target);
  if (resolved instanceof CallError) { if (origin.caller.kind !== "kernel" && origin.caller.kind !== "system" && !(lenient && (resolved.code === "unavailable" || resolved.code === "not_found"))) throw resolved; }
  else if (!await admitted(tx, origin.caller, resolved.tool, target)) throw new CallError("forbidden", `${target} does not accept calls from this caller`);
  const { path } = nextPath(origin);
  if (path.length >= MAX_CALL_DEPTH) throw new CallError("cycle", `Call path too deep (${path.join(" → ")})`);
  const args = resolved instanceof CallError ? raw : validArgs(resolved.tool, raw), now = ports.now();
  const row = await tx.moduleInvocation.create({ data: { workspaceId: origin.workspaceId, caller, callerModuleId: origin.caller.kind === "module" ? origin.caller.moduleId : null, callerHash: origin.caller.kind === "module" ? origin.caller.hash : null,
    target: name.module, tool: name.tool, args: (args ?? {}) as Prisma.InputJsonValue, key, chain: path, mode: "async", idempotent: resolved instanceof CallError ? false : resolved.tool.idempotent,
    reply: reply && origin.caller.kind === "module", nextAttemptAt: now, createdAt: now } });
  return { callId: row.id, status: "queued" as const, duplicate: false };
}

/** An async call's state, readable only by the caller that made it. */
export async function callStatus(ports: StewardPorts, origin: CallOrigin, callId: string) {
  const row = await ports.db.moduleInvocation.findFirst({ where: { id: callId, workspaceId: origin.workspaceId, caller: callerKey(origin.caller), mode: "async" } });
  if (!row) throw new CallError("not_found", "Call not found");
  return { callId: row.id, status: row.status as "queued", ...(row.output !== null ? { output: row.output as Json } : {}), ...(row.error ? { error: row.error } : {}) };
}

function originOf(row: { workspaceId: string; caller: string; callerHash: string | null; chain: Prisma.JsonValue }, callerModule: { id: string; name: string } | null): Caller {
  if (row.caller.startsWith("module:") && callerModule) return { kind: "module", module: callerModule.name, moduleId: callerModule.id, hash: row.callerHash ?? "" };
  if (row.caller.startsWith("provider:")) return { kind: "provider", runId: row.caller.slice("provider:".length) };
  if (row.caller.startsWith("system:")) return { kind: "system", module: row.caller.slice("system:".length) };
  return row.caller === "owner" ? { kind: "owner", via: null } : { kind: "kernel" };
}
type Row = Awaited<ReturnType<StewardPorts["db"]["moduleInvocation"]["findFirstOrThrow"]>>;
const backoff = (now: Date, attempts: number) => new Date(now.getTime() + Math.min(3600_000, 30_000 * 2 ** Math.max(0, attempts - 1)));

async function deliverRow(ports: StewardPorts, row: Row, token: string) {
  const { db } = ports, now = ports.now();
  const settle = (data: Prisma.ModuleInvocationUpdateManyMutationInput) => db.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: token }, data: { leaseToken: null, leaseUntil: null, ...data } });
  const retryOrFail = (error: string) => settle(row.attempts < MAX_ATTEMPTS ? { status: "queued", nextAttemptAt: backoff(now, row.attempts), error } : { status: "failed", error, finishedAt: now });
  const resolved = await resolveTarget(db, row.workspaceId, `${row.target}.${row.tool}`);
  // Not there yet (e.g. a built-in still building) or paused: it never got the call, so trying later is safe.
  if (resolved instanceof CallError) return resolved.code === "unavailable" || resolved.code === "not_found" ? retryOrFail(resolved.message) : settle({ status: "failed", error: resolved.message, finishedAt: now });
  const callerModule = row.callerModuleId ? await db.module.findUnique({ where: { id: row.callerModuleId } }) : null;
  const caller = originOf(row, callerModule);
  if (!await admitted(db, caller, resolved.tool, `${row.target}.${row.tool}`)) return settle({ status: "failed", error: "forbidden: the target no longer accepts this caller", finishedAt: now });
  let args;
  try { args = validArgs(resolved.tool, row.args); }
  catch (error) { return settle({ status: "failed", error: message(error), finishedAt: now }); }
  if (resolved.system) {
    try {
      const output = await resolved.system.handle({ ports, workspaceId: row.workspaceId, caller }, resolved.tool.name, args);
      return settle({ status: "succeeded", output: output as Prisma.InputJsonValue, error: null, finishedAt: ports.now() });
    } catch (error) { const failure = systemError(error); return settle({ status: "failed", error: `${failure.code}: ${failure.message}`.slice(0, 2000), finishedAt: ports.now() }); }
  }
  const path = Array.isArray(row.chain) ? row.chain.filter((name): name is string => typeof name === "string") : [];
  try {
    const reply = await moduleSupervisor(ports).deliver(resolved.module.id, resolved.module.activeHash, toolEvent(resolved, args, now, caller, { id: row.id, key: row.key, attempt: row.attempts, chain: path }), { chain: [], path });
    const output = "result" in reply ? reply.result.result ?? null : null;
    return settle({ status: "succeeded", output: output as Prisma.InputJsonValue, error: null, finishedAt: ports.now() });
  } catch (error) {
    const stage = stageOf(error);
    if (stage === "unavailable") return retryOrFail(message(error));
    if (stage === "handler") return settle({ status: "failed", error: message(error), finishedAt: ports.now() });
    // Sent but no answer: the target may have acted. Only an idempotent target is asked again.
    if (resolved.tool.idempotent && row.attempts < MAX_ATTEMPTS) return settle({ status: "queued", idempotent: true, nextAttemptAt: backoff(now, row.attempts), error: message(error) });
    return settle({ status: "unknown", error: `Outcome unknown: ${message(error)}`, finishedAt: ports.now() });
  }
}
async function replyRow(ports: StewardPorts, row: Row) {
  const { db } = ports;
  const module = row.callerModuleId ? await db.module.findUnique({ where: { id: row.callerModuleId } }) : null;
  const claimed = await db.moduleInvocation.updateMany({ where: { id: row.id, repliedAt: null, replyAttempts: row.replyAttempts }, data: { replyAttempts: { increment: 1 } } });
  if (!claimed.count || !module || module.status !== "active" || !module.activeHash) return;
  const now = ports.now();
  const event: ModuleEvent = { trigger: { kind: "call_result", id: "call", firedAt: now.toISOString(), callId: row.id, target: `${row.target}.${row.tool}`, key: row.key, status: row.status as "succeeded",
    ...(row.output !== null ? { output: row.output as Json } : {}), ...(row.error ? { error: row.error.slice(0, 2000) } : {}) }, now: now.toISOString(), params: {} };
  const path = Array.isArray(row.chain) ? row.chain.filter((name): name is string => typeof name === "string") : [];
  try {
    await moduleSupervisor(ports).deliver(module.id, module.activeHash, event, { chain: [], path });
    await db.moduleInvocation.update({ where: { id: row.id }, data: { repliedAt: ports.now() } });
  } catch { /* The caller can still read the result with callStatus; replies are retried a few times. */ }
}

/** One pass over the workspace's async calls: recover expired leases, deliver due calls, send results back. */
export async function runDueCalls(ports: StewardPorts, workspaceId: string) {
  const { db } = ports, now = ports.now();
  for (const row of await db.moduleInvocation.findMany({ where: { workspaceId, mode: "async", status: "running", leaseUntil: { lte: now } } })) {
    // Chrona stopped or lost the delivery mid-flight: the target may have acted.
    await db.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: row.leaseToken }, data: row.idempotent && row.attempts < MAX_ATTEMPTS
      ? { status: "queued", leaseToken: null, leaseUntil: null, nextAttemptAt: now, error: "Delivery interrupted; retrying an idempotent call" }
      : { status: "unknown", leaseToken: null, leaseUntil: null, error: "Delivery interrupted; outcome unknown", finishedAt: now } });
  }
  let delivered = 0;
  for (const row of await db.moduleInvocation.findMany({ where: { workspaceId, mode: "async", status: "queued", nextAttemptAt: { lte: now } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH })) {
    const token = randomUUID();
    const claimed = await db.moduleInvocation.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "running", leaseToken: token, leaseUntil: new Date(now.getTime() + RUN_LIMITS.jobTimeoutMs * 10 + 60_000), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    await deliverRow(ports, { ...row, status: "running", attempts: row.attempts + 1 }, token);
    delivered++;
  }
  for (const row of await db.moduleInvocation.findMany({ where: { workspaceId, mode: "async", reply: true, repliedAt: null, status: { in: ["succeeded", "failed", "unknown"] }, replyAttempts: { lt: 3 } }, orderBy: { finishedAt: "asc" }, take: BATCH })) await replyRow(ports, row);
  return delivered;
}

// Deliveries run beside the tick: a slow target must not hold back schedules and runs.
const drains = new WeakMap<StewardPorts["db"], Map<string, { loop: Promise<void>; again: boolean }>>();
/** Starts delivering due calls unless already running (then it runs once more); repeats while calls keep becoming due. */
export function drainCalls(ports: StewardPorts, workspaceId: string) {
  let running = drains.get(ports.db);
  if (!running) { running = new Map(); drains.set(ports.db, running); }
  const current = running.get(workspaceId);
  if (current) { current.again = true; return current.loop; }
  const map = running, state = { loop: Promise.resolve(), again: false };
  state.loop = (async () => {
    try {
      do { state.again = false; while (await runDueCalls(ports, workspaceId) > 0); } while (state.again);
    } finally { map.delete(workspaceId); }
  })();
  map.set(workspaceId, state);
  return state.loop;
}
/** Settles every running delivery loop (tests and shutdown). */
export async function callsSettled(ports: StewardPorts) {
  for (let i = 0; i < 100; i++) {
    const loops = [...(drains.get(ports.db)?.values() ?? [])];
    if (!loops.length) return;
    await Promise.all(loops.map(state => state.loop.catch(() => {})));
  }
}
