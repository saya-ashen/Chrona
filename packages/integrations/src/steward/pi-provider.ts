import { join, resolve } from "node:path";
import { copyFileSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { providerText } from "@chrona/domain/steward/provider";
import { PiEvents } from "./pi-events";
import { piTranscript } from "./pi-transcript";
import { EXECUTION_EVENT_LIMITS, executionEventSchema, executionJsonBytes, type ExecutionEvent, type ExecutionPayload, type ProviderAdapter, type ProviderRunInput } from "@chrona/contracts/steward";
import { createPiModelGateway } from "./pi-model-gateway";
import { launchPiProcess, type PiProcess } from "./pi-process";
import { expectedPiCommands, inspectPiLaunch, piArguments, piEnvironment, piLaunchConfig, prepareContent, profileOverlaps, type PiLaunchConfig, type PiProviderOptions } from "./pi-launch";
export type { PiProviderOptions } from "./pi-launch";

type Result = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
function buildProfile(config: PiLaunchConfig, input: ProviderRunInput) {
  if (!input.model && input.resources !== "minimal") return null;
  const profile = mkdtempSync(join(config.agentDir, "build-"));
  for (const name of ["auth.json", "models.json"]) if (existsSync(join(config.agentDir, name))) symlinkSync(join(config.agentDir, name), join(profile, name));
  if (existsSync(join(config.agentDir, "settings.json"))) copyFileSync(join(config.agentDir, "settings.json"), join(profile, "settings.json"));
  return profile;
}

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const imagesFor = (images: ProviderRunInput["images"]) => images?.map(image => ({ type: "image", data: image.base64, mimeType: image.mime }));
function bounded<T>(request: Promise<T>, ms = 250): Promise<T> {
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => reject(new Error("Pi control request timed out")), ms);
    void request.then(value => { clearTimeout(timer); resolveRequest(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** Incremental JSONL framing, including split UTF-8 chunks decoded by the stream. */
function rpcLines(receive: (value: unknown) => void, fail: (message: string) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (line.length > 8 * 1024 * 1024) { fail("Pi RPC record too large"); break; }
      try { receive(JSON.parse(line)); } catch { fail("Malformed Pi RPC JSON"); break; }
    }
    if (buffer.length > 8 * 1024 * 1024) { buffer = ""; fail("Pi RPC record too large"); }
  };
}
function messageError(message: RecordValue): string | null {
  if (message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) {
    return typeof message.errorMessage === "string" ? message.errorMessage : "Pi model failed";
  }
  return null;
}

/** A single drain promise and bounded normalized queue; raw RPC never enters storage. */
class PiDetail {
  private seq = 0;
  private queue: ExecutionEvent[] = [];
  private bytes = 0;
  private draining: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lost: { from: number; through: number } | null = null;
  private failure = false;
  private final: ExecutionPayload | null = null;
  private messageId = 0;
  constructor(private input: ProviderRunInput, private secrets: string[]) {}
  private text(value: unknown, limit = 20_000) {
    const text = providerText(value, this.secrets, limit, true);
    return Buffer.byteLength(text) > limit ? Buffer.from(text).subarray(0, limit).toString("utf8") : text;
  }
  private event(payload: ExecutionPayload): ExecutionEvent {
    return { ...this.input.execution!, seq: ++this.seq, at: new Date().toISOString(), payload };
  }
  private gap(seq: number) {
    this.lost = { from: Math.min(this.lost?.from ?? seq, seq), through: Math.max(this.lost?.through ?? seq, seq) };
    this.failure = true;
  }
  emit(payload: ExecutionPayload) {
    if (!this.input.detail || !this.input.execution) return;
    const event = this.event(payload), bytes = executionJsonBytes(event);
    if (!executionEventSchema.safeParse(event).success || this.queue.length >= EXECUTION_EVENT_LIMITS.bufferEvents || this.bytes + bytes > EXECUTION_EVENT_LIMITS.bufferBytes) { this.gap(event.seq); return; }
    this.queue.push(event); this.bytes += bytes;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, EXECUTION_EVENT_LIMITS.flushMs);
  }
  receive(event: RecordValue) {
    this.receiveMessage(event);
    this.receiveTool(event);
  }
  private receiveMessage(event: RecordValue) {
    const message = object(event.message), delta = object(event.assistantMessageEvent);
    if (event.type === "message_start" && ["user", "assistant"].includes(String(message.role))) {
      this.messageId++;
      this.emit({ type: "message", messageId: `message:${this.messageId}`, role: message.role as "user" | "assistant", text: "", complete: false });
    }
    if (event.type === "message_update" && delta.type === "text_delta") {
      if (typeof delta.delta === "string" && Buffer.byteLength(delta.delta) > 20_000) this.gap(++this.seq);
      this.emit({ type: "text_delta", messageId: `message:${this.messageId}`, delta: this.text(delta.delta) });
    }
    if (event.type === "message_end" && ["user", "assistant"].includes(String(message.role))) {
      const raw = this.messageText(message.content);
      const text = this.text(raw);
      if (Buffer.byteLength(raw) > 20_000) this.gap(++this.seq);
      const payload: ExecutionPayload = { type: "message", messageId: `message:${this.messageId}`, role: message.role as "user" | "assistant", text, complete: true };
      if (message.role === "assistant") this.final = payload;
      this.emit(payload);
    }
  }
  private messageText(content: unknown): string {
    return Array.isArray(content) ? content.map(object).filter(part => part.type === "text").map(part => typeof part.text === "string" ? part.text : "").join("\n") : typeof content === "string" ? content : "";
  }
  private receiveTool(event: RecordValue) {
    if (event.type === "tool_execution_start") {
      const tool = this.text(event.toolName, 100), toolCallId = this.text(event.toolCallId, 128);
      if (tool && /^[\w:.-]+$/.test(toolCallId)) this.emit({ type: "tool_started", toolCallId, tool, display: {} });
    }
    if (event.type === "tool_execution_end") {
      const tool = this.text(event.toolName, 100), toolCallId = this.text(event.toolCallId, 128);
      if (tool && /^[\w:.-]+$/.test(toolCallId)) {
        const originalBytes = event.result === undefined ? 0 : Buffer.byteLength(JSON.stringify(event.result));
        this.emit({ type: "tool_finished", toolCallId, tool, isError: event.isError === true, summary: event.isError ? "Tool failed" : "Tool completed", truncated: originalBytes > 0, originalBytes });
      }
    }
  }
  private flush(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      while (this.queue.length) {
        const event = this.queue[0]!;
        try { await this.input.detail!.append(event); }
        catch { this.gap(event.seq); }
        this.queue.shift(); this.bytes -= executionJsonBytes(event);
      }
    })().finally(() => { this.draining = null; });
    return this.draining;
  }
  async close(status: "completed" | "failed") {
    clearTimeout(this.timer);
    await this.flush();
    // Reserved snapshot/control recovery must still run after detail loss or saturation.
    const append = async (payload: ExecutionPayload) => {
      try { await this.input.detail!.append(this.event(payload)); }
      catch { this.failure = true; }
    };
    if (this.lost) await append({ type: "gap", ...this.lost, reason: "backpressure" });
    if (this.final) await append(this.final);
    await append({ type: "state", status, cancelRequested: false, stopConfirmed: true });
    if (this.failure) throw new Error("Execution detail is incomplete; recover the final snapshot");
  }
}

/** Owns one subprocess and its mutable RPC/completion state. */
class PiRun {
  private child: PiProcess | undefined;
  private events: PiEvents | undefined;
  private detail: PiDetail | undefined;
  private secrets: string[] = [];
  private sessionId: ProviderRunInput["sessionId"];
  private sequence = 0;
  private epoch = 0;
  private streaming = false;
  private sessionSettled = false;
  private retrying = false;
  private checking = false;
  private startup: Promise<void> = Promise.resolve();
  private resourcesReady: Promise<void> = Promise.resolve();
  private cancellation: Result | null = null;
  private closing: Result | null = null;
  private settled = false;
  private stderr = "";
  private modelError: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setTimeout> | undefined;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private runningTools = 0;
  private toolCalls = 0;
  private complete!: (result: Result) => void;
  private rejectDone!: (error: unknown) => void;
  readonly done = new Promise<Result>((resolveDone, rejectDone) => { this.complete = resolveDone; this.rejectDone = rejectDone; });
  private pending = new Map<string, { resolve(value: RecordValue): void; reject(error: Error): void }>();

  constructor(private input: ProviderRunInput, private idleMs = 5 * 60_000) { this.sessionId = input.sessionId; }
  /** A stalled model request otherwise holds the run until its deadline (20 min in background). */
  private touch(event?: RecordValue) {
    if (event?.type === "tool_execution_start") {
      this.runningTools++;
      this.toolCalls++;
      // The extension's pre-tool hook enforces admission; this observes already-started tools only.
      if (this.input.executionBudget && this.toolCalls > this.input.executionBudget.maxToolCalls) void this.abortWith("failed", "Execution tool budget exceeded").catch(() => {});
    }
    if (event?.type === "tool_execution_end") this.runningTools = Math.max(0, this.runningTools - 1);
    clearTimeout(this.idle);
    if (this.inactive()) return;
    this.idle = setTimeout(() => {
      // Long tool runs and open user questions are progress the RPC stream does not show.
      if (this.runningTools > 0 || this.events?.waiting) { this.touch(); return; }
      void this.abortWith("timed_out", `Pi produced no output for ${Math.round(this.idleMs / 1000)}s`).catch(() => {});
    }, this.idleMs);
  }
  private redact(text: string) {
    return providerText(stripVTControlCharacters(text), this.secrets, 1000);
  }
  private inactive() { return this.closing !== null || this.settled || this.cancellation !== null; }
  private runProfile: string | null = null;
  private finalize() {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer); clearTimeout(this.poll); clearTimeout(this.killTimer); clearTimeout(this.idle);
    for (const request of this.pending.values()) request.reject(new Error("Pi run ended"));
    this.pending.clear();
    if (this.runProfile) { rmSync(this.runProfile, { recursive: true, force: true }); this.runProfile = null; }
    const result = this.closing ?? this.cancellation ?? { outcome: "failed" as const, sessionId: this.sessionId, error: this.redact(`Pi exited before completion. ${this.stderr}`) };
    void (async () => {
      await bounded(this.events?.close() ?? Promise.resolve(), 1000).catch(() => {});
      try { await this.detail?.close(result.outcome === "finished" ? "completed" : "failed"); }
      catch { this.complete({ ...result, outcome: "failed", error: "Execution detail is incomplete; recover the final snapshot" }); return; }
      this.complete(result);
    })();
  }
  /** Closure uncertainty must never become fulfilled completion or delete the retained run profile. */
  private unconfirmedClosure(error: unknown) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer); clearTimeout(this.poll); clearTimeout(this.killTimer); clearTimeout(this.idle);
    this.events?.interrupt();
    for (const request of this.pending.values()) request.reject(new Error("Pi process closure is unconfirmed"));
    this.pending.clear();
    this.rejectDone(error);
  }
  private stop(outcome: Result["outcome"], error: string | null) {
    if (this.closing || this.settled) return;
    outcome = this.cancellation?.outcome ?? outcome;
    error = this.cancellation?.error ?? error;
    this.closing = { outcome, sessionId: this.sessionId, error: error === null ? null : this.redact(`${error}${this.stderr ? `: ${this.stderr}` : ""}`) };
    this.events?.interrupt();
    clearTimeout(this.timer); clearTimeout(this.poll); clearTimeout(this.idle);
    if (!this.child) { this.finalize(); return; }
    this.child.stdin.end();
    // done resolves only after process exit: the engine may commit the cwd immediately.
    this.killTimer = setTimeout(() => this.child?.kill("SIGKILL"), 500);
  }
  private send(type: string, fields: RecordValue = {}, cancelling = false): Promise<RecordValue> {
    if (this.closing || this.settled || this.cancellation && !cancelling || !this.child) return Promise.reject(new Error("Pi run is not active"));
    const id = String(++this.sequence);
    return new Promise((resolveRequest, reject) => {
      this.pending.set(id, { resolve: resolveRequest, reject });
      // Stream writes are ordered; the callback waits for the write to be flushed.
      this.child!.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`, error => {
        if (error) { this.pending.delete(id); reject(error); this.stop("failed", "Pi stdin failed"); }
      });
    });
  }
  private readyToCheck() { return this.sessionSettled && !this.retrying; }
  private isComplete(version: number, state: RecordValue) {
    return version === this.epoch && this.readyToCheck() && !this.streaming && !this.events?.waiting && state.isStreaming === false && state.isCompacting !== true && state.pendingMessageCount === 0 && this.pending.size === 0;
  }
  private async checkEnd() {
    if (this.inactive() || !this.readyToCheck() || this.checking) return;
    this.checking = true;
    const version = this.epoch;
    try {
      const state = await this.send("get_state");
      if (typeof state.sessionId === "string") this.sessionId = state.sessionId;
      await this.finishIfComplete(version, state);
    } catch { if (!this.inactive()) this.stop("failed", "Could not inspect Pi completion state"); }
    finally {
      this.checking = false;
      // A newer settled event can arrive while an older snapshot is in flight.
      if (!this.inactive() && this.readyToCheck()) this.pollEnd(25);
    }
  }
  private async finishIfComplete(version: number, state: RecordValue) {
    if (this.inactive() || !this.isComplete(version, state)) return;
    await this.collectUsage();
    if (!this.inactive() && this.isComplete(version, state)) this.stop(this.modelError ? "failed" : "finished", this.modelError);
  }
  private async collectUsage(cancelling = false) {
    if (this.events) await bounded(this.events.collect(() => this.inspectStats(cancelling)), 750).catch(() => {});
  }
  private pollEnd(delay: number) {
    clearTimeout(this.poll);
    this.poll = setTimeout(() => { void this.checkEnd(); }, delay);
  }
  private async abortWith(outcome: "failed" | "timed_out", error = outcome === "timed_out" ? "Pi deadline exceeded" : "Pi run aborted") {
    if (!this.inactive()) {
      this.cancellation = { outcome, error, sessionId: this.sessionId };
      this.sessionSettled = false; this.epoch++; this.events?.interrupt();
      await this.startup;
      if (this.child && !this.closing && !this.settled) {
        try {
          // abort can resume queued work. Never send it unless clearing succeeded.
          await bounded(this.send("clear_queue", {}, true));
          await bounded(this.send("abort", {}, true));
          await this.collectUsage(true);
        } catch { /* Close/kill instead. Chrona retains the persisted user input. */ }
      }
      this.stop(outcome, error);
    }
    await this.done;
  }
  private response(event: RecordValue) {
    const request = this.pending.get(String(event.id));
    if (!request) return;
    this.pending.delete(String(event.id));
    if (event.success === true) request.resolve(object(event.data));
    else request.reject(new Error(this.redact(typeof event.error === "string" ? event.error : "Pi RPC command failed")));
  }
  private agentEnd(event: RecordValue) {
    this.streaming = false; this.sessionSettled = false; this.epoch++;
    if (Array.isArray(event.messages)) {
      const last = event.messages.map(object).filter(message => message.role === "assistant").at(-1);
      if (last) this.modelError = messageError(last);
    }
  }
  private messageEnd(value: unknown) {
    const message = object(value);
    if (message.role === "assistant") this.modelError = messageError(message);
  }
  private agentSettled(event: RecordValue) {
    this.sessionSettled = true; this.streaming = false; this.epoch++;
    if (event.aborted === true) this.modelError = "Pi run aborted";
    this.pollEnd(0);
  }
  private async inspectStats(cancelling = false) {
    const id = String(this.sequence + 1);
    try { return await bounded(this.send("get_session_stats", {}, cancelling), 250); }
    finally { this.pending.delete(id); }
  }
  private writeUi(record: RecordValue): Promise<void> {
    if (this.inactive() || !this.child) return Promise.reject(new Error("Pi run is not active"));
    return new Promise((resolveWrite, reject) => this.child!.stdin.write(`${JSON.stringify(record)}\n`, error => error ? reject(error) : resolveWrite()));
  }
  private receive(value: unknown) {
    const event = object(value);
    this.touch(event);
    this.events?.receive(event);
    this.detail?.receive(event);
    switch (event.type) {
      case "response": this.response(event); break;
      case "agent_start": this.streaming = true; this.sessionSettled = false; this.modelError = null; this.epoch++; break;
      case "auto_retry_start": this.retrying = true; this.sessionSettled = false; this.epoch++; break;
      case "auto_retry_end": this.retrying = false; break;
      case "compaction_start": case "summarization_retry_scheduled": this.sessionSettled = false; this.epoch++; break;
      case "message_end": this.messageEnd(event.message); break;
      case "agent_end": this.agentEnd(event); break;
      case "agent_settled": this.agentSettled(event); break;
    }
  }
  private listen(child: PiProcess, supervised: boolean) {
    child.stdin.on("error", () => this.stop("failed", "Pi stdin failed"));
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-8000); });
    child.stdout.on("data", rpcLines(value => this.receive(value), message => this.stop("failed", message)));
    void child.closed.then(({ code, signal }) => {
      if (!supervised && code === null && signal === null) this.stop("unavailable", "Could not start Pi");
      this.finalize();
    }, error => this.unconfirmedClosure(error));
  }
  private async loadResources(config: PiLaunchConfig) {
    const state = await this.send("get_state");
    if (this.input.model) {
      const model = object(state.model);
      if (`${model.provider}/${model.id}` !== this.input.model) throw new Error("Pi selected a different model than the authorized build");
      }
    if (this.input.model || this.input.resources === "minimal") {
      await this.send("set_auto_retry", { enabled: false });
      await this.send("set_auto_compaction", { enabled: false });
    }
    if (typeof state.sessionId === "string") this.sessionId = state.sessionId;
    const resources = await this.send("get_commands");
    const selected = this.input.resources === "configured" ? config : { ...config, web: null, resources: { skills: [], extensions: [], tools: [] } };
    if (!expectedPiCommands(selected, resources.commands)) { this.stop("unavailable", "Unexpected Pi command resources; use a service-specific executable/profile"); return; }
    await this.events?.resources(config.version, resources.commands, new Set([selected.extension, selected.web, ...selected.resources.extensions].filter(Boolean)).size);
    await this.events?.initialize(() => this.inspectStats());
  }
  private async submitPrompt(fields: RecordValue) {
    const accepted = await this.send("prompt", fields);
    // Pi 1.3 explicitly reports commands/input handlers that started no model turn.
    // A fresh state check still protects independently started work and UI replies.
    if (accepted.disposition === "handled" && !this.streaming) { this.sessionSettled = true; this.epoch++; this.pollEnd(0); }
  }
  private async prompt(config: PiLaunchConfig) {
    this.resourcesReady = this.loadResources(config);
    try {
      await this.resourcesReady;
      await this.submitPrompt({ message: this.input.prompt, images: imagesFor(this.input.images) });
    } catch (error) { if (!this.inactive()) this.stop("failed", error instanceof Error ? error.message : "Pi prompt failed"); }
  }
  private async prepare(config: PiLaunchConfig) {
    try {
      const invalid = await inspectPiLaunch(config);
      if (this.inactive()) return;
      if (invalid) { this.stop("unavailable", invalid); return; }
      if (profileOverlaps(config.agentDir, resolve(this.input.cwd))) { this.stop("unavailable", "Pi profile must be separate from the working directory"); return; }
      if (this.input.resources === "configured" || this.input.content?.length) prepareContent(this.input, !config.bwrap);
      // RPC retry/compaction setters persist settings. Give bounded builds a disposable profile,
      // sharing Pi-managed auth/models by reference, never changing the service's own settings.
      this.runProfile = buildProfile(config, this.input);
      this.child = this.spawn(config);
      this.listen(this.child, !!config.options.launch);
      this.touch();
      void this.prompt(config);
    } catch { if (!this.inactive()) this.stop("unavailable", "Could not start Pi"); }
  }
  private spawn(config: PiLaunchConfig) {
    const browser = this.input.resources === "configured" && config.browserExtension ? config.options.browsers?.ensure() ?? null : null;
    return (config.options.launch ?? launchPiProcess)({ file: config.bwrap ?? config.command, args: piArguments(config, this.input, this.input.systemPrompt, browser), cwd: resolve(this.input.cwd),
      env: { ...piEnvironment(config), PI_CODING_AGENT_DIR: this.runProfile ?? config.agentDir, CHRONA_AGENT_URL: config.options.agentUrl, CHRONA_AGENT_TOKEN: this.input.token, ...(this.input.executionBudget ? { CHRONA_EXECUTION_MAX_TOOL_CALLS: String(this.input.executionBudget.maxToolCalls) } : {}), ...(browser ? { CHRONA_BROWSER: browser } : {}) } });
  }
  start(config: PiLaunchConfig) {
    this.secrets = [this.input.token, ...Object.entries(piEnvironment(config)).flatMap(([key, value]) => key.endsWith("API_KEY") && value ? [value] : [])];
    const events = this.input.events;
    const input = events ? { ...this.input, events: { ...events, usage: async (value: Parameters<typeof events.usage>[0]) => { this.detail?.emit({ type: "usage", input: value.input, output: value.output }); await events.usage(value); } } } : this.input;
    this.events = new PiEvents(input, this.secrets, record => this.writeUi(record), message => { void this.abortWith("failed", message).catch(() => {}); });
    if (this.input.execution && this.input.detail) {
      this.detail = new PiDetail(this.input, this.secrets);
      this.detail.emit({ type: "state", status: "running", cancelRequested: false, stopConfirmed: false });
    }
    const remaining = this.input.deadline.getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) { this.stop("timed_out", "Pi deadline exceeded"); return; }
    this.timer = setTimeout(() => { void this.abortWith("timed_out").catch(() => {}); }, Math.min(remaining, 2_147_483_647));
    this.startup = this.prepare(config);
  }
  async inject(message: string, images?: ProviderRunInput["images"]) {
    if (this.inactive()) throw new Error("Pi run is not active");
    this.epoch++; this.sessionSettled = false;
    await this.startup;
    await this.resourcesReady;
    // Pi decides atomically: steer while busy, start a turn if already idle.
    // Queue-only steer/follow_up can strand input after agent_settled.
    await this.submitPrompt({ message, images: imagesFor(images), streamingBehavior: "steer" });
  }
  async abort() { await this.abortWith("failed"); }
}

/** Pi 0.85.0 and 1.x (1.3.0 or later) all expose the session-level agent_settled boundary. */
export function createPiProvider(options: PiProviderOptions): ProviderAdapter {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/api\/steward-agent$/.test(options.agentUrl)) throw new Error("Chrona agent URL must be loopback");
  const config = piLaunchConfig(options);
  return {
    name: "pi",
    transcript: piTranscript,
    supportsRunModel: true,
    async health() {
      const error = await inspectPiLaunch(config);
      return { available: error === null, sandboxed: error === null && config.bwrap !== null, error };
    },
    complete: createPiModelGateway(options).complete,
    start(input) {
      const run = new PiRun(input, options.idleTimeoutMs);
      run.start(config);
      return { done: run.done, inject: (message, images) => run.inject(message, images), abort: () => run.abort() };
    },
  };
}
