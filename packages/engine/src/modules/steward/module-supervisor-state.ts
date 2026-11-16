import { moduleRuntimeParams, RUN_LIMITS } from "@chrona/contracts/steward";
import { moduleModelSettings } from "./settings";
import { CallError } from "./module-call-error";
import type { ModuleCall, moduleCallReplySchema, ModuleEvent, ModuleManifest, moduleEventReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { createModuleChannel } from "./module-channel";
import type { moduleHttpReady } from "./module-http-ready";
import { diagnosticText, type ModuleFailureEvidence } from "./module-diagnostics";

export type Reply = ReturnType<typeof moduleEventReplySchema.parse>;
/** `chain`/`path`: the routed call path of the event being handled (see module-calls). */
export type CallScope = { workspaceId: string; moduleId: string; hash: string; receiverActivationId?: string; manifest: ModuleManifest; moduleRunId?: string; eventKey?: string; chain?: string[]; path?: string[] };
/** Where a failed delivery stopped: never reached the module, the module answered with an error, or lost after sending. */
export type DeliveryStage = "unavailable" | "handler" | "lost";
export function staged(error: unknown, stage: DeliveryStage) {
  const base: Error & { stage?: DeliveryStage } = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { stage: base.stage ?? stage });
}
export function isHandlerRejection(error: unknown) {
  const rejection = error as { stage?: DeliveryStage; code?: string };
  if (rejection.stage !== "handler") return false;
  return !!rejection.code && !["internal", "failed", "unknown"].includes(rejection.code);
}
export type Process = ReturnType<NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]>>;
export type Timers = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
export type Options = { timers?: Timers; idleMs?: number; backoffMs?: number };
export type DeliveryOptions = { private?: boolean; /** Observations keep only in-memory delivery identity. */ retainHistory?: boolean; /** false: record the run, not its result. */ retainOutput?: boolean; chain?: string[]; path?: string[]; timeoutMs?: number; activationId?: string | null; beforeDelivery?: () => Promise<void>; dispatch?: (send: () => void) => Promise<void>; validateResult?: (result: unknown) => string | null; callerRunId?: string };
export type Delivery = { promise: Promise<Reply>; waits: Set<Delivery>; runId?: string };
export type Instance = {
  moduleId: string; hash: string; activationId: string | null; manifest: ModuleManifest; scope: CallScope;
  barrier?: Delivery; deliveries: Map<Promise<Reply>, Delivery>; start?: Promise<void>; httpReady?: ReturnType<typeof moduleHttpReady>;
  process?: Process; channel?: Awaited<ReturnType<typeof createModuleChannel>>;
  idle?: ReturnType<typeof setTimeout>; retiring: boolean; closing: boolean; busy: boolean; activeEvents: number; connected?: boolean;
  exit?: { code: number | null; signal: string | null };
  failureEvidence?: ModuleFailureEvidence; failureRecorded?: boolean;
  privateTransport?: boolean;
  stopUnknown?: Error; closePromise?: Promise<void>; retirement?: Promise<void>;
};
/** Lifecycle events drain prior calls; later tools wait for that lifecycle barrier. */
export function trackDelivery(instance: Instance, event: ModuleEvent, runs: Map<string, Delivery>,
  callerRunId: string | undefined, work: (delivery: Delivery) => Promise<Reply>): Promise<Reply> {
  const prior = event.trigger.kind === "tool" ? (instance.barrier ? [instance.barrier] : []) : [...instance.deliveries.values()];
  const parent = callerRunId ? runs.get(callerRunId) : undefined;
  if (parent && prior.some(delivery => waitsFor(delivery, parent))) {
    throw staged(new CallError("cycle", "Call would wait on its own lifecycle barrier"), "unavailable");
  }
  const delivery: Delivery = { promise: undefined!, waits: new Set(prior) };
  const result = Promise.allSettled(prior.map(item => item.promise)).then(() => {
    delivery.waits.clear();
    if (instance.closing) throw staged(new Error("Module is closing"), "unavailable");
    return work(delivery);
  });
  delivery.promise = result;
  parent?.waits.add(delivery);
  instance.deliveries.set(result, delivery);
  if (event.trigger.kind !== "tool") instance.barrier = delivery;
  return result.finally(() => {
    instance.deliveries.delete(result);
    parent?.waits.delete(delivery);
    if (delivery.runId) runs.delete(delivery.runId);
    if (instance.barrier === delivery) delete instance.barrier;
  });
}
function waitsFor(from: Delivery, target: Delivery, seen = new Set<Delivery>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return [...from.waits].some(next => waitsFor(next, target, seen));
}
export function triggerKey({ trigger }: ModuleEvent) {
  switch (trigger.kind) {
    case "tool": return `tool:${trigger.id}`;
    case "call_result": return `call_result:${trigger.callId}`;
    case "timer": return trigger.eventId;
    default: return trigger.id;
  }
}
export const keyOf = (moduleId: string, hash: string, activationId: string | null) => `${moduleId}:${hash}:${activationId ?? "untracked"}`;
function failurePhase(event: ModuleEvent | undefined, connected: boolean | undefined) { return event ? "event" : connected ? "process" : "start"; }
function processEvidence(instance: Partial<Pick<Instance, "process" | "exit" | "privateTransport">>) {
  const process = instance.process, exit = instance.exit;
  return { pid: process?.pid ?? null, exitCode: exit?.code ?? null, signal: exit?.signal ?? null,
    stderr: instance.privateTransport ? "[private process output omitted]" : diagnosticText(process?.stderr() ?? "", 4000, true) };
}
export function evidence(instance: Partial<Pick<Instance, "connected" | "process" | "exit" | "privateTransport">>, error: string, runId?: string, event?: ModuleEvent): ModuleFailureEvidence {
  return { phase: failurePhase(event, instance.connected), reason: instance.privateTransport ? "Private operation failed" : diagnosticText(error, 1000),
    runId: runId ?? null, triggerId: event ? triggerKey(event) : "process", delivery: null, ...processEvidence(instance) };
}

export function failureDetail(instance: Instance, input: { error: string; runId?: string; event?: ModuleEvent; delivery?: DeliveryStage; triggerId: string }) {
  const { error, runId, event, delivery, triggerId } = input;
  const observed = instance.privateTransport ? evidence(instance, error, runId, event) : instance.failureEvidence ?? evidence(instance, error, runId, event);
  return { ...observed, reason: instance.privateTransport ? "Private operation failed" : diagnosticText(error, 1000), runId: runId ?? null, triggerId, delivery: delivery ?? null };
}
export function deliveryFailure(error: unknown, privateTransport?: boolean) {
  if (!privateTransport) return error;
  const failure = error as { code?: string; stage?: DeliveryStage };
  return Object.assign(new Error("Private operation failed"), { code: failure.code, stage: failure.stage });
}
export function handlerFailureData(error: unknown, privateTransport?: boolean) {
  const failure = error as { deliveryRejected?: boolean };
  const reason = error instanceof Error ? error.message : String(error);
  return { exitCode: 1, error: privateTransport ? "Private operation failed" : diagnosticText(reason, 1000), ...(failure.deliveryRejected ? { output: { delivery: "not_sent" } } : {}) };
}

/** A retired or closing owner cannot serve a new delivery. */
export function availableInstance(instance: Instance | undefined) {
  return instance?.retiring || instance?.closing ? undefined : instance;
}

export function activationChanged(instance: Instance, hash: string, activationId: string | null) {
  return hash !== instance.hash || activationId !== instance.activationId;
}

export function restartDelay(backoffMs: number, persistedFailures: number, localFailures: number) {
  return Math.min(60_000, backoffMs * 2 ** Math.max(0, Math.max(persistedFailures, localFailures) - 1));
}

/** Observed process state after the supervisor's ownership/backoff checks. */
export function instanceStatus(instance: Instance | undefined, hash: string | null, keepAlive: boolean) {
  if (instance && instance.hash === hash && !instance.closing) return { state: instance.connected ? "running" as const : "starting" as const, pid: instance.process?.pid ?? null };
  return { state: keepAlive ? "unavailable" as const : "idle" as const, pid: null };
}

type ModuleEffects = {
  handleModuleCall(ports: StewardPorts, scope: CallScope, call: ModuleCall): Promise<ReturnType<typeof moduleCallReplySchema.parse>>;
  pauseFailedModule(ports: StewardPorts, execution: { workspaceId: string; moduleId: string; hash: string; activationId: string | null; triggerId: string; firedAt: Date }, runId: string): Promise<void>;
};
// module-effects routes a module's calls through module-calls, which delivers through this supervisor: it registers here instead of being imported.
let effects: ModuleEffects | undefined;
export function registerModuleEffects(value: ModuleEffects) { effects = value; }
export function moduleEffects() {
  if (!effects) throw new Error("Module effects are not registered: import ./module-effects");
  return effects;
}

/** Kernel ceilings bound requested event timeouts. */
export async function eventLimits(ports: StewardPorts, manifest: ModuleManifest, workspaceId: string, requested?: number) {
  const workspace = manifest.model ? await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }) : null;
  const ceiling = workspace && manifest.model ? moduleModelSettings(workspace.settings)?.eventTimeoutMs ?? RUN_LIMITS.jobTimeoutMs : RUN_LIMITS.jobTimeoutMs;
  return { timeoutMs: Math.min(requested ?? ceiling, ceiling), params: moduleRuntimeParams(manifest) };
}
