import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { grantedUses, MAX_CALL_DEPTH, moduleManifestSchema, RUN_LIMITS, type callerSchema, type ModuleEvent, type ModuleManifest, type ModuleSetting, type SessionSource, expectedModuleTargetSchema, type ExpectedModuleTarget } from "@chrona/contracts/steward";
import { z } from "zod";
import { compileModuleOutput } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { moduleSupervisor, type DeliveryStage } from "./module-supervisor";
import { recordModuleOutputMismatch } from "./module-diagnostics";
import { currentModuleEvolution } from "./module-evolution";
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
export type CallErrorCode = (typeof import("@chrona/contracts/steward").MODULE_CALL_ERRORS)[number];
export class CallError extends Error {
  constructor(public readonly code: CallErrorCode, message: string) { super(message); this.name = "CallError"; }
}
/**
 * A system module: part of Chrona, in-process. Its tools are declared like a module's and reached by the same routed
 * calls (visibility, recorded caller, async queue); its code is Chrona's, so it is never proposed,
 * built, sandboxed or paused, and its name is reserved.
 */
/** `unrecorded`: tools called only synchronously whose arguments and results are never stored (credentials, model prompts and completions). */
/** A system tool may validate with a full schema (`input`) instead of scalar parameters: system modules are Chrona's own code. */
export type SystemTool = Omit<Tool, "output" | "examples"> & { input?: z.ZodType; output?: z.ZodType; documentation?: string; examples?: Json[]; sideEffects?: string[]; errors?: { code: string; description: string; recovery: string }[] };
type RoutedTool = Pick<Tool, "name" | "description" | "parameters" | "visibility" | "idempotent"> & { output?: unknown; examples?: unknown; sideEffects?: unknown; errors?: unknown };
/**
 * `call`: the async call being delivered (absent for sync calls). v2-20: `description` and `sessions` (the conversation
 * source a system module does its work in) show it to the user as a read-only app.
 */
/** v2-23: settings a system module shows on its app page; values live in the owner's Settings (read/write map them). */
export type SystemSettings = { declarations: Record<string, ModuleSetting>; read(settings: unknown): Record<string, string | number | boolean>; write(values: Record<string, unknown>): Record<string, unknown> };
export type SystemModule = { name: string; description: string; sessions?: SessionSource; settings?: SystemSettings; tools: SystemTool[]; unrecorded?: string[]; handle(context: { ports: StewardPorts; workspaceId: string; caller: Caller; run?: CallOrigin["run"]; deadline?: number; call?: { id: string } }, tool: string, args: Record<string, unknown>): Promise<Json> };
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
const localModules = new Map<string, SystemModule>();
/** Trusted release modules share the router; their state belongs to each runtime, never this registry. */
export function registerLocalModule(module: SystemModule) {
  if (systemModules.has(module.name)) throw new Error(`Local module conflicts with kernel interface ${module.name}`);
  localModules.set(module.name, module);
}
export function registerSystemModule(module: SystemModule) {
  if (localModules.has(module.name)) throw new Error(`Kernel interface conflicts with local module ${module.name}`);
  systemModules.set(module.name, module);
}
/** System modules and their tools, for catalogs (v2-13: the Provider reaches those visible to it). */
export const listSystemModules = () => [...systemModules.values()];
type Target = { module: { id: string; name: string; activeHash: string; workspaceId: string }; tool: RoutedTool; system?: SystemModule };
/** Exact callback shape, independent of source/version hash; compatible code updates keep queued calls valid. */
export function moduleCallbackContractHash(tool: Tool | SystemTool) {
  const input = "input" in tool && tool.input ? z.toJSONSchema(tool.input) : normalizedToolInputSchema(tool);
  const output = tool.output instanceof z.ZodType ? z.toJSONSchema(tool.output) : tool.output ?? null;
  return createHash("sha256").update(JSON.stringify({ input, output, visibility: [...tool.visibility].sort(), idempotent: tool.idempotent })).digest("hex");
}
function assertExpectedTarget(resolved: Target | CallError, expected?: ExpectedModuleTarget) {
  if (!expected) return;
  const parsed = expectedModuleTargetSchema.safeParse(expected);
  if (!parsed.success) throw new CallError("invalid", "Invalid expected target identity");
  if (resolved instanceof CallError || resolved.module.id !== parsed.data.moduleId || moduleCallbackContractHash(resolved.tool as Tool | SystemTool) !== parsed.data.contractHash) throw new CallError("conflict", "Registered target identity or contract changed; register again");
}
/** Kernel-only closure used at the supervisor's final never-sent boundary. */
function targetFence(ports: StewardPorts, workspaceId: string, resolved: Target, caller: Caller) {
  return async () => {
    const current = await resolveTarget(ports.db, workspaceId, `${resolved.module.name}.${resolved.tool.name}`);
    try {
      assertExpectedTarget(current, { moduleId: resolved.module.id, contractHash: moduleCallbackContractHash(resolved.tool as Tool | SystemTool) });
      if (current instanceof CallError || current.module.activeHash !== resolved.module.activeHash) throw new CallError("conflict", "Target activation changed before delivery");
      if (!await admitted(ports.db, caller, current.tool)) throw new CallError("forbidden", "Target no longer accepts this caller");
    } catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { stage: "unavailable" }); }
  };
}
const targetBindingId = (callId: string) => `module-invocation-target:${callId}`;
async function bindInvocationTarget(tx: Db, input: { workspaceId: string; callId: string; resolved: Target | CallError; target: string; now: Date }) {
  const { workspaceId, callId, resolved, target, now } = input;
  // An unavailable known app still has an identity. Bind it before a later same-name reinstall can take over.
  const module = resolved instanceof CallError ? await tx.module.findFirst({ where: { workspaceId, name: splitTarget(target).module } }) : resolved.module;
  let contractHash: string | null = resolved instanceof CallError ? null : moduleCallbackContractHash(resolved.tool as Tool | SystemTool);
  // Pause affects delivery, not identity: freeze a known tool's contract even while unavailable.
  if (resolved instanceof CallError && module?.activeHash) {
    const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
    const tool = moduleManifestSchema.safeParse(version?.manifest).data?.tools.find(tool => tool.name === splitTarget(target).tool);
    if (tool) contractHash = moduleCallbackContractHash(tool);
  }
  // Explicit null identity authorizes only a never-sent missing target to bind later; absence is legacy, not permission.
  const binding = { moduleId: module?.id ?? null, contractHash };
  await tx.audit.create({ data: { id: targetBindingId(callId), workspaceId, actorKey: "kernel", kind: "module_invocation_target", subjectId: callId, details: binding, createdAt: now } });
}
const differentBinding = (binding: { moduleId: string | null; contractHash: string | null }, current: { moduleId: string; contractHash: string }) =>
  binding.moduleId !== null && binding.moduleId !== current.moduleId || binding.contractHash !== null && binding.contractHash !== current.contractHash;
const differentActivation = (active: Target | CallError, resolved: Target, contractHash: string) =>
  active instanceof CallError || active.module.id !== resolved.module.id || active.module.activeHash !== resolved.module.activeHash || moduleCallbackContractHash(active.tool as Tool | SystemTool) !== contractHash;
async function checkInvocationTarget(ports: StewardPorts, row: Row, resolved: Target) {
  return ports.db.$transaction(async tx => {
    const previous = await tx.audit.findUnique({ where: { id: targetBindingId(row.id) } });
    if (!previous) return false; // No migration or inference for legacy calls lacking attribution.
    const parsed = z.object({ moduleId: z.string().nullable(), contractHash: z.string().nullable() }).strict().safeParse(previous.details);
    if (!parsed.success) return false;
    const current = { moduleId: resolved.module.id, contractHash: moduleCallbackContractHash(resolved.tool as Tool | SystemTool) };
    const binding = parsed.data;
    if (differentBinding(binding, current)) return false;
    // Resolve and claim the exact identity inside the transaction. Supervisor rechecks id/hash before sending.
    const active = await resolveTarget(tx, row.workspaceId, `${row.target}.${row.tool}`);
    if (differentActivation(active, resolved, current.contractHash)) return false;
    const claimed = await tx.moduleInvocation.findFirst({ where: { id: row.id, workspaceId: row.workspaceId, status: "running", leaseToken: row.leaseToken } });
    if (!claimed) return false;
    if (binding.moduleId === null || binding.contractHash === null) await tx.audit.update({ where: { id: previous.id }, data: { details: current } });
    await tx.moduleInvocation.update({ where: { id: row.id }, data: { idempotent: resolved.tool.idempotent } });
    return true;
  });
}
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
async function resolveReleaseTarget(db: Db, workspaceId: string, target: string, name: ReturnType<typeof splitTarget>): Promise<Target | CallError | null> {
  const local = localModules.get(name.module), system = local ?? systemModules.get(name.module);
  if (!system) return null;
  if (local && await db.module.findFirst({ where: { workspaceId, name: name.module }, select: { id: true } })) return new CallError("conflict", `Local capability ${name.module} conflicts with an installed application`);
  const tool = system.tools.find(candidate => candidate.name === name.tool);
  return tool ? { module: { id: `${local ? "local" : "system"}:${system.name}`, name: system.name, activeHash: "system", workspaceId }, tool, system } : new CallError("not_found", `Tool ${target} not found`);
}
async function resolveTarget(db: Db, workspaceId: string, target: string): Promise<Target | CallError> {
  const name = splitTarget(target), release = await resolveReleaseTarget(db, workspaceId, target, name);
  if (release) return release;
  const module = await db.module.findFirst({ where: { workspaceId, name: name.module } });
  if (!module) return new CallError("not_found", `Module ${name.module} not found`);
  if (module.status !== "active" || !module.activeHash) return new CallError("unavailable", `Module ${name.module} is not active`);
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
  const tool = manifest?.tools.find(candidate => candidate.name === name.tool);
  if (!manifest || !tool) return new CallError("not_found", `Tool ${target} not found`);
  return { module: { ...module, activeHash: module.activeHash }, tool };
}
/** Visibility defines the audience; `uses` is a contract, except `*` also reaches owner tools. */
export async function admitted(db: Db, caller: Caller, tool: RoutedTool) {
  if (!callerName(caller)) return tool.visibility.includes(caller.kind as Tool["visibility"][number]);
  if (tool.visibility.includes("modules")) return true;
  if (caller.kind !== "module" || !tool.visibility.includes("owner")) return false;
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.moduleId, hash: caller.hash } } });
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
  return !!manifest && grantedUses(manifest).includes("*");
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
function parameterValidator(parameter: import("@chrona/contracts/steward").ModuleToolParameter): z.ZodType {
  let schema: z.ZodType;
  switch (parameter.type) {
    case "string": schema = parameter.enum ? z.enum(parameter.enum as [string, ...string[]]) : z.string(); break;
    case "number": schema = z.number(); break;
    case "boolean": schema = z.boolean(); break;
    case "array": schema = z.array(parameterValidator(parameter.items)); break;
    case "object": schema = objectValidator(parameter); break;
  }
  return parameter.description ? schema.describe(parameter.description) : schema;
}
function objectValidator(parameter: Extract<import("@chrona/contracts/steward").ModuleToolParameter, { type: "object" }>): z.ZodType {
  const properties = Object.fromEntries(Object.entries(parameter.properties).map(([key, value]) => {
    const schema = parameterValidator(value);
    return [key, (parameter.required ?? []).includes(key) ? schema : schema.optional()];
  }));
  return parameter.additionalProperties ? z.object(properties).catchall(z.unknown()) : z.object(properties).strict();
}
/** A module tool's arguments against its declared recursive parameters. */
export function validateToolArgs(tool: Tool, raw: unknown): Record<string, unknown> {
  const shape = Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, property]) => {
    const schema = parameterValidator(property);
    return [key, tool.parameters.required.includes(key) ? schema : schema.optional()];
  }));
  const parsed = z.object(shape).strict().safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map(issue => {
      const path = issue.path.map(part => String(part).replace(/[^A-Za-z0-9_$-]/g, "?").slice(0, 40)).join(".");
      const keys = issue.code === "unrecognized_keys" ? issue.keys.slice(0, 5).map(key => key.replace(/[^A-Za-z0-9_$-]/g, "?").slice(0, 40)).join(", ") : "";
      return `${path || keys || "$"} (${issue.code})`;
    });
    throw new StewardError("invalid", `Invalid tool arguments${issues.length ? `: ${issues.join("; ")}` : ""}`.slice(0, 500));
  }
  return parsed.data as Record<string, unknown>;
}
export function moduleToolExampleError(tool: Tool): string | null {
  for (const [index, example] of (tool.examples ?? []).entries()) {
    try { validateToolArgs(tool, example.args); }
    catch (cause) { return `Tool ${tool.name} example ${index + 1} arguments are invalid: ${cause instanceof Error ? cause.message : "check its input schema"}`; }
    if (Object.hasOwn(example, "result")) {
      if (!tool.output) return `Tool ${tool.name} example ${index + 1} declares a result but the tool has no output schema`;
      const parsed = compileModuleOutput(tool.output).safeParse(example.result);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue.path.map(part => String(part).replace(/[^A-Za-z0-9_$-]/g, "?").slice(0, 40)).join(".") || "$";
        return `Tool ${tool.name} example ${index + 1} result does not match output schema at ${path} (${issue.code})`;
      }
    }
  }
  return null;
}
/** JSON Schema advertised to consumers mirrors runtime validation at every object boundary. */
export function normalizedToolInputSchema(tool: { parameters: Tool["parameters"] }) {
  const normalize = (parameter: import("@chrona/contracts/steward").ModuleToolParameter): Record<string, unknown> => {
    if (parameter.type === "array") return { type: "array", ...(parameter.description ? { description: parameter.description } : {}), items: normalize(parameter.items) };
    if (parameter.type === "object") return { type: "object", ...(parameter.description ? { description: parameter.description } : {}), properties: Object.fromEntries(Object.entries(parameter.properties).map(([key, value]) => [key, normalize(value)])), required: parameter.required ?? [], additionalProperties: parameter.additionalProperties };
    return { ...parameter };
  };
  return { type: "object", properties: Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, value]) => [key, normalize(value)])), required: tool.parameters.required, additionalProperties: false };
}
/** v2-25: a system tool's output against its declared `output`. A mismatch is Chrona's own bug: logged, never failing the caller (tests fail). */
export function checkSystemOutput(target: string, tool: SystemTool, output: unknown) {
  const result = tool.output?.safeParse(output);
  if (!result || result.success) return;
  const issues = result.error.issues.slice(0, 5).map(issue => `${issue.path.join(".")}: ${issue.message}`);
  if (process.env.NODE_ENV === "test") throw new Error(`${target} output does not match its declared output: ${issues.join("; ")}`);
  console.error(JSON.stringify({ component: "module-calls", event: "call.output_mismatch", target, issues }));
}
export function moduleOutputError(target: string, tool: RoutedTool, output: unknown) {
  try { checkModuleOutput(target, tool, output); return null; }
  catch (error) { return message(error); }
}
export function checkModuleOutput(target: string, tool: RoutedTool, output: unknown) {
  if (!tool.output) return;
  const result = compileModuleOutput(tool.output as Record<string, unknown>).safeParse(output);
  if (result.success) return;
  const issues = result.error.issues.slice(0, 5).map(issue => {
    const path = issue.path.map(part => typeof part === "number" ? String(part) : String(part).replace(/[^A-Za-z0-9_$-]/g, "?").slice(0, 40)).join(".").slice(0, 120) || "$";
    return `${path} (${issue.code})`;
  });
  const error = new CallError("failed", `${target}: output contract mismatch${issues.length ? `: ${issues.join("; ")}` : ""}`) as CallError & { diagnosticIssues: string[] };
  error.diagnosticIssues = issues;
  throw error;
}
function validArgs(tool: RoutedTool, raw: unknown) {
  try { return (tool as SystemTool).input ? parseInput((tool as SystemTool).input!, raw) as Record<string, unknown> : validateToolArgs(tool as Tool, raw); }
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
type SyncInvocation = { ports: StewardPorts; origin: CallOrigin; resolved: Target; target: string; args: Record<string, unknown>; chain: string[]; path: string[]; now: Date; activationId?: string | null };
async function invokeSystemSync({ ports, origin, resolved, args, rowId, finish, quiet }: SyncInvocation & { rowId: string; finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown>; quiet: boolean }) {
  // In-process: no event queue to wait on, so no deadlock to guard against.
  try {
    const output = await resolved.system!.handle({ ports, workspaceId: origin.workspaceId, caller: origin.caller, run: origin.run, deadline: origin.deadline }, resolved.tool.name, args);
    const schema = (resolved.tool as SystemTool).output;
    if (resolved.module.id.startsWith("local:") && schema && !schema.safeParse(output).success) throw new CallError("failed", "Local capability output contract mismatch");
    checkSystemOutput(`${resolved.module.name}.${resolved.tool.name}`, resolved.tool as SystemTool, output);
    await finish({ status: "succeeded", output: (quiet ? {} : output) as Prisma.InputJsonValue });
    return { callId: rowId, output };
  } catch (error) {
    const failure = resolved.module.id.startsWith("local:") && !(error instanceof CallError) && !(error instanceof StewardError)
      ? new CallError("failed", "Local capability failed") : systemError(error);
    await finish({ status: failure.code === "unknown" ? "unknown" : "failed", error: quiet ? failure.code : `${failure.code}: ${failure.message}`.slice(0, 2000) });
    throw failure;
  }
}
async function deliverSyncModule({ ports, origin, resolved, target, args, chain, path, now, timeoutMs, activationId, rowId, finish }: SyncInvocation & { timeoutMs?: number; rowId: string; finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown> }) {
  try {
    return await moduleSupervisor(ports).deliver(resolved.module.id, resolved.module.activeHash, toolEvent(resolved, args, now, origin.caller, { id: rowId, key: null, attempt: 1, chain: path }), { chain, path, beforeDelivery: targetFence(ports, origin.workspaceId, resolved, origin.caller), ...(activationId !== undefined ? { activationId } : {}), validateResult: output => moduleOutputError(target, resolved.tool, output), ...(timeoutMs ? { timeoutMs } : {}) });
  } catch (error) {
    const stage = stageOf(error), code = stage === "unavailable" ? "unavailable" : stage === "handler" ? (error as { code?: CallErrorCode }).code ?? "failed" : "unknown";
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
async function invokeModuleSync({ ports, origin, resolved, target, args, chain, path, now, timeoutMs, activationId, rowId, finish }: SyncInvocation & { timeoutMs?: number; rowId: string; finish: (data: Prisma.ModuleInvocationUpdateInput) => Promise<unknown> }) {
  let graph = waiting.get(ports.db);
  if (!graph) { graph = new Map(); waiting.set(ports.db, graph); }
  const name = callerName(origin.caller), edges = graph;
  await addWaitEdge(edges, name, resolved.module.name, target, finish);
  let reply;
  try { reply = await deliverSyncModule({ ports, origin, resolved, target, args, chain, path, now, timeoutMs, activationId, rowId, finish }); }
  finally { if (name) removeWaitEdge(edges, name, resolved.module.name); }
  const output = "result" in reply ? reply.result.result ?? null : null;
  try { checkModuleOutput(target, resolved.tool, output); }
  catch (error) {
    await finish({ status: "failed", error: message(error) });
    const issues = (error as { diagnosticIssues?: string[] }).diagnosticIssues;
    if (issues) await recordModuleOutputMismatch(ports.db, { workspaceId: origin.workspaceId, moduleId: resolved.module.id, activationId, hash: resolved.module.activeHash, tool: resolved.tool.name, callId: rowId, issues, now: ports.now() });
    throw error;
  }
  await finish({ status: "succeeded", output: output as Prisma.InputJsonValue });
  return { callId: rowId, output: output as Json };
}
async function validateSyncRoute(ports: StewardPorts, origin: CallOrigin, target: string, expectedTarget?: ExpectedModuleTarget) {
  const resolved = await resolveTarget(ports.db, origin.workspaceId, target);
  if (resolved instanceof CallError) throw resolved;
  if (!await admitted(ports.db, origin.caller, resolved.tool)) throw new CallError("forbidden", `${target} does not accept calls from this caller`);
  assertExpectedTarget(resolved, expectedTarget);
  const route = nextPath(origin);
  if (route.chain.includes(resolved.module.name)) throw new CallError("cycle", `${target}: ${resolved.module.name} is waiting on this call path (${route.chain.join(" → ")})`);
  if (route.path.length >= MAX_CALL_DEPTH) throw new CallError("cycle", `Call path too deep (${route.path.join(" → ")})`);
  return { resolved, route };
}
async function invokeSyncCall(ports: StewardPorts, origin: CallOrigin, target: string, raw: unknown, options: { timeoutMs?: number; expectedTarget?: ExpectedModuleTarget }) {
  const { timeoutMs, expectedTarget } = options;
  const { resolved, route: { chain, path } } = await validateSyncRoute(ports, origin, target, expectedTarget);
  const args = validArgs(resolved.tool, raw), now = ports.now(), quiet = resolved.system?.unrecorded?.includes(resolved.tool.name) ?? false;
  const row = await ports.db.moduleInvocation.create({ data: { workspaceId: origin.workspaceId, caller: callerKey(origin.caller), callerModuleId: origin.caller.kind === "module" ? origin.caller.moduleId : null, callerHash: origin.caller.kind === "module" ? origin.caller.hash : null,
    target: resolved.module.name, tool: resolved.tool.name, args: (quiet ? {} : args) as Prisma.InputJsonValue, key: randomUUID(), chain: path, mode: "sync", idempotent: resolved.tool.idempotent, status: "running", attempts: 1, createdAt: now } });
  const finish = (data: Prisma.ModuleInvocationUpdateInput) => ports.db.moduleInvocation.update({ where: { id: row.id }, data: { ...data, finishedAt: ports.now() } });
  const activationId = resolved.system ? undefined : (await currentModuleEvolution(ports.db, origin.workspaceId, resolved.module.id, resolved.module.activeHash))?.activationId ?? null;
  const invocation = { ports, origin, resolved, target, args, chain, path, now, ...(activationId !== undefined ? { activationId } : {}) };
  if (resolved.system) return invokeSystemSync({ ...invocation, rowId: row.id, finish, quiet });
  return invokeModuleSync({ ...invocation, timeoutMs, rowId: row.id, finish });
}
export async function callSync(ports: StewardPorts, origin: CallOrigin, target: string, raw: unknown, { timeoutMs, expectedTarget }: { timeoutMs?: number; expectedTarget?: ExpectedModuleTarget } = {}) {
  return invokeSyncCall(ports, origin, target, raw, { timeoutMs, expectedTarget });
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
  } else if (!await admitted(tx, origin.caller, resolved.tool)) throw new CallError("forbidden", `${target} does not accept calls from this caller`);
  else if (resolved.system?.unrecorded?.includes(resolved.tool.name)) throw new CallError("invalid", `${target} is called synchronously (its arguments are never stored)`);
  return resolved;
}
type EnqueueInput = { tx: Db; ports: StewardPorts; origin: CallOrigin; target: string; raw: unknown };
type EnqueueOptions = { key: string; reply?: boolean; lenient?: boolean; expectedTarget?: ExpectedModuleTarget };
type EnqueuedCall = { callId: string; status: "queued"; duplicate: boolean };
export async function enqueueCall(input: EnqueueInput, options: EnqueueOptions): Promise<EnqueuedCall> {
  // Prisma transaction proxies may expose $transaction too. Enter at most once; never redispatch recursively.
  const client = input.tx as StewardPorts["db"];
  return typeof client.$transaction === "function"
    ? client.$transaction(tx => enqueueIn({ ...input, tx }, options))
    : enqueueIn(input, options);
}
async function checkDuplicateTarget(tx: Db, callId: string, expectedTarget?: ExpectedModuleTarget) {
  if (!expectedTarget) return;
  const parsed = expectedModuleTargetSchema.safeParse(expectedTarget);
  if (!parsed.success) throw new CallError("invalid", "Invalid expected target identity");
  const binding = await tx.audit.findUnique({ where: { id: targetBindingId(callId) } });
  const identity = binding?.details as { moduleId?: unknown; contractHash?: unknown } | null | undefined;
  if (!identity || identity.moduleId !== parsed.data.moduleId || identity.contractHash !== parsed.data.contractHash) throw new CallError("conflict", "Duplicate key belongs to a different registered target");
}
async function enqueueIn({ tx, ports, origin, target, raw }: EnqueueInput, { key, reply = false, lenient = false, expectedTarget }: EnqueueOptions): Promise<EnqueuedCall> {
  const name = splitTarget(target), caller = callerKey(origin.caller);
  const existing = await tx.moduleInvocation.findUnique({ where: { workspaceId_caller_target_tool_key: { workspaceId: origin.workspaceId, caller, target: name.module, tool: name.tool, key } } });
  if (existing) {
    await checkDuplicateTarget(tx, existing.id, expectedTarget);
    return { callId: existing.id, status: existing.status as "queued", duplicate: true };
  }
  const resolved = await resolveEnqueueTarget(tx, origin, target, lenient);
  assertExpectedTarget(resolved, expectedTarget);
  const { path } = nextPath(origin);
  if (path.length >= MAX_CALL_DEPTH) throw new CallError("cycle", `Call path too deep (${path.join(" → ")})`);
  const args = resolved instanceof CallError ? raw : validArgs(resolved.tool, raw), now = ports.now();
  const row = await tx.moduleInvocation.create({ data: { workspaceId: origin.workspaceId, caller, callerModuleId: origin.caller.kind === "module" ? origin.caller.moduleId : null, callerHash: origin.caller.kind === "module" ? origin.caller.hash : null,
    target: name.module, tool: name.tool, args: (args ?? {}) as Prisma.InputJsonValue, key, chain: path, mode: "async", idempotent: resolved instanceof CallError ? false : resolved.tool.idempotent,
    reply: reply && origin.caller.kind === "module", nextAttemptAt: now, createdAt: now } });
  await bindInvocationTarget(tx, { workspaceId: origin.workspaceId, callId: row.id, resolved, target, now });
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
    const activationId = (await currentModuleEvolution(ports.db, row.workspaceId, resolved.module.id, resolved.module.activeHash))?.activationId ?? null;
    const reply = await moduleSupervisor(ports).deliver(resolved.module.id, resolved.module.activeHash, toolEvent(resolved, args, now, caller, { id: row.id, key: row.key, attempt: row.attempts, chain: path }), { chain: [], path, activationId, beforeDelivery: targetFence(ports, row.workspaceId, resolved, caller), validateResult: output => moduleOutputError(`${resolved.module.name}.${resolved.tool.name}`, resolved.tool, output) });
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
    const output = await resolved.system!.handle({ ports, workspaceId: row.workspaceId, caller, call: { id: row.id } }, resolved.tool.name, args);
    checkSystemOutput(`${row.target}.${row.tool}`, resolved.tool as SystemTool, output);
    return settle({ status: "succeeded", output: output as Prisma.InputJsonValue, error: null, finishedAt: ports.now() });
  } catch (error) {
    if (error instanceof AwaitUser) return settle({ status: "waiting", output: error.output as Prisma.InputJsonValue, error: null });
    const failure = systemError(error); return settle({ status: "failed", error: `${failure.code}: ${failure.message}`.slice(0, 2000), finishedAt: ports.now() });
  }
}
const missingCaller = (row: Row, module: { workspaceId: string } | null) => row.callerModuleId && (!module || module.workspaceId !== row.workspaceId);
async function deliverRow(ports: StewardPorts, row: Row, token: string) {
  const { db } = ports, now = ports.now();
  const settle = (data: Prisma.ModuleInvocationUpdateManyMutationInput) => db.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: token }, data: { leaseToken: null, leaseUntil: null, ...data } });
  const retryOrFail = (error: string) => settle(row.attempts < MAX_ATTEMPTS ? { status: "queued", nextAttemptAt: backoff(now, row.attempts), error } : { status: "failed", error, finishedAt: now });
  const target = `${row.target}.${row.tool}`, resolved = await resolveTarget(db, row.workspaceId, target);
  // Not there yet (e.g. a built-in still building) or paused: it never got the call, so trying later is safe.
  if (resolved instanceof CallError) return resolved.code === "unavailable" || resolved.code === "not_found" ? retryOrFail(resolved.message) : settle({ status: "failed", error: resolved.message, finishedAt: now });
  if (!await checkInvocationTarget(ports, row, resolved)) return settle({ status: "failed", error: "conflict: queued callback target identity or contract changed; register again", finishedAt: now });
  const callerModule = row.callerModuleId ? await db.module.findUnique({ where: { id: row.callerModuleId } }) : null;
  if (missingCaller(row, callerModule)) return settle({ status: "failed", error: "forbidden: original caller no longer exists", finishedAt: now });
  const caller = originOf(row, callerModule);
  if (!await admitted(db, caller, resolved.tool)) return settle({ status: "failed", error: "forbidden: the target no longer accepts this caller", finishedAt: now });
  let args;
  try { args = validArgs(resolved.tool, row.args); }
  catch (error) { return settle({ status: "failed", error: message(error), finishedAt: now }); }
  if (resolved.system) return deliverSystemRow(ports, row, { resolved, caller, args, settle });
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
    const binding = await db.audit.findUnique({ where: { id: targetBindingId(row.id) } });
    const identity = z.object({ moduleId: z.string(), contractHash: z.string() }).strict().safeParse(binding?.details);
    await db.moduleInvocation.updateMany({ where: { id: row.id, status: "running", leaseToken: row.leaseToken }, data: identity.success && row.idempotent && row.attempts < MAX_ATTEMPTS
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
