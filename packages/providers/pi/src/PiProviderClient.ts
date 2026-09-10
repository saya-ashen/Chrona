import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { PiClientConfig } from "@chrona/contracts";
import {
  assertProviderStartSupported, BoundedTerminalRunSnapshots, ProviderOperationError,
  type AgentProviderClient, type CancelRunInput, type CreateSessionInput, type GetRunInput,
  type HealthCheckInput, type ProviderCapabilities, type ProviderConversationTurnInput,
  type ProviderConversationHandoffInput, type ProviderConfigurationCapabilities,
  type ProviderRunEvent, type ProviderRunRef, type ProviderRunSnapshot,
  type ResolveProviderApprovalInput, type StartRunInput, type StreamRunInput,
} from "@chrona/providers-foundation";
import { PiRun } from "./run";
import { PiState } from "./state";

const execFileAsync = promisify(execFile);
const capabilities: ProviderCapabilities = {
  supportsSessions: true, supportsStreaming: true, supportsRunLookup: false,
  supportsCancellation: true, supportsToolCalls: true, supportsPreviousResponse: false,
  actionInvocation: "external_control_plane", startIdempotency: "unsupported",
  readOnlySingleAttempt: true, lookupByClientOperationId: false,
  approval: { supported: true, choices: ["approve_once", "deny"], scopes: ["once"], resolveAll: false },
  recovery: {
    sessionResume: true, historyReplay: false, activeRunLookup: false, streamReconnect: false,
    crossProcessDurable: false, providerResumeRef: true, runEventReplay: false, mode: "session_history",
  },
};

export class PiProviderClient implements AgentProviderClient {
  readonly provider = "pi";
  private readonly state: PiState;
  private readonly runs = new Map<string, PiRun>();
  private readonly terminals = new BoundedTerminalRunSnapshots();
  private readonly starts = new Map<string, { fingerprint: string; promise: Promise<ProviderRunRef> }>();
  private readonly streaming = new Set<string>();

  constructor(options: { config?: PiClientConfig; stateDirectory?: string } = {}) {
    this.state = new PiState(options.config ?? {}, options.stateDirectory);
  }

  getCapabilities() { return structuredClone(capabilities); }

  getConfigurationCapabilities(): ProviderConfigurationCapabilities {
    return {
      model: { supported: true, taskOverride: true },
      context: { supported: true, taskOverride: false, strategies: ["provider_default"] },
      tooling: {
        mcp: { supported: true, enabled: true }, lsp: { supported: false, enabled: false },
        subagents: { supported: false, enabled: false }, enabledTools: [],
      },
    };
  }

  async getRuntimeDiagnostics() {
    const model = this.model() ?? await this.inspectDefaultModel();
    return {
      provider: this.provider, model, contextWindow: null,
      contextStrategy: "provider_default", workingDirectory: this.state.cwd,
      configDirectory: this.state.agentDir, agentDirectory: this.state.agentDir,
      configurationCapabilities: this.getConfigurationCapabilities(),
      sources: { model: this.model() ? "provider_override" as const : "provider_default" as const, context: "provider_default" as const, configDirectory: "provider_default" as const, agentDirectory: "provider_default" as const, tools: "runtime" as const },
    };
  }

  private async inspectDefaultModel(): Promise<string> {
    const bridge = await this.state.initialize();
    await this.checkVersion();
    // Resolve Pi's own model selection without a model request or user extensions.
    // Chrona needs this concrete identifier before pinning a Task's model.
    const run = new PiRun({ clientOperationId: randomUUID(), sessionId: randomUUID(),
      instructions: "Inspect model selection only.", input: "", toolPolicy: "read_only",
    }, `pi-inspect-${randomUUID()}`, this.state, 30_000);
    try {
      await run.start(bridge, this.state.newSessionPath(), undefined, false);
      if (!run.effectiveModel) throw new Error("Pi did not resolve a default model");
      return run.effectiveModel;
    } finally {
      run.cancel();
      for await (const _event of run.events()) { /* await subprocess cleanup */ }
    }
  }

  private model(override?: string) {
    if (override?.trim()) return override.trim();
    const config = this.state.config;
    if (!config.model?.trim()) return undefined;
    return config.provider?.trim() ? `${config.provider.trim()}/${config.model.trim()}` : config.model.trim();
  }

  private async checkVersion(signal?: AbortSignal) {
    try {
      const result = await execFileAsync(this.state.binaryPath, ["--version"], {
        env: { ...process.env, PI_CODING_AGENT_DIR: this.state.agentDir, PI_OFFLINE: "1" },
        cwd: this.state.cwd, timeout: 15_000, maxBuffer: 4096, signal, windowsHide: true,
      });
      const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(result.stdout.trim());
      if (!match || (Number(match[1]) === 0 && Number(match[2]) < 85)) throw new Error("version");
    } catch {
      throw new Error("Pi >= 0.85.0 is required. Install/update the official Pi CLI and ensure it is on Chrona's PATH.");
    }
  }

  async checkHealth(input: HealthCheckInput = {}) {
    const start = Date.now();
    try {
      const marker = "CHRONA_PI_READY";
      const ref = await this.startRun({
        clientOperationId: randomUUID(), sessionId: randomUUID(), instructions: `Return exactly ${marker}.`,
        input: "Check model connectivity.", toolPolicy: "read_only", timeoutMs: input.timeoutMs ?? 60_000, signal: input.signal,
      });
      for await (const _event of this.streamRun({ runId: ref.runId, signal: input.signal })) { /* drain */ }
      const result = await this.getRun({ runId: ref.runId });
      if (result.status !== "completed" || !result.outputText?.includes(marker)) throw new Error("Pi did not complete the isolated connectivity request");
      return { provider: "pi", ok: true, checkedAt: new Date().toISOString(), latencyMs: Date.now() - start, message: "Pi completed an isolated model request. Execution loads local extensions; extension compatibility is checked at execution startup." };
    } catch (error) {
      return { provider: "pi", ok: false, checkedAt: new Date().toISOString(), latencyMs: Date.now() - start, reason: error instanceof Error ? error.message : "Pi health check failed" };
    }
  }

  async createSession(input: CreateSessionInput = {}) {
    return { provider: "pi", sessionId: input.sessionKey || randomUUID(), sessionKey: input.sessionKey, createdAt: new Date().toISOString() };
  }

  startRun(input: StartRunInput): Promise<ProviderRunRef> {
    const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, signal: undefined })).digest("hex");
    const existing = this.starts.get(input.clientOperationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.reject(new Error("Pi operation identity cannot be reused with different input"));
      return existing.promise;
    }
    const started = this.start(input);
    this.starts.set(input.clientOperationId, { fingerprint, promise: started });
    // Durable operation claims still prevent replay after in-memory eviction.
    if (this.starts.size > 128) this.starts.delete(this.starts.keys().next().value!);
    return started;
  }

  private validateStart(input: StartRunInput) {
    assertProviderStartSupported(capabilities, input, "pi");
    input.signal?.throwIfAborted();
    if (input.previousResponseId) throw new Error("Pi does not support previous response identifiers");
    if (input.maxOutputTokens) throw new Error("Pi RPC does not support a per-request output-token limit");
    const context = input.runtimeConfiguration?.contextStrategy;
    if (context && context !== "provider_default") throw new Error("Pi context settings are owned by the local Pi configuration");
  }

  private async start(input: StartRunInput): Promise<ProviderRunRef> {
    this.validateStart(input);
    const bridge = await this.state.initialize();
    await this.checkVersion(input.signal);
    const saved = input.resumeSessionRef ? await this.state.loadSession(input.resumeSessionRef) : undefined;
    const requested = this.model(input.runtimeConfiguration?.model);
    if (saved && requested && requested !== saved.model) throw new Error("Pi resume model differs from the captured session model");
    await this.state.claimOperation(input.clientOperationId);
    const run = new PiRun(input, `pi-rpc-${randomUUID()}`, this.state, this.timeout(input));
    this.runs.set(run.ref.runId, run);
    try {
      await run.start(bridge, saved ? saved.file : this.state.newSessionPath(), requested ?? saved?.model);
      return { ...run.ref };
    } catch (error) {
      run.fail(error instanceof Error ? error.message : "Pi startup failed");
      // Drain cleanup even when the caller never receives a stream identity.
      for await (const _event of run.events()) { /* drain */ }
      this.terminals.set(run.snapshot());
      this.runs.delete(run.ref.runId);
      throw error;
    }
  }

  private timeout(input: StartRunInput) { return input.timeoutMs ?? this.state.config.timeoutMs ?? 3_600_000; }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    const ref = "instructions" in input ? await this.startRun(input) : { runId: input.runId };
    const run = this.runs.get(ref.runId!);
    if (!run) throw new ProviderOperationError({ provider: "pi", code: "provider_run_unrecoverable", message: "Pi has no live stream for this run; automatic reattachment/replay is unsupported." });
    if (this.streaming.has(run.ref.runId)) throw new Error("Pi permits only one stream consumer per run");
    this.streaming.add(run.ref.runId);
    try { yield* run.events(input.signal); }
    finally { this.streaming.delete(run.ref.runId); this.terminals.set(run.snapshot()); this.runs.delete(run.ref.runId); }
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    const snapshot = this.runs.get(input.runId)?.snapshot() ?? this.terminals.get(input.runId);
    if (snapshot) return snapshot;
    throw new ProviderOperationError({ provider: "pi", code: "provider_run_unrecoverable", message: "Pi run snapshot is unavailable; a stored session is not proof of an active run." });
  }

  async cancelRun(input: CancelRunInput) {
    this.runs.get(input.runId)?.cancel();
    return this.getRun(input);
  }

  async resolveApproval(input: ResolveProviderApprovalInput) {
    const run = this.runs.get(input.runId);
    if (!run) return { provider: "pi", runId: input.runId, choice: input.choice, resolved: 0, status: "not_active" as const };
    return run.resolveApproval(input);
  }

  getConversationCapabilities() {
    return { resume: true, fork: false, compact: false, handoff: "application" as const, contextUsage: "aggregate" as const };
  }

  async inspectConversation(sessionRef: string) {
    try { await this.state.loadSession(sessionRef); return { available: true, sessionRef, compacted: false }; }
    catch { return { available: false, sessionRef, compacted: false }; }
  }

  async runConversationTurn(input: ProviderConversationTurnInput) {
    if (input.mode === "fork") throw new Error("Pi conversation forking is not supported by this adapter");
    const ref = await this.startRun({ clientOperationId: randomUUID(), sessionId: randomUUID(), resumeSessionRef: input.sessionRef, instructions: "Answer the user's question using the saved conversation. Do not change task state.", input: input.prompt, toolPolicy: input.toolPolicy === "full" ? "full" : "read_only", signal: input.signal });
    for await (const _event of this.streamRun({ runId: ref.runId, signal: input.signal })) { /* drain */ }
    const result = await this.getRun({ runId: ref.runId });
    if (result.status !== "completed") throw new Error(result.error || "Pi conversation did not complete");
    return { sessionRef: ref.nativeSessionId!, outputText: result.outputText ?? "", usage: result.usage };
  }

  async handoffConversation(input: ProviderConversationHandoffInput) {
    const result = await this.runConversationTurn({ sessionRef: input.sessionRef, prompt: input.instructions, toolPolicy: "result_follow_up", signal: input.signal });
    return { sessionRef: result.sessionRef, handoffText: result.outputText };
  }
}
