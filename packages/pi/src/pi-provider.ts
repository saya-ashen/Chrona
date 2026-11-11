import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { providerText } from "@chrona/domain/steward/provider";
import { PiEvents } from "./pi-events";
import { PiDetail } from "./pi-detail";
import { PiRawRecords, nativeError, nativeRequest, nativeResponse, piRunInput, promptCommands } from "./pi-native";
import { validatePiSessionResume } from "./pi-session-resume";
import { piTranscript } from "./pi-transcript";
import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { createPiCompletion } from "./pi-completion";
import { launchPiProcess, type PiProcess } from "./pi-process";
import { inspectPiLaunch, piArguments, piEnvironment, piLaunchConfig, prepareContent, profileOverlaps, type PiLaunchConfig, type PiProviderOptions } from "./pi-launch";
export type { PiProviderOptions } from "./pi-launch";

type Result = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
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

/** Owns one subprocess and its mutable RPC/completion state. */
class PiRun {
  private child: PiProcess | undefined;
  private events: PiEvents | undefined;
  private detail: PiDetail | undefined;
  private raw: PiRawRecords | undefined;
  private secrets: string[] = [];
  private sessionId: ProviderRunInput["sessionId"];
  private readonly resumeSessionId: ProviderRunInput["sessionId"];
  private sequence = 0;
  private epoch = 0;
  private streaming = false;
  private sessionSettled = false;
  private retrying = false;
  private checking = false;
  private nativeInFlight = 0;
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
  private pending = new Map<string, { type: string; envelope: boolean; resolve(value: RecordValue): void; reject(error: Error): void }>();

  constructor(private input: ProviderRunInput, private idleMs?: number, private nativeTimeoutMs = 30_000) {
    this.sessionId = input.sessionId;
    this.resumeSessionId = input.execution ? input.sessionId : null;
  }
  /** Idle cancellation is opt-in; silent model turns have no implicit Run time limit. */
  private touch(event?: RecordValue) {
    if (event?.type === "tool_execution_start") {
      this.runningTools++;
      this.toolCalls++;
      // The extension's pre-tool hook enforces admission; this observes already-started tools only.
      if (this.input.executionBudget && this.toolCalls > this.input.executionBudget.maxToolCalls) void this.abortWith("failed", "Execution tool budget exceeded").catch(() => {});
    }
    if (event?.type === "tool_execution_end") this.runningTools = Math.max(0, this.runningTools - 1);
    clearTimeout(this.idle);
    const idleMs = this.idleMs;
    if (this.inactive() || idleMs === undefined) return;
    this.idle = setTimeout(() => {
      // Long tool runs and open user questions are progress the RPC stream does not show.
      if (this.runningTools > 0 || this.events?.waiting) { this.touch(); return; }
      void this.abortWith("timed_out", `Pi produced no output for ${Math.round(idleMs / 1000)}s`).catch(() => {});
    }, idleMs);
  }
  private redact(text: string) {
    return providerText(stripVTControlCharacters(text), this.secrets, 1000);
  }
  private inactive() { return this.closing !== null || this.settled || this.cancellation !== null; }
  private finalize() {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer); clearTimeout(this.poll); clearTimeout(this.killTimer); clearTimeout(this.idle);
    for (const request of this.pending.values()) request.reject(new Error("Pi run ended"));
    this.pending.clear();
    const result = this.closing ?? this.cancellation ?? { outcome: "failed" as const, sessionId: this.sessionId, error: this.redact(`Pi exited before completion. ${this.stderr}`) };
    void (async () => {
      await bounded(this.events?.close() ?? Promise.resolve(), 1000).catch(() => {});
      let error: string | undefined;
      try { await this.detail?.close(result.outcome === "finished" ? "completed" : "failed"); }
      catch { error = "Execution detail is incomplete; recover the final snapshot"; }
      try { await this.raw?.close(); }
      catch (cause) { error = cause instanceof Error ? this.redact(cause.message) : "Pi raw event stream is incomplete"; }
      this.complete(error ? { ...result, outcome: "failed", error } : result);
    })();
  }
  /** Closure uncertainty must never become fulfilled completion. */
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
  private send(type: string, fields: RecordValue = {}, cancelling = false, envelope = false): Promise<RecordValue> {
    if (this.closing || this.settled || this.cancellation && !cancelling || !this.child) return Promise.reject(new Error("Pi run is not active"));
    const id = String(++this.sequence);
    return new Promise((resolveRequest, reject) => {
      this.pending.set(id, { type, envelope, resolve: resolveRequest, reject });
      // Stream writes are ordered; the callback waits for the write to be flushed.
      this.child!.stdin.write(`${JSON.stringify({ ...fields, id, type })}\n`, error => {
        if (error) { this.pending.delete(id); reject(error); this.stop("failed", "Pi stdin failed"); }
      });
    });
  }
  private readyToCheck() { return this.sessionSettled && !this.retrying; }
  private isComplete(version: number, state: RecordValue) {
    return version === this.epoch && this.readyToCheck() && !this.streaming && !this.events?.waiting && state.isStreaming === false && state.isCompacting !== true && state.pendingMessageCount === 0 && this.pending.size === 0 && this.nativeInFlight === 0;
  }
  private async checkEnd() {
    if (this.inactive() || !this.readyToCheck() || this.checking) return;
    this.checking = true;
    const version = this.epoch;
    try {
      const state = await this.send("get_state");
      if (typeof state.sessionId === "string" && this.sessionId !== null && state.sessionId !== this.sessionId) throw new Error("Pi session changed");
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
    let response: RecordValue | undefined;
    if (!this.inactive()) {
      this.cancellation = { outcome, error, sessionId: this.sessionId };
      this.sessionSettled = false; this.epoch++; this.events?.interrupt();
      await this.startup;
      if (this.child && !this.closing && !this.settled) {
        try {
          // abort can resume queued work. Never send it unless clearing succeeded.
          await bounded(this.send("clear_queue", {}, true));
          response = await bounded(this.send("abort", {}, true, true));
          await this.collectUsage(true);
        } catch { /* Close/kill instead. Chrona retains the persisted user input. */ }
      }
      this.stop(outcome, error);
    }
    await this.done;
    return response;
  }
  private response(event: RecordValue) {
    const request = this.pending.get(String(event.id));
    if (!request) return;
    this.pending.delete(String(event.id));
    if (event.command !== request.type || typeof event.success !== "boolean") {
      request.reject(nativeError("unknown", "Pi RPC response correlation failed"));
      this.stop("failed", "Pi RPC response correlation failed"); return;
    }
    if (request.envelope) request.resolve(event);
    else if (event.success === true) request.resolve(object(event.data));
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
  private retryEnd(event: RecordValue) {
    this.retrying = false;
    if (event.success === false) this.modelError = typeof event.finalError === "string" && event.finalError ? event.finalError : this.modelError || "Pi model retry failed";
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
  private observe(event: RecordValue) {
    this.raw?.receive(event);
    this.touch(event);
    this.events?.receive(event);
    this.detail?.receive(event);
  }
  private receive(value: unknown) {
    const event = object(value);
    this.observe(event);
    switch (event.type) {
      case "response": this.response(event); break;
      case "agent_start": this.streaming = true; this.sessionSettled = false; this.modelError = null; this.epoch++; break;
      case "auto_retry_start": this.retrying = true; this.sessionSettled = false; this.epoch++; break;
      case "auto_retry_end": this.retryEnd(event); break;
      case "compaction_start": case "summarization_retry_scheduled": this.sessionSettled = false; this.epoch++; break;
      case "message_end": this.messageEnd(event.message); break;
      case "agent_end": this.agentEnd(event); break;
      case "agent_settled": this.agentSettled(event); break;
    }
  }
  private listen(child: PiProcess) {
    child.stdin.on("error", () => this.stop("failed", "Pi stdin failed"));
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-8000); });
    child.stdout.on("data", rpcLines(value => this.receive(value), message => this.stop("failed", message)));
    void child.closed.then(() => this.finalize(), error => this.unconfirmedClosure(error));
  }
  private async loadResources(config: PiLaunchConfig) {
    const state = await this.send("get_state");
    if (this.resumeSessionId !== null && state.sessionId !== this.resumeSessionId) throw new Error("Pi resumed a different session than the requested execution context");
    if (this.input.model) {
      const model = object(state.model);
      if (`${model.provider}/${model.id}` !== this.input.model) throw new Error("Pi selected a different model than the authorized build");
    }
    if (typeof state.sessionId === "string") this.sessionId = state.sessionId;
    const resources = await this.send("get_commands");
    await this.events?.resources(config.version, resources.commands, new Set([config.extension, config.web, ...config.resources.extensions].filter(Boolean)).size);
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
      if (this.resumeSessionId !== null) {
        const error = await validatePiSessionResume({ sessionDir: this.input.sessionDir, sessionId: this.resumeSessionId, cwd: this.input.cwd });
        if (this.inactive()) return;
        if (error) { this.stop("failed", error); return; }
      }
      const invalid = await inspectPiLaunch(config);
      if (this.inactive()) return;
      if (invalid) { this.stop("unavailable", invalid); return; }
      if (profileOverlaps(config.agentDir, resolve(this.input.cwd))) { this.stop("unavailable", "Pi profile must be separate from the working directory"); return; }
      if (this.input.resources === "configured" || this.input.content?.length) prepareContent(this.input);
      this.child = this.spawn(config);
      this.listen(this.child);
      this.touch();
      void this.prompt(config);
    } catch { if (!this.inactive()) this.stop("unavailable", "Could not start Pi"); }
  }
  private spawn(config: PiLaunchConfig) {
    const browser = config.browserExtension ? config.options.browsers?.ensure() ?? null : null;
    return (config.options.launch ?? launchPiProcess)({ file: config.command, args: piArguments(config, this.input, this.input.systemPrompt, browser), cwd: resolve(this.input.cwd), helperPath: config.options.processHelper,
      env: { ...piEnvironment(config), CHRONA_AGENT_URL: config.options.agentUrl, CHRONA_AGENT_TOKEN: this.input.token, ...(this.input.executionBudget ? { CHRONA_EXECUTION_MAX_TOOL_CALLS: String(this.input.executionBudget.maxToolCalls) } : {}), ...(browser ? { CHRONA_BROWSER: browser } : {}) } });
  }
  start(config: PiLaunchConfig) {
    this.secrets = [this.input.token, ...Object.entries(piEnvironment(config)).flatMap(([key, value]) => key.endsWith("API_KEY") && value ? [value] : [])];
    const events = this.input.events;
    if (events?.raw) this.raw = new PiRawRecords(events.raw.bind(events), this.secrets, message => this.stop("failed", message));
    const input = events ? { ...this.input, events: { ...events, usage: async (value: Parameters<typeof events.usage>[0]) => { this.detail?.emit({ type: "usage", input: value.input, output: value.output }); await events.usage(value); } } } : this.input;
    this.events = new PiEvents(input, this.secrets, record => this.writeUi(record), message => { void this.abortWith("failed", message).catch(() => {}); });
    if (this.input.execution && this.input.detail) {
      this.detail = new PiDetail(this.input, this.secrets);
      this.detail.emit({ type: "state", status: "running", cancelRequested: false, stopConfirmed: false });
    }
    if (this.input.deadline !== null) {
      const remaining = this.input.deadline.getTime() - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) { this.stop("timed_out", "Pi deadline exceeded"); return; }
      this.armDeadline();
    }
    this.startup = this.prepare(config);
  }
  private armDeadline() {
    if (this.inactive() || this.input.deadline === null) return;
    const remaining = this.input.deadline.getTime() - Date.now();
    if (remaining <= 0) { void this.abortWith("timed_out").catch(() => {}); return; }
    this.timer = setTimeout(() => this.armDeadline(), Math.min(remaining, 2_147_483_647));
  }
  /** Escape hatch on this exact process. Never replays a request after uncertainty. */
  async native(request: RecordValue): Promise<RecordValue> {
    const command = nativeRequest(request, this.input.model);
    if (this.inactive()) throw nativeError("unavailable", "Pi run is not active");
    if (this.nativeInFlight >= 32) throw nativeError("unavailable", "Too many pending Pi protocol requests");
    this.nativeInFlight++;
    try {
      try { await this.startup; await this.resourcesReady; }
      catch { throw nativeError("unavailable", "Pi startup did not complete"); }
      if (this.inactive() || !this.child) throw nativeError("unavailable", "Pi run is not active");
      return await this.nativeCommand(command);
    } finally {
      this.nativeInFlight--;
      if (!this.inactive() && this.readyToCheck()) this.pollEnd(0);
    }
  }
  private async nativeSend(type: string, fields: RecordValue = {}, envelope = false) {
    const id = String(this.sequence + 1);
    try { return await bounded(this.send(type, fields, false, envelope), this.nativeTimeoutMs); }
    catch {
      this.stop("failed", "Pi native request outcome is unknown; do not replay");
      throw nativeError("unknown", "Pi native request outcome is unknown; do not replay");
    } finally { this.pending.delete(id); }
  }
  private async nativeCommand({ type, fields, callerId }: ReturnType<typeof nativeRequest>) {
    if (type === "bash" && this.input.executionBudget) throw nativeError("unsupported", "Native bash cannot bypass the Run tool admission guard");
    const wasSettled = this.sessionSettled, version = ++this.epoch;
    if (promptCommands.has(type)) this.sessionSettled = false;
    if (type === "abort") return nativeResponse(await this.nativeAbort(), callerId, this.secrets);
    const response = await this.nativeSend(type, type === "prompt" ? { streamingBehavior: "steer", ...fields } : fields, true);
    if (response.success === true && !this.inactive()) await this.synchronizeNative();
    this.nativeSettlement(type, response, version, wasSettled);
    return nativeResponse(response, callerId, this.secrets);
  }
  private async nativeAbort() {
    let response: RecordValue | undefined;
    try { response = await this.abortWith("failed"); }
    catch { throw nativeError("unknown", "Pi abort closure is unconfirmed; do not replay"); }
    if (!response) throw nativeError("unknown", "Pi abort response is unavailable; do not replay");
    return response;
  }
  private nativeSettlement(type: string, response: RecordValue, version: number, wasSettled: boolean) {
    // A rejected prompt starts no turn. Restore settlement only if no newer event changed it.
    if (response.success === false && version === this.epoch) this.sessionSettled = wasSettled;
    if (type === "prompt" && response.success === true && object(response.data).disposition === "handled" && !this.streaming) this.sessionSettled = true;
  }
  private async synchronizeNative() {
    const state = await this.nativeSend("get_state");
    if (typeof state.sessionId === "string" && this.sessionId !== null && state.sessionId !== this.sessionId) {
      this.stop("failed", "Pi native command changed the bound session; outcome is unknown");
      throw nativeError("unknown", "Pi native state synchronization failed; do not replay");
    }
    if (state.isStreaming === true || state.isCompacting === true || Number(state.pendingMessageCount) > 0) this.sessionSettled = false;
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
      return { available: error === null, sandboxed: false, error };
    },
    complete: createPiCompletion(options),
    start(input) {
      const run = new PiRun(piRunInput(input, options), options.idleTimeoutMs, options.nativeTimeoutMs);
      run.start(config);
      return { native: request => run.native(request), done: run.done, inject: (message, images) => run.inject(message, images), abort: () => run.abort() };
    },
  };
}
