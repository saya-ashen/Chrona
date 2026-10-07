import type {
  ProviderApprovalResolution, ProviderRunEvent, ProviderRunRef, ProviderRunSnapshot,
  ProviderUsage, ResolveProviderApprovalInput, StartRunInput,
} from "@chrona/providers-foundation";
import { redactSensitiveText } from "@chrona/logging";
import { PiRpc, PiRpcClosedBeforeCompletionError, record, type RecordValue } from "./rpc";
import { PiRunTools } from "./run-tools";
import type { PiState } from "./state";

const MAX_OUTPUT = 1024 * 1024;
type BridgePhase =
  | "before_terminal_call"
  | "terminal_call_received"
  | "terminal_submission_pending"
  | "terminal_submission_acknowledged";

type NonterminalInvocation = {
  start: boolean;
  end: boolean;
  bridgeCall: boolean;
  resultProduced: boolean;
  bridgeReplySent: boolean;
  correlated: boolean;
};

/**
 * Bounded aggregate facts for bridge tools only. The first 24 distinct call IDs
 * stay in-memory solely for correlation and never appear in an error, event,
 * snapshot, or log; later or invalid IDs mark the aggregate incomplete.
 */
class NonterminalToolLifecycle {
  private readonly calls = new Map<string, NonterminalInvocation>();
  private starts = 0;
  private ends = 0;
  private bridgeCalls = 0;
  private resultsProduced = 0;
  private bridgeRepliesSent = 0;
  private correlated = 0;
  private correlationIncomplete = false;
  private readonly limit = 24;

  executionStart(id: unknown) { this.mark(id, "start", "starts"); }
  executionEnd(id: unknown) { this.mark(id, "end", "ends"); }
  bridgeCall(id: unknown) { this.mark(id, "bridgeCall", "bridgeCalls"); }
  resultProduced(id: unknown) { this.mark(id, "resultProduced", "resultsProduced"); }
  bridgeReplySent(id: unknown) { this.mark(id, "bridgeReplySent", "bridgeRepliesSent"); }

  summary() {
    let open = 0;
    for (const call of this.calls.values()) if (call.start && !call.end) open++;
    const counts = `pi_start=${this.starts},pi_end=${this.ends},bridge_call_received=${this.bridgeCalls},result_produced=${this.resultsProduced},bridge_reply_written=${this.bridgeRepliesSent},correlated=${this.correlated},unended=${open}`;
    return this.correlationIncomplete ? `${counts}; counts_tracked_subset=true,correlation_incomplete=true` : counts;
  }

  private mark(id: unknown, fact: keyof Omit<NonterminalInvocation, "correlated">, counter: "starts" | "ends" | "bridgeCalls" | "resultsProduced" | "bridgeRepliesSent") {
    if (typeof id !== "string" || id.length === 0 || id.length > 128) {
      this.correlationIncomplete = true;
      return;
    }
    let call = this.calls.get(id);
    if (!call) {
      if (this.calls.size >= this.limit) {
        this.correlationIncomplete = true;
        return;
      }
      call = { start: false, end: false, bridgeCall: false, resultProduced: false, bridgeReplySent: false, correlated: false };
      this.calls.set(id, call);
    }
    if (!call[fact]) {
      call[fact] = true;
      this[counter]++;
    }
    if (!call.correlated && call.start && call.bridgeCall) {
      call.correlated = true;
      this.correlated++;
    }
  }
}

export class PiRun {
  readonly ref: ProviderRunRef;
  readonly abort = new AbortController();
  readonly tools: PiRunTools;
  rpc?: PiRpc;
  effectiveModel?: string;
  terminal?: NonNullable<ProviderRunSnapshot["terminalToolCall"]>;
  private output = "";
  private usage?: ProviderUsage;
  private modelError = false;
  private readonly queue: ProviderRunEvent[] = [];
  private queueBytes = 0;
  private wake?: () => void;
  private done = false;
  private sequence = 0;
  private streaming = false;
  private approval?: { id: string; timer?: ReturnType<typeof setTimeout> };
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly abortListener: () => void;
  private release?: () => Promise<void>;
  private error?: string;
  private cleanup?: Promise<void>;
  private bridgePhase: BridgePhase = "before_terminal_call";
  private readonly nonterminalTools = new NonterminalToolLifecycle();
  private initialized!: () => void;
  private readonly bridgeInitialized = new Promise<void>((resolve) => { this.initialized = resolve; });
  private bridgeIsInitialized = false;
  private ready!: () => void;
  private readonly bridgeReady = new Promise<void>((resolve) => { this.ready = resolve; });

  constructor(readonly input: StartRunInput, runId: string, private readonly state: PiState, timeoutMs: number) {
    this.ref = { provider: "pi", runId, sessionId: input.sessionId, status: "running", startedAt: new Date().toISOString(), stream: { supported: true, reconnectable: false } };
    this.tools = new PiRunTools(input, this.abort.signal);
    this.timer = setTimeout(() => this.fail("Pi run timed out; its outcome will not be replayed automatically."), timeoutMs);
    this.abortListener = () => this.cancel();
    input.signal?.addEventListener("abort", this.abortListener, { once: true });
  }

  async start(bridge: string, sessionFile: string, model?: string, prompt = true) {
    if (this.input.signal?.aborted) this.cancel();
    const signal = this.abort.signal;
    let interrupt = () => {};
    try {
      signal.throwIfAborted();
      await Promise.race([
        this.initialize(bridge, sessionFile, model, prompt),
        new Promise<never>((_resolve, reject) => {
          interrupt = () => reject(new Error(this.error ?? "Pi startup was cancelled"));
          if (signal.aborted) interrupt();
          else signal.addEventListener("abort", interrupt, { once: true });
        }),
      ]);
    } finally { signal.removeEventListener("abort", interrupt); }
  }

  private async initialize(bridge: string, sessionFile: string, model?: string, prompt = true) {
    this.release = await this.state.lockSession(sessionFile);
    if (this.isDone()) { await this.releaseSession(); return; }
    await this.tools.initialize();
    if (this.isDone()) { await this.tools.close(); return; }
    const isolated = this.input.toolPolicy !== "full";
    const args = this.arguments(bridge, sessionFile, isolated, model);
    this.rpc = new PiRpc({
      command: this.state.binaryPath, args, cwd: this.state.cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: this.state.agentDir, PI_OFFLINE: "1" },
      timeoutMs: 30_000,
      onEvent: (event) => this.onEvent(event),
      onBridge: (event) => { void this.onBridge(event).catch(() => this.fail("Pi bridge failed. No fallback was attempted.")); },
      onFailure: (error) => this.fail(this.describeRpcFailure(error)),
    });
    if (!await this.rpc.bridge({ type: "init", tools: this.tools.tools, isolated, instructions: this.input.instructions })) {
      throw new Error("Pi bridge initialization failed");
    }
    await this.waitForBridgeInitialized();
    const current = await this.rpc.request("get_state");
    await this.waitForBridge();
    const actualModel = this.verifyModel(current.model, model);
    if (typeof current.sessionId !== "string" || current.sessionFile !== sessionFile) throw new Error("Pi did not preserve Chrona's session ownership");
    this.effectiveModel = actualModel;
    if (!prompt) return;
    await this.state.saveSession(current.sessionId, sessionFile, actualModel);
    if (this.isDone()) return;
    this.ref.nativeSessionId = current.sessionId;
    this.ref.providerResumeRef = current.sessionId;
    if (isolated) {
      await this.rpc.request("set_auto_retry", { enabled: false });
      await this.rpc.request("set_auto_compaction", { enabled: false });
    }
    if (this.isDone()) return;
    this.emit({ type: "run_started", run: { ...this.ref } });
    const text = typeof this.input.input === "string" ? this.input.input : JSON.stringify(this.input.input);
    // Prefix prevents task data beginning with '/' from dispatching an extension command.
    void this.rpc.request("prompt", { message: `Chrona work request:\n${text}` }).catch(() => this.fail("Pi rejected the prompt. Check model access and extension compatibility."));
  }

  private isDone() { return this.done; }

  private arguments(bridge: string, sessionFile: string, isolated: boolean, model?: string) {
    const args = ["--mode", "rpc", "--session", sessionFile, "--extension", bridge];
    if (isolated) args.push("--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-approve", "--tools", this.tools.tools.map((tool) => tool.name).join(","), "--system-prompt", "Follow the supplied Chrona instructions. Use only the declared tools.");
    if (model) args.push("--model", model);
    return args;
  }

  private verifyModel(value: unknown, requested?: string) {
    const actual = record(value);
    if (typeof actual.id !== "string" || typeof actual.provider !== "string") throw new Error("Pi has no configured model. Configure Pi before retrying.");
    const model = `${actual.provider}/${actual.id}`;
    if (requested && model !== requested) throw new Error("Pi selected a different model. Use an exact provider/model identifier; silent fallback is not allowed.");
    return model;
  }

  private async waitForBridgeInitialized() {
    await this.waitForBridgeSignal(this.bridgeInitialized);
  }

  private async waitForBridge() {
    await this.waitForBridgeSignal(this.bridgeReady);
  }

  private async waitForBridgeSignal(signalPromise: Promise<void>) {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]);
    let interrupt: () => void = () => {};
    try {
      await Promise.race([signalPromise, new Promise<never>((_resolve, reject) => {
        interrupt = () => reject(new Error("Pi bridge startup timed out or was interrupted"));
        if (signal.aborted) interrupt();
        else signal.addEventListener("abort", interrupt, { once: true });
      })]);
    } finally { signal.removeEventListener("abort", interrupt); }
  }

  private emit(event: ProviderRunEvent) {
    if (this.done) return;
    const value = { ...event, provider: "pi", runId: this.ref.runId, sessionId: this.ref.sessionId, nativeSessionId: this.ref.nativeSessionId, sequence: ++this.sequence, timestamp: new Date().toISOString() };
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (this.queueBytes + bytes > 8 * MAX_OUTPUT && event.type !== "run_failed") {
      this.fail("Pi event buffer exceeded its limit"); return;
    }
    this.queue.push(value);
    this.queueBytes += bytes;
    this.wake?.();
  }

  private async onBridge(event: RecordValue) {
    if (this.done) return;
    if (event.type === "initialized") {
      if (this.bridgeIsInitialized) throw new Error("Invalid bridge message");
      this.bridgeIsInitialized = true;
      this.initialized();
      return;
    }
    if (event.type === "ready") {
      if (!this.bridgeIsInitialized) throw new Error("Invalid bridge message");
      this.ready();
      return;
    }
    if (event.type !== "call" || typeof event.id !== "string" || typeof event.name !== "string") throw new Error("Invalid bridge message");
    await this.onBridgeCall(event.id, event.name, record(event.input));
  }

  private async onBridgeCall(callId: string, name: string, args: RecordValue) {
    const terminal = this.beginBridgeCall(name);
    const nonterminal = !terminal && this.isDeclaredBridgeTool(name);
    if (nonterminal) this.nonterminalTools.bridgeCall(callId);
    try {
      this.beginTerminalSubmission(terminal);
      const result = await this.tools.call(name, args);
      if (nonterminal) this.nonterminalTools.resultProduced(callId);
      this.recordTerminalSubmission(terminal, name, callId, args);
      if (!await this.replyToBridge(callId, { result }, nonterminal)) throw new Error("Pi bridge reply failed");
    } catch {
      // A durable terminal acknowledgement remains authoritative even if the
      // subsequent bridge reply disconnects; no terminal action is replayed.
      if (!this.terminal) await this.replyToBridge(callId, { error: "Chrona rejected this tool call. Do not repeat an uncertain terminal submission." }, nonterminal);
      this.rejectTerminalSubmission(terminal);
    }
  }

  private async replyToBridge(callId: string, response: RecordValue, nonterminal: boolean) {
    const callbackAccepted = await this.rpc?.bridge({ type: "result", id: callId, ...response }) === true;
    // Callback acceptance is a bounded write fact, not proof Pi consumed it.
    if (nonterminal && callbackAccepted) this.nonterminalTools.bridgeReplySent(callId);
    return callbackAccepted;
  }

  private beginBridgeCall(name: string) {
    const terminal = this.tools.isTerminal(name);
    if (terminal) this.bridgePhase = "terminal_call_received";
    return terminal;
  }

  private beginTerminalSubmission(terminal: boolean) {
    if (terminal) this.bridgePhase = "terminal_submission_pending";
  }

  private recordTerminalSubmission(terminal: boolean, name: string, callId: string, input: RecordValue) {
    if (!terminal) return;
    this.bridgePhase = "terminal_submission_acknowledged";
    if (this.terminal) throw new Error("Duplicate terminal result");
    this.terminal = { name, callId, input };
    this.emit({ type: "tool_call", tool: name, callId, input, status: "completed" });
  }

  private rejectTerminalSubmission(terminal: boolean) {
    if (terminal) this.fail("Pi terminal submission failed or was duplicated. Review execution evidence before retrying.");
  }

  private isDeclaredBridgeTool(name: string) {
    return this.tools.tools.some((tool) => tool.name === name);
  }

  private describeRpcFailure(error: Error) {
    if (error instanceof PiRpcClosedBeforeCompletionError) {
      const stderr = this.rpc?.stderrDiagnostics() ?? "stderr_class=none";
      return `${error.message} (phase ${this.bridgePhase}; nonterminal_tools ${this.nonterminalTools.summary()}; ${stderr}); no fallback was attempted.`;
    }
    return error.message;
  }

  private onEvent(event: RecordValue) {
    if (this.done) return;
    switch (event.type) {
      case "message_update": this.messageDelta(record(event.assistantMessageEvent)); break;
      case "message_end": this.messageEnd(record(event.message)); break;
      case "tool_execution_start": this.toolEvent(event, false); break;
      case "tool_execution_end": this.toolEvent(event, true); break;
      case "extension_error": this.fail("A Pi extension failed. Fix its RPC compatibility before retrying; no fallback was attempted."); break;
      case "extension_ui_request": this.dialog(event); break;
      case "agent_settled": this.settle(); break;
      // agent_end is NOT completion: Pi may retry, compact, or drain extensions.
    }
  }

  private messageDelta(delta: RecordValue) {
    if (typeof delta.delta !== "string") return;
    if (delta.type === "text_delta") {
      this.output += delta.delta;
      if (Buffer.byteLength(this.output) > MAX_OUTPUT) { this.fail("Pi output exceeds the limit"); return; }
      this.emit({ type: "text_delta", text: delta.delta });
    }
    if (delta.type === "thinking_delta") this.emit({ type: "reasoning_delta", text: delta.delta });
  }

  private messageEnd(message: RecordValue) {
    if (message.role !== "assistant") return;
    this.modelError = ["error", "aborted", "length"].includes(String(message.stopReason));
    const usage = record(message.usage);
    const number = (key: string) => typeof usage[key] === "number" && Number.isFinite(usage[key]) && usage[key] >= 0 ? usage[key] as number : 0;
    const previous = this.usage;
    this.usage = {
      inputTokens: (previous?.inputTokens ?? 0) + number("input"), outputTokens: (previous?.outputTokens ?? 0) + number("output"),
      cacheReadInputTokens: (previous?.cacheReadInputTokens ?? 0) + number("cacheRead"), cacheCreationInputTokens: (previous?.cacheCreationInputTokens ?? 0) + number("cacheWrite"),
    };
  }

  private toolEvent(event: RecordValue, completed: boolean) {
    const toolName = typeof event.toolName === "string" ? event.toolName : undefined;
    const toolCallId = event.toolCallId;
    if (toolName && this.isDeclaredBridgeTool(toolName) && !this.tools.isTerminal(toolName)) {
      if (completed) this.nonterminalTools.executionEnd(toolCallId);
      else this.nonterminalTools.executionStart(toolCallId);
    }
    if (!toolName || typeof toolCallId !== "string") return;
    if (completed) this.emit({ type: "tool_completed", toolName, callId: toolCallId, ...(event.isError ? { error: { message: "Pi tool failed" } } : {}) });
    else this.emit({ type: "tool_started", toolName, callId: toolCallId });
  }

  private dialog(event: RecordValue) {
    const blocking = ["confirm", "select", "input", "editor"].includes(String(event.method));
    if (!blocking) return;
    if (event.method !== "confirm" || typeof event.id !== "string" || this.approval || !this.ref.nativeSessionId || this.input.toolPolicy !== "full") {
      this.fail("A Pi extension requires unsupported or startup interaction. Configure it in Pi, then retry in Chrona."); return;
    }
    this.approval = { id: event.id };
    // Pi auto-dismisses timed dialogs; never let a late Chrona click approve a later request.
    if (typeof event.timeout === "number") this.approval.timer = setTimeout(() => this.fail("Pi extension confirmation expired; no approval was sent."), Math.max(0, event.timeout));
    this.ref.status = "waiting_for_approval";
    this.emit({ type: "approval_required", approval: {
      id: event.id, provider: "pi", runId: this.ref.runId, sessionId: this.ref.sessionId,
      kind: "pi_extension_confirm", title: "Pi extension confirmation",
      summary: typeof event.title === "string" ? redactSensitiveText(event.title, 300) : "A Pi extension requests confirmation.",
      description: typeof event.message === "string" ? redactSensitiveText(event.message, 2000) : undefined,
      riskLevel: "unknown", choices: ["approve_once", "deny"], defaultChoice: "deny",
      scopePolicy: { supportsOnce: true, supportsSession: false, supportsAlways: false, supportsResolveAll: false },
    } });
  }

  resolveApproval(input: ResolveProviderApprovalInput): ProviderApprovalResolution {
    const base = { provider: "pi", runId: this.ref.runId, choice: input.choice, resolved: 0 };
    if (this.done) return { ...base, status: "not_active" };
    if (!this.approval || this.approval.id !== input.approvalId) return { ...base, status: "not_pending" };
    if (!["approve_once", "deny"].includes(input.choice) || input.resolveAll) throw new Error("Pi confirmations support only approve-once or deny");
    this.rpc?.send({ type: "extension_ui_response", id: this.approval.id, confirmed: input.choice === "approve_once" });
    if (this.approval.timer) clearTimeout(this.approval.timer);
    this.approval = undefined;
    this.ref.status = "running";
    return { ...base, resolved: 1, status: "resolved" };
  }

  private settle() {
    if (this.approval) { this.fail("Pi settled with an unresolved confirmation"); return; }
    if (this.input.terminalToolName && !this.terminal) { this.fail("Pi stopped without the required terminal tool result"); return; }
    if (this.modelError && !this.terminal) { this.fail("Pi model request failed, was interrupted, or exceeded its output limit"); return; }
    this.ref.status = "completed";
    this.emit({ type: "run_completed", run: { ...this.ref }, outputText: this.output, terminalToolCall: this.terminal, usage: this.usage });
    this.finish();
  }

  fail(message: string) {
    if (this.done) return;
    this.error = message;
    this.ref.status = "failed";
    this.emit({ type: "run_failed", run: { ...this.ref }, error: message });
    this.finish();
  }

  cancel() {
    if (this.done) return;
    this.ref.status = "cancelled";
    this.emit({ type: "run_cancelled", run: { ...this.ref } });
    this.finish();
  }

  private finish() {
    this.done = true;
    clearTimeout(this.timer);
    if (this.approval?.timer) clearTimeout(this.approval.timer);
    this.input.signal?.removeEventListener("abort", this.abortListener);
    this.abort.abort();
    this.cleanup = this.closeResources();
    this.wake?.();
  }

  private async releaseSession() {
    const release = this.release;
    this.release = undefined;
    await release?.();
  }

  private async closeResources() {
    // Cleanup must not withhold a terminal event indefinitely. RPC close has its
    // own kill deadline; an unresponsive MCP close must not retain the session lock.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([this.tools.close(), this.rpc?.close()]),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      await this.releaseSession();
    }
  }

  snapshot(): ProviderRunSnapshot {
    return { provider: "pi", runId: this.ref.runId, sessionId: this.ref.sessionId, nativeSessionId: this.ref.nativeSessionId, providerResumeRef: this.ref.providerResumeRef, status: this.ref.status ?? "running", outputText: this.output, terminalToolCall: this.terminal, usage: this.usage, error: this.error };
  }

  async *events(signal?: AbortSignal): AsyncIterable<ProviderRunEvent> {
    if (this.streaming) throw new Error("Pi permits only one stream consumer per run");
    this.streaming = true;
    const cancel = () => this.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) this.cancel();
      while (!this.done || this.queue.length > 0) {
        const value = this.queue.shift();
        if (value) { this.queueBytes -= Buffer.byteLength(JSON.stringify(value)); yield value; continue; }
        if (this.done) break;
        await new Promise<void>((resolve) => { this.wake = resolve; });
      }
      await this.cleanup;
    } finally { signal?.removeEventListener("abort", cancel); this.cancel(); await this.cleanup; }
  }
}
