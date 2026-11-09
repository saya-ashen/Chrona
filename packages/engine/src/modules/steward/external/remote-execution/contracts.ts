import { createHash } from "node:crypto";
import schemas from "./protocol.schema.json";

export const VERSION = 1;
export const LIMITS = { launch: 65_536, proof: 4096, source: 32_768, batchCount: 100, batch: 262_144, body: 524_288, final: 196_608 } as const;
export class ProtocolError extends Error {
  constructor(public code: string, message = code) { super(message); }
}
export function check(condition: unknown, code: string, message?: string): asserts condition {
  if (!condition) throw new ProtocolError(code, message);
}
export type Caller = { kind: "kernel" } | { kind: "owner"; via: string | null } | { kind: "module"; module: string; moduleId: string; hash: string } | { kind: "provider"; runId: string };
export type AppFence = { moduleId: string; hash: string; activationId: string };
export type DeviceFence = { deviceId: string; generation: number; incarnation: string; keyId: string };
export type Baseline = { kind: "commit" | "snapshot"; digest: string };
/** Language-neutral copies of the routed contract; application code imports no kernel source. */
export type Target = {
  workspaceId: string; ownerId: string; workId: string; sessionId: string; runId: string; attemptId: string; deliveryId: string;
  callerModuleId: string | null; callerHash: string | null; callerActivationId: string | null;
  receiverModuleId: string; receiverHash: string; receiverActivationId: string;
  authorityId: string; subjectId: string; epoch: number; keyId: string; launchDigest: string;
};
export type NativeControl = { requestKey: string; operation: "control"; payload: { operation: "cancel" } | { operation: "write"; text: string } | { operation: "answer"; requestId: string; answer: { decision: "cancel" } | { decision: "submit"; value: boolean | number | string } } } | { requestKey: string; operation: "cleanup"; payload: { op: "preview" | "confirm"; workId: string; commandKey: string; previewDigest?: string } };
export type ModelInput = { prompt: string; system?: string; maxOutputTokens: number };
export type ModelResult = { status: "pending" | "rejected" | "completed"; reservationId: string; error?: string | null; result?: { text: string; inputTokens: number | null; outputTokens: number | null } };
export type Launch = {
  fence: Omit<Target, "launchDigest">;
  placement: { kind: "application"; applicationId: string; targetRef: string; targetRevision: number; projectRef: string };
  target: { targetRef: string; targetRevision: number; projectRef: string; directoryIdentity: string; baseline: Baseline; workspaceModes: ("existing" | "independent_worktree")[] };
  workspaceRef: string; workspace: { mode: "existing" | "independent_worktree"; baseline: Baseline; [key: string]: unknown };
  goal: string; budget: { timeoutMs: number; maxToolCalls: number; maxModelCalls: number; maxOutputTokens: number }; deadlineAt: string;
};
export type Packet = { target: Target; launch: Launch; launchable: boolean; controls: NativeControl[] };
export type Delivery = { version: 1; requestId: string; deliveryId: string; launchDigest: string; packet: Packet };
export type Control = { version: 1; requestId: string; deliveryId: string; launchDigest: string; control: NativeControl };
export type Report = { version: 1; requestId: string; deliveryId: string; launchDigest: string; reportKey: string; kind: "started" | "source" | "final" | "stop" | "control-ack" | "cleanup"; payload: Record<string, unknown> };
export type Receipt = { version: 1; requestId: string; receiptId: string; requestDigest: string; committedAt: string; state: string };
export type KernelRequest = { version: 1; operation: "accept" | "report" | "revoke" | "reconcile" | "cancel" | "model"; key: string; requestDigest: string; payload: Record<string, unknown> };
/** JSON only. The receiving trusted kernel must recheck the real routed caller and every governance fence in its write transaction. */
export interface KernelDeliveryPort { poll(): Promise<unknown>; deliver(request: KernelRequest): Promise<unknown> }
export type KernelReceipt = { version: 1; key: string; requestDigest: string; result?: Record<string, unknown>; state: "recorded" | "revoked" | "reconciled" | "pending" | "control-authorized"; control?: Control };
export const KERNEL_TARGET = "runtime-callback.remote-delivery";
// RFC 8785 ordering and ECMAScript JSON number serialization. Reject non-JSON values,
// unsafe integers and unpaired surrogates rather than silently changing signed bytes.
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), "invalid");
    return JSON.stringify(value);
  }
  if (typeof value === "number") { check(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)), "invalid"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  check(typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype, "invalid");
  return `{${Object.keys(value).sort().map(key => `${canonical(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
// Native kernel v1 uses localeCompare key ordering. This is deliberately distinct
// from this app's JCS receipt keys; changing either needs a versioned contract.
export function nativeDigest(value: unknown) {
  canonical(value);
  return createHash("sha256").update(JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");
}
export function launchDigest(launch: Launch) { return nativeDigest(launch); }
export function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function hashSecret(value: string) { return createHash("sha256").update(value).digest("hex"); }

/** The tool transport supplies one bounded JSON string. This parser also rejects duplicate keys, including escaped aliases. */
export function parseJSON(text: string): unknown {
  check(typeof text === "string", "invalid");
  check(Buffer.byteLength(text) <= LIMITS.body, "too_large");
  let position = 0;
  const space = () => { while (/[\t\n\r ]/.test(text[position] ?? "!") && position < text.length) position++; };
  function string(): string {
    const start = position++;
    while (position < text.length) {
      const char = text[position++];
      if (char === "\\") position++;
      else if (char === '"') return JSON.parse(text.slice(start, position)) as string;
    }
    throw new ProtocolError("invalid");
  }
  function value(depth: number): unknown {
    check(depth <= 24, "too_large"); space();
    const char = text[position];
    if (char === '"') return string();
    if (char === "{") {
      position++; space(); const result: Record<string, unknown> = {}, keys = new Set<string>();
      if (text[position] === "}") { position++; return result; }
      while (position < text.length) {
        check(text[position] === '"', "invalid"); const key = string();
        check(!keys.has(key), "invalid", "Duplicate JSON key"); keys.add(key); space();
        check(text[position++] === ":", "invalid");
        Object.defineProperty(result, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        space(); const next = text[position++]; if (next === "}") return result;
        check(next === ",", "invalid"); space();
      }
    } else if (char === "[") {
      position++; space(); const result: unknown[] = [];
      if (text[position] === "]") { position++; return result; }
      while (position < text.length) {
        result.push(value(depth + 1)); space(); const next = text[position++];
        if (next === "]") return result; check(next === ",", "invalid");
      }
    } else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position));
      check(token, "invalid"); position += token[0].length; return JSON.parse(token[0]);
    }
    throw new ProtocolError("invalid");
  }
  try { const result = value(0); space(); check(position === text.length, "invalid"); canonical(result); return result; }
  catch (error) { if (error instanceof ProtocolError) throw error; throw new ProtocolError("invalid"); }
}

type Schema = { $ref?: string; type?: string; const?: unknown; enum?: unknown[]; oneOf?: Schema[]; anyOf?: Schema[]; allOf?: Schema[]; additionalProperties?: boolean; properties?: Record<string, Schema>; required?: string[]; items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string; minimum?: number; exclusiveMinimum?: number; maximum?: number; format?: string };
export function validate(name: string, value: unknown): void {
  const definitions = schemas.$defs as unknown as Record<string, Schema>;
  function matches(schema: Schema, input: unknown): boolean {
    if (schema.$ref) return matches(definitions[schema.$ref.slice(8)]!, input);
    if (schema.oneOf) return schema.oneOf.filter(item => matches(item, input)).length === 1;
    if (schema.anyOf) return schema.anyOf.some(item => matches(item, input));
    if (schema.allOf) return schema.allOf.every(item => matches(item, input));
    if (schema.type === "null") return input === null;
    if (Object.hasOwn(schema, "const") && input !== schema.const) return false;
    if (schema.enum && !schema.enum.includes(input)) return false;
    if (schema.type === "object") {
      if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
      const object = input as Record<string, unknown>, properties = schema.properties ?? {};
      return (schema.required ?? []).every(key => Object.hasOwn(object, key)) && Object.keys(object).every(key => Object.hasOwn(properties, key) && matches(properties[key]!, object[key]));
    }
    if (schema.type === "array") return Array.isArray(input) && input.length >= (schema.minItems ?? 0) && input.length <= (schema.maxItems ?? LIMITS.batchCount) && input.every(item => matches(schema.items!, item));
    if (schema.type === "string") return typeof input === "string" && input.length >= (schema.minLength ?? 0) && input.length <= (schema.maxLength ?? LIMITS.body) && (!schema.pattern || new RegExp(schema.pattern).test(input)) && (schema.format !== "date-time" || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input) && Number.isFinite(Date.parse(input))));
    if (schema.type === "integer") return typeof input === "number" && Number.isSafeInteger(input) && input >= (schema.minimum ?? 0) && (schema.exclusiveMinimum === undefined || input > schema.exclusiveMinimum) && input <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
    if (schema.type === "boolean") return typeof input === "boolean";
    return Object.keys(schema).length === 0 || Object.hasOwn(schema, "const") || !!schema.enum;
  }
  canonical(value);
  if (value && typeof value === "object" && "version" in value) check(value.version === VERSION, "unsupported_version");
  check(definitions[name] && matches(definitions[name]!, value), "invalid", `Invalid ${name}`);
}
export function input<T>(name: string, args: Record<string, unknown>): T {
  check(Object.keys(args).length === 1 && typeof args.input === "string", "invalid");
  const parsed = parseJSON(args.input); validate(name, parsed); return parsed as T;
}
export function bounded(value: unknown, maximum: number) { check(Buffer.byteLength(canonical(value)) <= maximum, "too_large"); }
export function readStored<T>(name: string, value: string): T { const parsed = parseJSON(value); validate(name, parsed); return parsed as T; }
