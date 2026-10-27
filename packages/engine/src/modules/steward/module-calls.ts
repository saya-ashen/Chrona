import { randomUUID } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { currentTarget, grantedUses, MAX_CALL_DEPTH, moduleManifestSchema, RUN_LIMITS, type callerSchema, type ModuleEvent, type ModuleManifest } from "@chrona/contracts/steward";
import type { z } from "zod";
import type { StewardPorts } from "./ports";
import { moduleSupervisor, type DeliveryStage } from "./module-supervisor";
import { validateToolArgs } from "./module-tools";
import { parseInput, StewardError } from "./errors";

export type Caller = z.infer<typeof callerSchema>;
/** A JSON value as the contract carries it. */
export type Json = z.output<ReturnType<typeof z.json>>;
/**
 * Who is calling, as Chrona knows it. `chain` holds the modules waiting on this call path (sync), `path` every module on it.
 * `run`: the module event being handled, for system modules that budget per event (provider.complete).
 */
/** `deadline` (ms since epoch, v2-13): when the caller stops waiting; system tools that wait finish by then. */
export type CallOrigin = { workspaceId: string; caller: Caller; chain: string[]; path: string[]; run?: { moduleRunId?: string; eventKey?: string }; deadline?: number };
type Db = StewardPorts["db"] | Prisma.TransactionClient;
export type Tool = ModuleManifest["tools"][number];
export type CallErrorCode = "forbidden" | "not_found" | "conflict" | "cycle" | "invalid" | "unknown" | "failed" | "unavailable";
export class CallError extends Error {
  constructor(public readonly code: CallErrorCode, message: string) { super(message); this.name = "CallError"; }
}
/**
 * A system module: part of Chrona, in-process. Its tools are declared like a module's and reached by the same routed
 * calls (visibility, callers, uses, recorded caller, async queue); its code is Chrona's, so it is never proposed,
 * built, sandboxed or paused, and its name is reserved.
 */
/** `unrecorded`: tools called only synchronously whose arguments and results are never stored (credentials, model prompts and completions). */
/** A system tool may validate with a full schema (`input`) instead of scalar parameters: system modules are Chrona's own code. */
export type SystemTool = Tool & { input?: z.ZodType; output?: z.ZodType; documentation?: string; examples?: Json[] };
/** `call`: the async call being delivered (absent for sync calls). */
export type SystemModule = { name: string; tools: SystemTool[]; unrecorded?: string[]; handle(context: { ports: StewardPorts; workspaceId: string; caller: Caller; run?: CallOrigin["run"]; deadline?: number; call?: { id: string } }, tool: string, args: Record<string, unknown>): Promise<Json> };
/**
 * Thrown by a system tool that waits for the user (v2-16 `approvals.request`): the async call stays `waiting`, untouched
 * by leases and retries, until `settleWaiting` gives its result, which goes back to the caller as a `call_result`.
 */
export class AwaitUser extends Error {
  constructor(readonly output: Json) { super("Waiting for the user"); }
}
export function settleWaiting(db: Db, callId: string, output: Json, now: Date) {
  return db.moduleInvocation.updateMany({ where: { id: callId, mode: "async", status: "waiting" }, data: { status: "succeeded", output: output as Prisma.InputJsonValue, finishedAt: now } });
}
const systemModules = new Map<string, SystemModule>();
export function registerSystemModule(module: SystemModule) { systemModules.set(module.name, module); }
/** System modules and their tools, for catalogs (v2-13: the Provider reaches those visible to it). */
export const listSystemModules = () => [...systemModules.values()];
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
 * A module reaches a `modules` tool it lists in `uses`, or one whose `callers` names it (v2-14: the target grants it);
 * with `uses: ["*"]` it reaches the tools open to the user (v2-8 §3).
 */
export async function admitted(db: Db, caller: Caller, tool: Tool, target: string) {
  const name = callerName(caller);
  if (!name) return tool.visibility.includes(caller.kind as Tool["visibility"][number]);
  if (tool.callers && !tool.callers.includes(name)) return false;
  if (caller.kind !== "module") return tool.visibility.includes("modules");
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.moduleId, hash: caller.hash } } });
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data, uses = manifest ? grantedUses(manifest) : [];
  // Past the check above, a `callers` list names this caller.
  return ((uses.includes(target) || !!tool.callers) && tool.visibility.includes("modules")) || (uses.includes("*") && tool.visibility.includes("owner"));
}
/** v2-14: whether `target` names `module` in its `callers` (and is open to modules), so the caller need not list it in `uses`. */
export async function callerGranted(db: Db, workspaceId: string, target: string, module: string) {
  const resolved = await resolveTarget(db, workspaceId, currentTarget(target)).catch(() => null);
  return !!resolved && !(resolved instanceof CallError) && !!resolved.tool.callers?.includes(module) && resolved.tool.visibility.includes("modules");
}
/** A system module's errors as call errors: its own refusals keep their code. */
function systemError(error: unknown) {
  if (error instanceof CallError) return error;
  if (error instanceof StewardError) return new CallError(error.code, error.message);
  return new CallError("failed", message(error));
}
function nextPath(origin: CallOrigin) {
  const name = callerName(origin.caller);
  return { chain: name ? [...origin.chain, name] : origin.chain, path: name ? [...origin.path, name] : origin.path };
}
function validArgs(tool: SystemTool, raw: unknown) {
  try { return tool.input ? parseInput(tool.input, raw) as Record<string, unknown> : validateToolArgs(tool, raw); }
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
type SyncInvocation = { ports: StewardPorts; origin: CallOrigin; resolved: Target; target: string; args: Record<string, unknown>; chain: string[]; path: string[]; now: Date };
async function invokeSystemSync({ ports, origin, resolved, args, rowId, finish, quiet }: SyncInvocation & { rowId: string; finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown>; quiet: boolean }) {
  // In-process: no event queue to wait on, so no deadlock to guard against.
  try {
    const output = await resolved.system!.handle({ ports, workspaceId: origin.workspaceId, caller: origin.caller, run: origin.run, deadline: origin.deadline }, resolved.tool.name, args);
    await finish({ status: "succeeded", output: (quiet ? {} : output) as Prisma.InputJsonValue });
    return { callId: rowId, output };
  } catch (error) {
    const failure = systemError(error);
    await finish({ status: "failed", error: `${failure.code}: ${failure.message}`.slice(0, 2000) });
    throw failure;
  }
}
async function deliverSyncModule({ ports, origin, resolved, target, args, chain, path, now, timeoutMs, rowId, finish }: SyncInvocation & { timeoutMs?: number; rowId: string; finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown> }) {
  try {
    return await moduleSupervisor(ports).deliver(resolved.module.id, resolved.module.activeHash, toolEvent(resolved, args, now, origin.caller, { id: rowId, key: null, attempt: 1, chain: path }), { chain, path, ...(timeoutMs ? { timeoutMs } : {}) });
  } catch (error) {
    const stage = stageOf(error), code = stage === "unavailable" ? "unavailable" : stage === "handler" ? "failed" : "unknown";
    await finish({ status: code === "unknown" ? "unknown" : "failed", error: message(error) });
    throw new CallError(code, code === "unknown" ? `${target}: outcome unknown (${message(error)})` : `${target}: ${message(error)}`);
  }
}
function removeWaitEdge(edges: Map<string, string[]>, name: string, target: string) {
  const rest = edges.get(name) ?? [], at = rest.indexOf(target);
  if (at >= 0) rest.splice(at, 1);
  if (!rest.length) edges.delete(name);
}
async function addWaitEdge(edges: Map<string, string[]>, name: string | null, target: string, label: string, finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown>) {
  if (!name) return;
  if (waitsOn(edges, target, name)) {
    await finish({ status: "failed", error: "cycle" });
    throw new CallError("cycle", `${label}: ${target} is waiting on ${name} in another call`);
  }
  edges.set(name, [...edges.get(name) ?? [], target]);
}
async function invokeModuleSync({ ports, origin, resolved, target, args, chain, path, now, timeoutMs, rowId, finish }: SyncInvocation & { timeoutMs?: number; rowId: string; finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown> }) {
  let graph = waiting.get(ports.db);
  if (!graph) { graph = new Map(); waiting.set(ports.db, graph); }
  const name = callerName(origin.caller), edges = graph;
  await addWaitEdge(edges, name, resolved.module.name, target, finish);
  let reply;
  try { reply = await deliverSyncModule({ ports, origin, resolved, target, args, chain, path, now, timeoutMs, rowId, finish }); }
  finally { if (name) removeWaitEdge(edges, name, resolved.module.name); }
  const output = "result" in reply ? reply.result.result ?? null : null;
  await finish({ status: "succeeded", output: output as Prisma.InputJsonValue });
  return { callId: rowId, output: output as Json };
}
async function validateSyncRoute(ports: StewardPorts, origin: CallOrigin, target: string) {
  const resolved = await resolveTarget(ports.db, origin.workspaceId, target);
  if (resolved instanceof CallError) throw resolved;
  if (!await admitted(ports.db, origin.caller, resolved.tool, target)) throw new CallError("forbidden", `${target} does not accept calls from this caller`);
  const route = nextPath(origin);
  if (route.chain.includes(resolved.module.name)) throw new CallError("cycle", `${target}: ${resolved.module.name} is waiting on this call path (${route.chain.join(" → ")})`);
  if (route.path.length >= MAX_CALL_DEPTH) throw new CallError("cycle", `Call path too deep (${route.path.join(" → ")})`);
  return { resolved, route };
}
export async function callSync(ports: StewardPorts, origin: CallOrigin, target: string, raw: unknown, { timeoutMs }: { timeoutMs?: number } = {}) {
  target = currentTarget(target);
  const { resolved, route: { chain, path } } = await validateSyncRoute(ports, origin, target);
  const args = validArgs(resolved.tool, raw), now = ports.now(), quiet = resolved.system?.unrecorded?.includes(resolved.tool.name) ?? false;
  const row = await ports.db.moduleInvocation.create({ data: { workspaceId: origin.workspaceId, caller: callerKey(origin.caller), callerModuleId: origin.caller.kind === "module" ? origin.caller.moduleId : null, callerHash: origin.caller.kind === "module" ? origin.caller.hash : null,
    target: resolved.module.name, tool: resolved.tool.name, args: (quiet ? {} : args) as Prisma.InputJsonValue, key: randomUUID(), chain: path, mode: "sync", idempotent: resolved.tool.idempotent, status: "running", attempts: 1, createdAt: now } });
  const finish = (data: Prisma.ModuleInvocationUpdateInput) => ports.db.moduleInvocation.update({ where: { id: row.id }, data: { ...data, finishedAt: ports.now() } });
  const invocation = { ports, origin, resolved, target, args, chain, path, now };
  if (resolved.system) return invokeSystemSync({ ...invocation, rowId: row.id, finish, quiet });
  return invokeModuleSync({ ...invocation, timeoutMs, rowId: row.id, finish });
}

/**
 * Stores an async call in the caller's transaction (an outbox): it commits with the caller's own writes.
 * A repeated `key` from the same caller returns the stored call. Chrona's own calls (and `lenient` ones, e.g. the
 * `chrona.notify` shorthand) may name a target that is not active right now: it is resolved at delivery.
 * Other module calls must name an active, admitting target.
 */
async function resolveEnqueueTarget(tx: Db, origin: CallOrigin, target: string, lenient: boolean) {
  const resolved = await resolveTarget(tx, origin.workspaceId, target);
  if (resolved instanceof CallError) {
    if (origin.caller.kind !== "kernel" && origin.caller.kind !== "system" && !(lenient && (resolved.code === "unavailable" || resolved.code === "not_found"))) throw resolved;
  } else if (!await admitted(tx, origin.caller, resolved.tool, target)) throw new CallError("forbidden", `${target} does not accept calls from this caller`);
  else if (resolved.system?.unrecorded?.includes(resolved.tool.name)) throw new CallError("invalid", `${target} is called synchronously (its arguments are never stored)`);
  return resolved;
}
export async function enqueueCall({ tx, ports, origin, target: requestedTarget, raw }: { tx: Db; ports: StewardPorts; origin: CallOrigin; target: string; raw: unknown }, { key, reply = false, lenient = false }: { key: string; reply?: boolean; lenient?: boolean }) {
  const target = currentTarget(requestedTarget);
  const name = splitTarget(target), caller = callerKey(origin.caller);
  const existing = await tx.moduleInvocation.findUnique({ where: { workspaceId_caller_target_tool_key: { workspaceId: origin.workspaceId, caller, target: name.module, tool: name.tool, key } } });
  if (existing) return { callId: existing.id, status: existing.status as "queued", duplicate: true };
  const resolved = await resolveEnqueueTarget(tx, origin, target, lenient);
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

async function deliverModuleRow({ ports, row, resolved, args, caller, path, now, settle, retryOrFail }: { ports: StewardPorts; row: Row; resolved: Target; args: Record<string, unknown>; caller: Caller; path: string[]; now: Date; settle: (data: Prisma.ModuleInvocationUpdateManyMutationInput) => Promise<unknown>; retryOrFail: (error: string) => Promise<unknown> }) {
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
async function deliverRow(ports: StewardPorts, row: Row, token: string) {
  const { db } = ports, now = ports.now();
  const settle = (data: Prisma.ModuleInvocationUpdateManyMutationInput) => db.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: token }, data: { leaseToken: null, leaseUntil: null, ...data } });
  const retryOrFail = (error: string) => settle(row.attempts < MAX_ATTEMPTS ? { status: "queued", nextAttemptAt: backoff(now, row.attempts), error } : { status: "failed", error, finishedAt: now });
  // Rows queued before v2-11 name `ai.*`.
  const target = currentTarget(`${row.target}.${row.tool}`), resolved = await resolveTarget(db, row.workspaceId, target);
  // Not there yet (e.g. a built-in still building) or paused: it never got the call, so trying later is safe.
  if (resolved instanceof CallError) return resolved.code === "unavailable" || resolved.code === "not_found" ? retryOrFail(resolved.message) : settle({ status: "failed", error: resolved.message, finishedAt: now });
  const callerModule = row.callerModuleId ? await db.module.findUnique({ where: { id: row.callerModuleId } }) : null;
  const caller = originOf(row, callerModule);
  if (!await admitted(db, caller, resolved.tool, target)) return settle({ status: "failed", error: "forbidden: the target no longer accepts this caller", finishedAt: now });
  let args;
  try { args = validArgs(resolved.tool, row.args); }
  catch (error) { return settle({ status: "failed", error: message(error), finishedAt: now }); }
  if (resolved.system) {
    try {
      const output = await resolved.system.handle({ ports, workspaceId: row.workspaceId, caller, call: { id: row.id } }, resolved.tool.name, args);
      return settle({ status: "succeeded", output: output as Prisma.InputJsonValue, error: null, finishedAt: ports.now() });
    } catch (error) {
      if (error instanceof AwaitUser) return settle({ status: "waiting", output: error.output as Prisma.InputJsonValue, error: null });
      const failure = systemError(error); return settle({ status: "failed", error: `${failure.code}: ${failure.message}`.slice(0, 2000), finishedAt: ports.now() });
    }
  }
  const path = Array.isArray(row.chain) ? row.chain.filter((name): name is string => typeof name === "string") : [];
  return deliverModuleRow({ ports, row, resolved, args, caller, path, now, settle, retryOrFail });
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
  const requestedAgain = () => state.again;
  state.loop = (async () => {
    try {
      do { state.again = false; while (await runDueCalls(ports, workspaceId) > 0); } while (requestedAgain());
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
