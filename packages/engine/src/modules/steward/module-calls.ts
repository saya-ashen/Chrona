import { assertExpectedTarget, targetFence, bindInvocationTarget, checkInvocationTarget, routedTargetName, splitTarget, resolveTarget, assertRoutedIdentity, type Target } from "./module-call-target";
export { routedTargetName } from "./module-call-target";
import { systemError, systemFailureData, deliveryErrorCode, checkSystemOutput, checkModuleOutput, moduleOutputError, validArgs, stageOf, message } from "./module-call-output";
export { checkSystemOutput, checkModuleOutput, moduleOutputError } from "./module-call-output";
import { appendRunToolResultIn } from "./run-events";
import { randomUUID } from "node:crypto";
import { moduleRequestDigest as requestDigest } from "./module-request-digest";
import { Prisma } from "@chrona/db/generated/prisma/client";
import { MAX_CALL_DEPTH, RUN_LIMITS, type ModuleEvent, expectedModuleTargetSchema, type ExpectedModuleTarget, type RoutedTarget } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { moduleSupervisor } from "./module-supervisor";
import { recordModuleOutputMismatch } from "./module-diagnostics";
import { currentModuleEvolution } from "./module-evolution";
import { StewardError } from "./errors";
import type { SystemTool } from "./module-system-types";
export type { SystemTool, SystemModule } from "./module-system-types";
import { isAgentContextEntry } from "./agent-context-entry";
import { admitted } from "./module-call-admission";
export { admitted } from "./module-call-admission";
export { moduleCallbackContractHash, normalizedToolInputSchema, validateToolArgs, moduleToolExampleError } from "./module-tool-contract";
import { isModulePaused } from "./module-availability";
export { registerLocalModule, registerSystemModule, listSystemModules, listLocalModules } from "./module-registry";

import type { Caller, Json, CallOrigin } from "./module-call-types";
export type { Caller, Json, CallOrigin, Tool } from "./module-call-types";
type Db = StewardPorts["db"] | Prisma.TransactionClient;
import { CallError, publicCallError, publicCallReason } from "./module-call-error";
export { CallError, type CallErrorCode } from "./module-call-error";
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
const MAX_ATTEMPTS = 6;
const BATCH = 20;

const callerIdentity = (caller: Caller) => caller.kind === "module" ? { callerModuleId: caller.moduleId, callerHash: caller.hash } : { callerModuleId: null, callerHash: null };
export function callerKey(caller: Caller) {
  return caller.kind === "module" ? `module:${caller.moduleId}` : caller.kind === "provider" ? `provider:${caller.runId}` : caller.kind === "system" ? `system:${caller.module}` : caller.kind;
}
const callerName = (caller: Caller) => caller.kind === "module" || caller.kind === "system" ? caller.module : null;
export const kernelOrigin = (workspaceId: string): CallOrigin => ({ workspaceId, caller: { kind: "kernel" }, chain: [], path: [] });
export const systemOrigin = (workspaceId: string, module: string): CallOrigin => ({ workspaceId, caller: { kind: "system", module }, chain: [], path: [] });

async function previousCall(db: Db, origin: CallOrigin, target: RoutedTarget, key: string) {
  const identity = typeof target === "string" ? await resolveTarget(db, origin.workspaceId, target) : null;
  return db.moduleInvocation.findFirst({ where: { workspaceId: origin.workspaceId, caller: callerKey(origin.caller), key, ...(typeof target === "string" ? { targetIdentity: identity && !(identity instanceof CallError) ? identity.module.id : splitTarget(target).module, tool: splitTarget(target).tool } : { targetModuleId: target.moduleId, tool: target.tool }) } });
}
const retainedAgentResults = new Set(["register", "run", "write", "stop"]);
const retainsAgentResult = (tool: string) => retainedAgentResults.has(tool);
function privateResult(row: Pick<Row, "target" | "targetIdentity" | "tool">) {
  if (row.target === "agent") return !retainsAgentResult(row.tool);
  if (row.target === "secrets") return ["get", "token", "authorize"].includes(row.tool);
  if (row.target === "activity") return ["facts", "ack", "withdrawals"].includes(row.tool);
  return row.targetIdentity.startsWith("local:");
}
const hasStoredOutput = (row: Row) => row.output !== null || row.status === "succeeded" && !privateResult(row);
function checkDuplicateCall(row: Row, origin: CallOrigin, digest: string, expected?: ExpectedModuleTarget) {
  if (origin.caller.kind === "module" && row.callerHash !== origin.caller.hash) throw new CallError("forbidden", "Call belongs to another application version");
  if (row.requestDigest !== digest) throw new CallError("conflict", "Call key was already used with different arguments");
  checkDuplicateTarget(row, expected);
}
function duplicateReply(row: Row, origin: CallOrigin, digest: string, expected?: ExpectedModuleTarget, privateTransport = false) {
  checkDuplicateCall(row, origin, digest, expected);
  if (privateTransport) throw new CallError("unknown", "Private Provider call was already offered; reconcile the original operation");
  if (row.status === "succeeded" && hasStoredOutput(row)) return { callId: row.id, output: row.output as Json };
  throw new CallError(row.status === "failed" ? publicCallError(row.errorCode ?? "failed") : "unknown", row.error ?? "Original call has not produced a confirmed result", publicCallReason(row.errorReason ?? ""));
}
function nextPath(origin: CallOrigin) {
  const name = callerName(origin.caller);
  return { chain: name ? [...origin.chain, name] : origin.chain, path: name ? [...origin.path, name] : origin.path };
}
function toolEvent(target: Target, args: Record<string, unknown>, now: Date, caller: Caller, call: { id: string; key: string | null; attempt: number; chain: string[]; executionRunId?: string }): ModuleEvent {
  return { trigger: { id: target.tool.name, kind: "tool", firedAt: now.toISOString(), args, caller, call }, now: now.toISOString(), params: {} };
}
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
type SyncInvocation = { ports: StewardPorts; origin: CallOrigin; resolved: Target; target: string; args: Record<string, unknown>; chain: string[]; path: string[]; now: Date; key?: string; activationId?: string | null; privateTransport?: boolean };
async function invokeSystemSync({ ports, origin, resolved, args, rowId, rowKey, finish, quiet }: SyncInvocation & { rowId: string; rowKey?: string; finish?: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown>; quiet: boolean }) {
  // In-process: no event queue to wait on, so no deadlock to guard against.
  try {
    const output = await resolved.system!.handle({ ports, workspaceId: origin.workspaceId, caller: origin.caller, run: origin.run, deadline: origin.deadline, call: { id: rowId, key: rowKey, mode: "sync" } }, resolved.tool.name, args);
    const schema = (resolved.tool as SystemTool).output;
    if (resolved.module.id.startsWith("local:") && schema && !schema.safeParse(output).success) throw new CallError("failed", "Local capability output contract mismatch");
    checkSystemOutput(`${resolved.module.name}.${resolved.tool.name}`, resolved.tool as SystemTool, output);
    await finish?.({ status: "succeeded", output: output as Prisma.InputJsonValue });
    return { callId: rowId, output };
  } catch (error) {
    const failure = resolved.module.id.startsWith("local:") && !(error instanceof CallError) && !(error instanceof StewardError)
      ? new CallError("failed", "Local capability failed") : systemError(error);
    await finish?.(systemFailureData(failure, quiet));
    throw failure;
  }
}
async function deliverSyncModule({ ports, origin, resolved, target, args, chain, path, now, key, timeoutMs, activationId, rowId, finish, privateTransport, transient }: SyncInvocation & { timeoutMs?: number; rowId: string; finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown>; transient: boolean }) {
  try {
    return await moduleSupervisor(ports).deliver(resolved.module.id, resolved.module.activeHash, toolEvent(resolved, args, now, origin.caller, { id: rowId, key: key ?? null, attempt: 1, chain: path, ...(isAgentContextEntry(ports, origin) ? {executionRunId:origin.run!.executionRunId} : {}) }), { chain, path, ...(privateTransport ? { private: true } : {}), ...(transient ? { retainOutput: false } : {}), beforeDelivery: targetFence(ports, origin.workspaceId, resolved, origin.caller), ...(activationId !== undefined ? { activationId } : {}), validateResult: output => moduleOutputError(target, resolved.tool, output), ...(timeoutMs ? { timeoutMs } : {}) });
  } catch (error) {
    // Supervisor activation checks can reject before its callback fence runs. Classify a version switch as conflict too.
    if (stageOf(error) === "unavailable") {
      const current = await ports.db.module.findFirst({ where: { workspaceId: origin.workspaceId, name: resolved.module.name }, select: { id: true, activeHash: true } });
      if (!current || current.id !== resolved.module.id || current.activeHash !== resolved.module.activeHash) {
        error = Object.assign(new CallError("conflict", "Target activation changed before delivery"), { stage: "unavailable" });
      }
    }
    const code = deliveryErrorCode(error), detail = privateTransport ? "Private operation failed" : message(error);
    await finish({ status: code === "unknown" ? "unknown" : "failed", error: `${publicCallError(code)}: ${detail}`, errorCode: publicCallError(code), errorReason: publicCallReason((error as { reason?: string }).reason ?? code) ?? null });
    throw new CallError(publicCallError(code), code === "unknown" ? `${target}: outcome unknown (${detail})` : `${target}: ${detail}`, publicCallReason((error as { reason?: string }).reason ?? code));
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
async function invokeModuleSync({ ports, origin, resolved, target, args, chain, path, now, key, timeoutMs, activationId, rowId, finish, privateTransport }: SyncInvocation & { timeoutMs?: number; rowId: string; finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown> }) {
  let graph = waiting.get(ports.db);
  if (!graph) { graph = new Map(); waiting.set(ports.db, graph); }
  // A detached Agent entry has an identity, but no originating module event waiting on it.
  const name = isAgentContextEntry(ports, origin) ? null : callerName(origin.caller), edges = graph;
  // A keyless module-to-module read can never be replayed, so its result is not kept.
  // Agent tool calls keep theirs: Run transcripts show them.
  const transient = !key && resolved.tool.idempotent === true && origin.caller.kind === "module" && !isAgentContextEntry(ports, origin);
  await addWaitEdge(edges, name, resolved.module.name, target, finish);
  let reply;
  try { reply = await deliverSyncModule({ ports, origin, resolved, target, args, chain, path, now, key, timeoutMs, activationId, rowId, finish, privateTransport, transient }); }
  finally { if (name) removeWaitEdge(edges, name, resolved.module.name); }
  const output = "result" in reply ? reply.result.result ?? null : null;
  try { checkModuleOutput(target, resolved.tool, output); }
  catch (error) {
    await finish({ status: "failed", error: message(error), errorCode: "failed" });
    const issues = (error as { diagnosticIssues?: string[] }).diagnosticIssues;
    if (issues) await recordModuleOutputMismatch(ports.db, { workspaceId: origin.workspaceId, moduleId: resolved.module.id, activationId, hash: resolved.module.activeHash, tool: resolved.tool.name, callId: rowId, issues, now: ports.now() });
    throw error;
  }
  await finish({ status: "succeeded", output: transient ? Prisma.DbNull : output as Prisma.InputJsonValue });
  return { callId: rowId, output: output as Json };
}
async function validateSyncRoute(ports: StewardPorts, origin: CallOrigin, target: string, expectedTarget?: ExpectedModuleTarget) {
  const resolved = await resolveTarget(ports.db, origin.workspaceId, target);
  if (expectedTarget?.hash !== undefined) assertExpectedTarget(resolved, expectedTarget);
  if (resolved instanceof CallError) throw resolved;
  if (!await admitted(ports.db, origin.caller, resolved.tool, origin.workspaceId)) throw new CallError("forbidden", `${target} does not accept calls from this caller`);
  assertExpectedTarget(resolved, expectedTarget);
  const route = isAgentContextEntry(ports, origin) ? { chain: [], path: [] } : nextPath(origin);
  if (route.chain.includes(resolved.module.name)) throw new CallError("cycle", `${target}: ${resolved.module.name} is waiting on this call path (${route.chain.join(" → ")})`);
  if (route.path.length >= MAX_CALL_DEPTH) throw new CallError("cycle", `Call path too deep (${route.path.join(" → ")})`);
  return { resolved, route };
}
function privateInvocationFinish(ports: StewardPorts, id: string, resolved: Target, privateTransport = false) {
  return (data: Prisma.ModuleInvocationUpdateInput) => ports.db.$transaction(async tx => {
    const at = ports.now();
    const row = await tx.moduleInvocation.update({ where: { id }, data: { ...data, ...((privateTransport || unrecorded(resolved) && privateResult({ target: resolved.module.name, targetIdentity: resolved.module.id, tool: resolved.tool.name })) ? { output: Prisma.DbNull, ...(data.error ? { error: "Private operation failed" } : {}) } : {}), finishedAt: at } });
    await appendRunToolResultIn(tx, row, at, privateTransport || unrecorded(resolved) || resolved.module.name === "secrets");
    return row;
  }).catch(() => { throw new CallError("unknown", `Tool receipt could not be committed; reconcile call ${id}`); });
}
function unrecorded(resolved: Target) { return resolved.system?.unrecorded?.includes(resolved.tool.name) || false; }
function createSyncInvocation({ ports, origin, resolved, args, path, now, key }: SyncInvocation, { requestedTarget, digest, quiet }: { requestedTarget: RoutedTarget; digest: string; quiet: boolean }) {
  return ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${origin.workspaceId}`;
    if (key) { const existing = await previousCall(tx, origin, requestedTarget, key); if (existing) return { existing }; }
    return { created: await tx.moduleInvocation.create({ data: { workspaceId: origin.workspaceId, caller: callerKey(origin.caller), ...callerIdentity(origin.caller),
    ...(isAgentContextEntry(ports, origin) ? { runId: origin.run!.executionRunId } : {}),
    target: resolved.module.name, targetIdentity: resolved.module.id, tool: resolved.tool.name, args: (quiet ? {} : args) as Prisma.InputJsonValue, key: key ?? randomUUID(), requestDigest: digest, targetBound: true, targetModuleId: resolved.module.id, targetHash: resolved.module.activeHash, targetContractHash: null, chain: path, mode: "sync", idempotent: resolved.tool.idempotent, status: "running", attempts: 1, createdAt: now } }) };
  });
}
async function executeSyncInvocation({ ports, origin, resolved, target, args, chain, path, now, key, rowId, quiet, timeoutMs, privateTransport }: SyncInvocation & { rowId: string; quiet: boolean; timeoutMs?: number }) {
  const finish = privateInvocationFinish(ports, rowId, resolved, privateTransport);
  const activationId = resolved.system ? undefined : (await currentModuleEvolution(ports.db, origin.workspaceId, resolved.module.id, resolved.module.activeHash))?.activationId ?? null;
  const invocation = { ports, origin, resolved, target, args, chain, path, now, key, privateTransport, ...(activationId !== undefined ? { activationId } : {}) };
  if (resolved.system) return invokeSystemSync({ ...invocation, rowId, rowKey: key, finish, quiet });
  return invokeModuleSync({ ...invocation, timeoutMs, rowId, finish });
}
function assertPrivateTransport(origin: CallOrigin, privateTransport: boolean, expectedHash?: string) {
  if ((privateTransport || expectedHash !== undefined) && origin.caller.kind !== "kernel") throw new CallError("forbidden", "Private Provider transport requires the kernel caller");
}
function assertProviderHash(actual: string | null, expectedHash?: string) {
  if (expectedHash !== undefined && actual !== expectedHash) throw new CallError("conflict", "Provider source version changed before delivery");
}
function assertExpectedRequest(requested: RoutedTarget, expected?: ExpectedModuleTarget) {
  if (typeof requested !== "string" && expected && requested.moduleId !== expected.moduleId) throw new CallError("conflict", "Target and expected identity differ");
}
/** Private Provider transport/expectedHash remain kernel-only; routed expectedTarget is public. */
export async function callSync(ports: StewardPorts, origin: CallOrigin, requestedTarget: RoutedTarget, raw: unknown, { timeoutMs, expectedTarget, key, private: privateTransport = false, expectedHash }: { timeoutMs?: number; expectedTarget?: ExpectedModuleTarget; key?: string; private?: boolean; expectedHash?: string } = {}) {
  assertPrivateTransport(origin, privateTransport, expectedHash);
  const digest = requestDigest({ args: raw, mode: "sync" });
  if (key) {
    const previous = await previousCall(ports.db, origin, requestedTarget, key);
    if (previous) {
      assertProviderHash(previous.targetHash, expectedHash);
      if (previous.target !== "agent") return duplicateReply(previous, origin, digest, expectedTarget, privateTransport);
      // Agent commands reconcile their own durable receipts; reads and stop views remain live.
      checkDuplicateCall(previous, origin, digest, expectedTarget);
    }
  }
  const target = await routedTargetName(ports.db, origin.workspaceId, requestedTarget);
  assertExpectedRequest(requestedTarget, expectedTarget);
  const { resolved, route: { chain, path } } = await validateSyncRoute(ports, origin, target, expectedTarget);
  assertRoutedIdentity(requestedTarget, resolved);
  assertProviderHash(resolved.module.activeHash, expectedHash);
  const args = validArgs(resolved.tool, raw), now = ports.now(), quiet = privateTransport || unrecorded(resolved);
  if (!key && unrecorded(resolved)) {
    return invokeSystemSync({ ports, origin, resolved, target, args, chain, path, now, rowId: randomUUID(), quiet });
  }
  const row = await createSyncInvocation({ ports, origin, resolved, target, args, chain, path, now, key }, { requestedTarget, digest, quiet });
  if ("existing" in row) {
    const existing = row.existing!;
    if (resolved.module.name !== "agent") return duplicateReply(existing, origin, digest, expectedTarget, privateTransport);
    checkDuplicateCall(existing, origin, digest, expectedTarget);
    return executeSyncInvocation({ ports, origin, resolved, target, args, chain, path, now, key, rowId: existing.id, quiet, timeoutMs, privateTransport });
  }
  return executeSyncInvocation({ ports, origin, resolved, target, args, chain, path, now, key, rowId: row.created.id, quiet, timeoutMs, privateTransport });
}

/**
 * Stores an async call in the caller's transaction (an outbox): it commits with the caller's own writes.
 * A repeated `key` from the same caller returns the stored call. Internal kernel/system calls may name an inactive target for delivery-time resolution.
 * Other module calls must name an active, admitting target.
 */
async function resolveEnqueueTarget(tx: Db, origin: CallOrigin, target: string) {
  const resolved = await resolveTarget(tx, origin.workspaceId, target);
  if (resolved instanceof CallError) {
    if (origin.caller.kind !== "kernel" && origin.caller.kind !== "system") throw resolved;
  } else if (!await admitted(tx, origin.caller, resolved.tool, origin.workspaceId)) throw new CallError("forbidden", `${target} does not accept calls from this caller`);
  else if (resolved.system?.unrecorded?.includes(resolved.tool.name)) throw new CallError("invalid", `${target} is called synchronously (its arguments are never stored)`);
  return resolved;
}
type EnqueueInput = { tx: Db; ports: StewardPorts; origin: CallOrigin; target: RoutedTarget; raw: unknown };
type EnqueueOptions = { key: string; reply?: boolean; expectedTarget?: ExpectedModuleTarget };
type EnqueuedCall = { callId: string; status: "queued"; duplicate: boolean };
export async function enqueueCall(input: EnqueueInput, options: EnqueueOptions): Promise<EnqueuedCall> {
  // Prisma transaction proxies may expose $transaction too. Enter at most once; never redispatch recursively.
  const client = input.tx as StewardPorts["db"];
  return typeof client.$transaction === "function"
    ? client.$transaction(tx => enqueueIn({ ...input, tx }, options))
    : enqueueIn(input, options);
}
function checkDuplicateTarget(binding: { targetModuleId: string | null; targetHash: string | null }, expectedTarget?: ExpectedModuleTarget) {
  if (!expectedTarget) return;
  const parsed = expectedModuleTargetSchema.safeParse(expectedTarget);
  if (!parsed.success) throw new CallError("invalid", "Invalid expected target identity");
  if (binding.targetModuleId !== parsed.data.moduleId || parsed.data.hash !== undefined && binding.targetHash !== parsed.data.hash) throw new CallError("conflict", "Duplicate key belongs to a different registered target or version");
}
function duplicateEnqueuedCall(existing: Row, origin: CallOrigin, digest: string, expectedTarget?: ExpectedModuleTarget): EnqueuedCall {
  if (existing.requestDigest !== digest) throw new CallError("conflict", "Call key was already used with different arguments");
  if (origin.caller.kind === "module" && existing.callerHash !== origin.caller.hash) throw new CallError("forbidden", "Call belongs to another application version");
  checkDuplicateTarget(existing, expectedTarget);
  return { callId: existing.id, status: existing.status as "queued", duplicate: true };
}
async function enqueueIn({ tx, ports, origin, target: requestedTarget, raw }: EnqueueInput, { key, reply = false, expectedTarget }: EnqueueOptions): Promise<EnqueuedCall> {
  if (origin.caller.kind === "module" && isModulePaused(origin.caller.module)) throw new CallError("forbidden", "Paused modules cannot enqueue calls");
  const digest = requestDigest({ args: raw, mode: "async", reply }), existing = await previousCall(tx, origin, requestedTarget, key);
  if (existing) {
    return duplicateEnqueuedCall(existing, origin, digest, expectedTarget);
  }
  const target = await routedTargetName(tx, origin.workspaceId, requestedTarget), name = splitTarget(target), caller = callerKey(origin.caller);
  const resolved = await resolveEnqueueTarget(tx, origin, target);
  assertExpectedTarget(resolved, expectedTarget);
  assertRoutedIdentity(requestedTarget, resolved);
  const { path } = nextPath(origin);
  if (path.length >= MAX_CALL_DEPTH) throw new CallError("cycle", `Call path too deep (${path.join(" → ")})`);
  const args = resolved instanceof CallError ? raw : validArgs(resolved.tool, raw), now = ports.now();
  const row = await tx.moduleInvocation.create({ data: { workspaceId: origin.workspaceId, caller, ...callerIdentity(origin.caller),
    target: name.module, targetIdentity: resolved instanceof CallError ? name.module : resolved.module.id, targetHash: expectedTarget?.hash ?? null, tool: name.tool, args: (args ?? {}) as Prisma.InputJsonValue, key, requestDigest: digest, chain: path, mode: "async", idempotent: resolved instanceof CallError ? false : resolved.tool.idempotent,
    reply: reply && origin.caller.kind === "module", nextAttemptAt: now, createdAt: now } });
  await bindInvocationTarget(tx, { workspaceId: origin.workspaceId, callId: row.id, resolved, target });
  return { callId: row.id, status: "queued" as const, duplicate: false };
}

/** An async call's state, readable only by the caller that made it. */
export async function callStatus(ports: StewardPorts, origin: CallOrigin, selector: string | { callId: string } | { target: RoutedTarget; key: string }) {
  const row = typeof selector === "object" && "target" in selector ? await previousCall(ports.db, origin, selector.target, selector.key) : await ports.db.moduleInvocation.findFirst({ where: { id: typeof selector === "string" ? selector : selector.callId, workspaceId: origin.workspaceId, caller: callerKey(origin.caller) } });
  if (!row) throw new CallError("not_found", "Call not found");
  if (origin.caller.kind === "module" && row.callerHash !== origin.caller.hash) throw new CallError("forbidden", "Call belongs to another application version");
  return { callId: row.id, status: row.status as "queued", ...(hasStoredOutput(row) ? { output: row.output as Json } : {}), ...(row.error ? { error: row.error } : {}) };
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
    const activationId = (await currentModuleEvolution(ports.db, row.workspaceId, resolved.module.id, resolved.module.activeHash))?.activationId ?? null;
    const reply = await moduleSupervisor(ports).deliver(resolved.module.id, resolved.module.activeHash, toolEvent(resolved, args, now, caller, { id: row.id, key: row.key, attempt: row.attempts, chain: path, ...(row.runId ? {executionRunId:row.runId} : {}) }), { chain: [], path, activationId, beforeDelivery: targetFence(ports, row.workspaceId, resolved, caller), validateResult: output => moduleOutputError(`${resolved.module.name}.${resolved.tool.name}`, resolved.tool, output) });
    const output = "result" in reply ? reply.result.result ?? null : null;
    try { checkModuleOutput(`${resolved.module.name}.${resolved.tool.name}`, resolved.tool, output); }
    catch (error) {
      const issues = (error as { diagnosticIssues?: string[] }).diagnosticIssues;
      if (issues) await recordModuleOutputMismatch(ports.db, { workspaceId: row.workspaceId, moduleId: resolved.module.id, activationId, hash: resolved.module.activeHash, tool: resolved.tool.name, callId: row.id, issues, now: ports.now() });
      return settle({ status: "failed", error: message(error), finishedAt: ports.now() });
    }
    return settle({ status: "succeeded", output: output as Prisma.InputJsonValue, error: null, finishedAt: ports.now() });
  } catch (error) {
    const stage = stageOf(error);
    if (stage === "unavailable" && row.targetHash !== null) {
      const current = await ports.db.module.findFirst({ where: { workspaceId: row.workspaceId, name: row.target }, select: { id: true, activeHash: true } });
      if (!current || current.id !== row.targetModuleId || current.activeHash !== row.targetHash) return settle({ status: "failed", error: "conflict: queued target version changed before delivery", errorCode: "conflict", finishedAt: ports.now() });
    }
    if (stage === "unavailable" && error instanceof CallError && error.code === "conflict") return settle({ status: "failed", error: `conflict: ${message(error)}`, errorCode: "conflict", finishedAt: ports.now() });
    if (stage === "unavailable") return retryOrFail(message(error));
    if (stage === "handler") return settle({ status: "failed", error: message(error), finishedAt: ports.now() });
    // Sent but no answer: the target may have acted. Only an idempotent target is asked again.
    if (resolved.tool.idempotent && row.attempts < MAX_ATTEMPTS) return settle({ status: "queued", idempotent: true, nextAttemptAt: backoff(now, row.attempts), error: message(error) });
    return settle({ status: "unknown", error: `Outcome unknown: ${message(error)}`, finishedAt: ports.now() });
  }
}
async function deliverSystemRow(ports: StewardPorts, row: Row, input: { resolved: Target; caller: Caller; args: Record<string, unknown>; settle: (data: Prisma.ModuleInvocationUpdateManyMutationInput) => Promise<unknown> }) {
  const { resolved, caller, args, settle } = input;
  try {
    const output = await resolved.system!.handle({ ports, workspaceId: row.workspaceId, caller, call: { id: row.id, key: row.key, mode: "async" } }, resolved.tool.name, args);
    checkSystemOutput(`${row.target}.${row.tool}`, resolved.tool as SystemTool, output);
    return settle({ status: "succeeded", output: output as Prisma.InputJsonValue, error: null, finishedAt: ports.now() });
  } catch (error) {
    if (error instanceof AwaitUser) return settle({ status: "waiting", output: error.output as Prisma.InputJsonValue, error: null });
    return settle({ ...systemFailureData(systemError(error)), finishedAt: ports.now() });
  }
}
const missingCaller = (row: Row, module: { workspaceId: string } | null) => row.callerModuleId && (!module || module.workspaceId !== row.workspaceId);
async function deliverRow(ports: StewardPorts, row: Row, token: string) {
  const { db } = ports, now = ports.now();
  const settle = (data: Prisma.ModuleInvocationUpdateManyMutationInput) => db.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: token }, data: { leaseToken: null, leaseUntil: null, ...data } });
  const retryOrFail = (error: string) => settle(row.attempts < MAX_ATTEMPTS ? { status: "queued", nextAttemptAt: backoff(now, row.attempts), error } : { status: "failed", error, finishedAt: now });
  let resolved: Target, caller: Caller, args: Record<string, unknown>;
  try {
    const target = `${row.target}.${row.tool}`, candidate = await resolveTarget(db, row.workspaceId, target);
    // A removed tool must not hide a changed pinned activation behind not_found/unavailable retries.
    if (candidate instanceof CallError && row.targetHash !== null) {
      const current = await db.module.findFirst({ where: { workspaceId: row.workspaceId, name: row.target }, select: { id: true, activeHash: true } });
      if (!current || current.id !== row.targetModuleId || current.activeHash !== row.targetHash) return settle({ status: "failed", error: "conflict: queued target version changed", errorCode: "conflict", finishedAt: now });
    }
    // Not there yet (e.g. a built-in still building) or paused: it never got the call, so trying later is safe.
    if (candidate instanceof CallError) return candidate.code === "unavailable" || candidate.code === "not_found" ? retryOrFail(candidate.message) : settle({ status: "failed", error: candidate.message, finishedAt: now });
    resolved = candidate;
    if (!await checkInvocationTarget(ports, row, resolved)) return settle({ status: "failed", error: "conflict: queued callback target identity or contract changed; register again", errorCode: "conflict", finishedAt: now });
    const callerModule = row.callerModuleId ? await db.module.findUnique({ where: { id: row.callerModuleId } }) : null;
    if (missingCaller(row, callerModule)) return settle({ status: "failed", error: "forbidden: original caller no longer exists", finishedAt: now });
    caller = originOf(row, callerModule);
    if (!await admitted(db, caller, resolved.tool, row.workspaceId)) return settle({ status: "failed", error: "forbidden: the target no longer accepts this caller", finishedAt: now });
    try { args = validArgs(resolved.tool, row.args); }
    catch (error) { return settle({ status: "failed", error: message(error), finishedAt: now }); }
  } catch (error) {
    console.error(JSON.stringify({ component: "module-calls", event: "call.pre_delivery_failed",
      callId: row.id, workspaceId: row.workspaceId, error: String(error).slice(0, 2000) }));
    return retryOrFail(`pre-delivery: ${String(error).slice(0, 500)}`);
  }
  if (resolved.system) return deliverSystemRow(ports, row, { resolved, caller, args, settle });
  const path = Array.isArray(row.chain) ? row.chain.filter((name): name is string => typeof name === "string") : [];
  return deliverModuleRow({ ports, row, resolved, args, caller, path, now, settle, retryOrFail });
}
function replyTarget(row: Row): RoutedTarget {
  return row.targetModuleId && !row.targetModuleId.startsWith("system:") ? { moduleId: row.targetModuleId, tool: row.tool } : `${row.target}.${row.tool}`;
}
async function replyRow(ports: StewardPorts, row: Row) {
  const { db } = ports;
  const module = row.callerModuleId ? await db.module.findUnique({ where: { id: row.callerModuleId } }) : null;
  if (module && (isModulePaused(module.name) || module.status !== "active" || !module.activeHash)) return;
  const claimed = await db.moduleInvocation.updateMany({ where: { id: row.id, repliedAt: null, replyAttempts: row.replyAttempts }, data: { replyAttempts: { increment: 1 } } });
  if (!claimed.count || !module || !module.activeHash) return;
  const now = ports.now();
  const event: ModuleEvent = { trigger: { kind: "call_result", id: "call", firedAt: now.toISOString(), callId: row.id, target: replyTarget(row), key: row.key, status: row.status as "succeeded",
    ...(hasStoredOutput(row) ? { output: row.output as Json } : {}), ...(row.error ? { error: row.error.slice(0, 2000) } : {}) }, now: now.toISOString(), params: {} };
  const path = Array.isArray(row.chain) ? row.chain.filter((name): name is string => typeof name === "string") : [];
  try {
    await moduleSupervisor(ports).deliver(module.id, module.activeHash, event, { chain: [], path });
    await db.moduleInvocation.update({ where: { id: row.id }, data: { repliedAt: ports.now() } });
  } catch (error) {
    // The caller can still read the result with callStatus; replies are retried a few times.
    console.error(JSON.stringify({ component: "module-calls", event: "call_result.delivery_failed",
      callId: row.id, callerModuleId: row.callerModuleId, error: String(error).slice(0, 2000) }));
  }
}

/** One pass over the workspace's async calls: recover expired leases, deliver due calls, send results back. */
export async function runDueCalls(ports: StewardPorts, workspaceId: string) {
  const { db } = ports, now = ports.now();
  for (const row of await db.moduleInvocation.findMany({ where: { workspaceId, mode: "async", status: "running", leaseUntil: { lte: now } } })) {
    // Chrona stopped or lost the delivery mid-flight: the target may have acted.
    const identityBound = row.targetBound && row.targetModuleId !== null;
    await db.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: row.leaseToken }, data: identityBound && row.idempotent && row.attempts < MAX_ATTEMPTS
      ? { status: "queued", leaseToken: null, leaseUntil: null, nextAttemptAt: now, error: "Delivery interrupted; retrying an idempotent call" }
      : { status: "unknown", leaseToken: null, leaseUntil: null, error: "Delivery interrupted; outcome unknown", finishedAt: now } });
  }
  let delivered = 0;
  for (const row of await db.moduleInvocation.findMany({ where: { workspaceId, mode: "async", status: "queued", nextAttemptAt: { lte: now } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH })) {
    const token = randomUUID();
    const claimed = await db.moduleInvocation.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "running", leaseToken: token, leaseUntil: new Date(now.getTime() + RUN_LIMITS.jobTimeoutMs * 10 + 60_000), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    await deliverRow(ports, { ...row, status: "running", leaseToken: token, attempts: row.attempts + 1 }, token);
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
