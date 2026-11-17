import { providerText } from "@chrona/domain/steward/provider";
import type { ProviderRunInput } from "@chrona/contracts/steward";
import type { PiProviderOptions } from "./pi-launch";

type RecordValue = Record<string, unknown>;
export const nativeError = (code: "unsupported" | "invalid" | "unavailable" | "unknown" | "too_large", message: string) => Object.assign(new Error(message), { code });
const sensitiveKey = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|credentials)$/i;
/** Preserve complete JSON structure; redact values and keys without clipping strings or arrays. */
function safeRecord(record: RecordValue, secrets: string[]): RecordValue {
  const text = (value: string) => providerText(value, secrets, Number.MAX_SAFE_INTEGER, true);
  const visit = (value: unknown, depth = 0): unknown => {
    if (depth > 128) throw nativeError("too_large", "Pi record exceeds 128 levels; full record was not returned");
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), sensitiveKey.test(key) ? "[redacted]" : visit(item, depth + 1)]));
    return value;
  };
  return visit(record) as RecordValue;
}

// These commands replace the kernel-bound session or bridge/admission state. They
// need a synchronization contract before they can run within an admitted Run.
const unsupported = new Set(["new_session", "switch_session", "branch", "fork", "fork_session", "handoff", "set_host_tools", "set_host_uri_schemes", "set_active_tools", "reload", "reload_extensions", "login", "logout"]);
export const promptCommands = new Set(["prompt", "steer", "follow_up", "abort_and_prompt"]);
function jsonValue(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error();
  if (value === null) return;
  if (["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number") { if (Number.isFinite(value)) return; throw new Error(); }
  if (Array.isArray(value)) { for (const item of value) jsonValue(item, depth + 1); return; }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) { for (const item of Object.values(value)) jsonValue(item, depth + 1); return; }
  throw new Error();
}
function jsonRequest(request: unknown) {
  try {
    if (!request || Array.isArray(request) || typeof request !== "object") throw new Error();
    jsonValue(request);
    if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error();
  } catch { throw nativeError("invalid", "Pi native request must be a JSON object within 256 KiB and 64 levels"); }
}
export function nativeRequest(request: RecordValue, pinnedModel?: string) {
  jsonRequest(request);
  if (typeof request.type !== "string" || !/^[a-z][a-z0-9_]{0,99}$/.test(request.type)) throw nativeError("invalid", "Pi native request requires a protocol type");
  if (request.id !== undefined && (typeof request.id !== "string" || request.id.length > 128)) throw nativeError("invalid", "Pi native request id must be a string within 128 characters");
  const { type, id, ...fields } = request;
  if (unsupported.has(type) || pinnedModel && ["set_model", "cycle_model"].includes(type)) throw nativeError("unsupported", "Pi native command would change bound session, model or admitted bridge state");
  if (promptCommands.has(type) && typeof fields.message !== "string") throw nativeError("invalid", "Pi native prompt requires a message");
  return { type, fields, callerId: id as string | undefined };
}

export function nativeResponse(response: RecordValue, callerId: string | undefined, secrets: string[]): RecordValue {
  const { id: _transportId, ...envelope } = response;
  const result = safeRecord(callerId === undefined ? envelope : { ...envelope, id: callerId }, secrets);
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw nativeError("too_large", "Pi native response exceeds 256 KiB; full response was not returned");
  return result;
}
function validThinking(thinking: unknown) {
  if (thinking !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(thinking))) throw nativeError("invalid", "Invalid Pi thinking level");
}
function validTimeout(timeout: number | undefined) {
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647)) throw nativeError("invalid", "Invalid Pi native timeout");
}
export function piRunInput(input: ProviderRunInput, options: PiProviderOptions): ProviderRunInput {
  const model = input.model ?? input.providerOptions?.model;
  if (model !== undefined && (typeof model !== "string" || !model || model.length > 500)) throw nativeError("invalid", "Pi model must be a nonempty model identifier");
  validThinking(input.providerOptions?.thinking ?? options.thinking);
  validTimeout(options.nativeTimeoutMs);
  return { ...input, ...(model === undefined ? {} : { model: model as string }) };
}

/** Bounded, serialized raw records. Retention gaps are recoverable; sink failures stop the Run. */
export class PiRawRecords {
  private queue: { event: RecordValue; bytes: number; originalBytes: number }[] = [];
  private bytes = 0;
  private draining: Promise<void> | undefined;
  private failure: "sink_error" | "sink_timeout" | undefined;
  private stalled = false;
  private gap: { reason: string; records: number; originalBytes: number } | undefined;
  // Local callback acknowledgements may include a database transaction. A slow
  // acknowledgement is not a failed model turn; a wedged sink is still bounded.
  constructor(private append: (record: RecordValue) => Promise<void>, private secrets: string[], private fail: (message: string) => void, private timeoutMs = 30_000) {}
  receive(value: RecordValue) {
    let event: RecordValue, originalBytes = 0, bytes: number;
    try {
      originalBytes = Buffer.byteLength(JSON.stringify(value));
      event = safeRecord(value, this.secrets);
      bytes = Buffer.byteLength(JSON.stringify(event));
    } catch { this.lose("too_large", originalBytes); this.drain(); return; }
    // The byte bound includes the in-flight record. Reserve the gap separately,
    // and admit later records only after that gap has taken its place in order.
    if (this.failure || this.gap || bytes > 1024 * 1024 || this.queue.length >= 256 || this.bytes + bytes > 1024 * 1024) {
      this.lose(this.failure ?? (bytes > 1024 * 1024 ? "too_large" : "backpressure"), originalBytes);
    } else {
      this.queue.push({ event, bytes, originalBytes }); this.bytes += bytes;
    }
    this.drain();
  }
  private lose(reason: string, bytes: number, records = 1) {
    this.gap ??= { reason, records: 0, originalBytes: 0 };
    this.gap.records += records; this.gap.originalBytes += bytes;
  }
  private incomplete() {
    return new Error(`Pi raw event stream is incomplete (${this.failure}; ${this.gap?.records ?? 0} records, ${this.gap?.originalBytes ?? 0} bytes not acknowledged)`);
  }
  private async write(event: RecordValue): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => this.append(event)),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { this.stalled = true; reject(new Error("Raw sink timed out")); }, this.timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  private failSink(item: { originalBytes: number } | undefined, gap: { originalBytes: number; records: number } | undefined) {
    this.failure = this.stalled ? "sink_timeout" : "sink_error";
    // A rejected gap still represents its original records. Merge it with any
    // loss that arrived while its acknowledgement was pending.
    this.lose(this.failure, gap?.originalBytes ?? item!.originalBytes, gap?.records ?? 1);
    for (const queued of this.queue.splice(0)) this.lose(this.failure, queued.originalBytes);
    this.bytes = 0;
    this.fail(this.incomplete().message);
  }
  private drain() {
    if (this.draining || this.failure) return;
    this.draining = (async () => {
      while (this.queue.length || this.gap) {
        const item = this.queue.shift();
        const gap = item ? undefined : this.gap;
        if (gap) this.gap = undefined;
        try { await this.write(item?.event ?? { type: "chrona_raw_gap", ...gap }); }
        catch { this.failSink(item, gap); return; }
        this.bytes -= item?.bytes ?? 0;
      }
    })().finally(() => { this.draining = undefined; if (this.queue.length || this.gap) this.drain(); });
  }
  async close() {
    while (this.draining) await this.draining;
    // A timed-out callback is still pending. Never invoke it concurrently or replay it.
    if (this.failure && this.gap && !this.stalled) {
      try { await this.write({ type: "chrona_raw_gap", ...this.gap }); }
      catch { /* The outcome still carries the sanitized cause and loss counts. */ }
    }
    if (this.failure) throw this.incomplete();
  }
}
