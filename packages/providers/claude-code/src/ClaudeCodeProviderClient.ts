/**
 * ClaudeCodeProviderClient — implements `AgentProviderClient` for Claude Code.
 *
 * Owns a `ClaudeCodeRunner` (default: SDK + CLI fallback; replay-mode for
 * CI / unit tests when `CHRONA_CLAUDE_CODE_RECORD_DIR` is unset and the
 * caller explicitly passes `runner` in the options). All protocol/transport
 * knowledge lives in `runner.ts`; this file is pure foundation typing.
 *
 * Spec:  specs/017-provider-claude-code/spec.md §5
 * Plan:   specs/017-provider-claude-code/plan.md §0.1–§0.6
 */

import {
  appendProviderReplayRecord,
  type AgentProviderClient,
  type CancelRunInput,
  type CreateSessionInput,
  type GetRunInput,
  type HealthCheckInput,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderRunEvent,
  type ProviderRunRef,
  type ProviderRunSnapshot,
  type ProviderSessionRef,
  type StartRunInput,
  type StreamRunInput,
} from "@chrona/providers-foundation";
import type { ControlPlaneMode } from "@chrona/contracts";

import {
  createClaudeCodeRunner,
  type ClaudeCodeRunHandle,
  type ClaudeCodeRunner,
  type ClaudeCodeRunnerConfig,
} from "./runner";
import { ClaudeCodeProviderError } from "./types";

export interface ClaudeCodeProviderOptions {
  config: ClaudeCodeProviderConfig;
  /**
   * Optional override; defaults to env `CHRONA_CLAUDE_CODE_RECORD_DIR`.
   * When set to a directory, real-driver runs write a tape; the runner
   * factory passes that dir to the runner.
   */
  recordDir?: string;
  /**
   * Optional override; defaults to env `CHRONA_CLAUDE_CODE_STRICT_UNKNOWN_EVENTS`.
   * Forwarded to the runner / normalizer.
   */
  strictUnknownEvents?: boolean;
  /**
   * Test seam: pass a pre-built runner (e.g. `createReplayRunner(fixtures/)`)
   * to bypass process / SDK spawning entirely. When set, `config` is unused
   * for transport; only its `mcpBaseUrl` (if present) is consulted.
   */
  runner?: ClaudeCodeRunner;
}

interface InternalRun {
  handle: ClaudeCodeRunHandle;
  startedAt: string;
  input: StartRunInput;
}

/** Public constructor-friendly config (subset of contracts config). */
export interface ClaudeCodeProviderConfig {
  binaryPath?: string;
  model?: string;
  timeoutMs?: number;
  mcpBaseUrl?: string;
  /**
   * Static Bearer token for the MCP server at `/api/mcp`. Usually
   * omitted — `CHRONA_API_KEY` / `CHRONA_MCP_BEARER_TOKEN` env vars are
   * the canonical sources. Required only if the operator wants the
   * token baked into the config object instead of the env.
   */
  mcpRunToken?: string;
  apiKey?: string;
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Skill-mode selector (Spec 018). Defaults to "mcp".
   * Mirrors the contracts-level `ClaudeCodeClientConfig.controlPlane`.
   * Hermes is MCP-only and ignores this field.
   */
  controlPlane?: ControlPlaneMode;
  /**
   * Skill directory mounted into the spawned run when
   * `controlPlane === "skill"`. Optional; can be overridden per-run via
   * `StartRunInput.control.skillsDir`.
   */
  skillDir?: string;
}

const DEFAULT_MODEL = "claude-opus-4-8";
const PROVIDER_NAME = "claude_code";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Default MCP base URL when neither `config.mcpBaseUrl` nor
 * `CHRONA_MCP_BASE_URL` is set. The provider runs in-process with the engine
 * and HTTP server, so the server's own `PORT` (default 3101, see
 * apps/server/src/config/env.ts) points at the live `/api/mcp` route. Deriving
 * from `PORT` keeps the two in lockstep instead of hardcoding a port that
 * drifts from the server default.
 */
function defaultMcpBaseUrl(): string {
  const port = readEnv("PORT") ?? "3101";
  return `http://localhost:${port}`;
}

export class ClaudeCodeProviderClient implements AgentProviderClient {
  readonly provider = PROVIDER_NAME;
  private readonly opts: ClaudeCodeProviderOptions;
  private readonly runner: ClaudeCodeRunner;
  private readonly ownsRunner: boolean;
  private readonly runs = new Map<string, InternalRun>();
  private runnerInitPromise: Promise<ClaudeCodeRunner> | null = null;

  constructor(opts: ClaudeCodeProviderOptions) {
    this.opts = opts;
    if (opts.runner) {
      this.runner = opts.runner;
      this.ownsRunner = false;
    } else {
      this.runner = undefined as unknown as ClaudeCodeRunner; // replaced on first use
      this.ownsRunner = true;
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
    };
  }

  async checkHealth(_input: HealthCheckInput = {}): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = Date.now();
    const reason = await this.probe();
    const latencyMs = Date.now() - started;
    return {
      provider: this.provider,
      ok: reason === null,
      checkedAt,
      latencyMs,
      status: reason === null ? "ok" : "unavailable",
      message: reason ?? undefined,
      reason: reason ?? undefined,
    };
  }

  /**
   * Mint a provider session ref. The Claude Code SDK owns session identity:
   * the authoritative `session_id` is captured from the run stream (see
   * `runner.ts` `extractSdkSessionId`) and written back onto the run ref, so
   * the live execute/stream paths pass the engine `sessionId` straight to
   * `startRun` and never route through here. This remains only to satisfy
   * `AgentProviderClient`; it returns a fresh UUID (a shape the SDK accepts)
   * rather than a Chrona-invented `claude-session-*` placeholder.
   */
  async createSession(input: CreateSessionInput = {}): Promise<ProviderSessionRef> {
    const sessionId = crypto.randomUUID();
    return {
      provider: this.provider,
      sessionId,
      nativeSessionId: sessionId,
      providerSessionId: sessionId,
      state: "ready",
      sessionKey: input.sessionKey,
      createdAt: new Date().toISOString(),
    };
  }

  async startRun(input: StartRunInput): Promise<ProviderRunRef> {
    const runner = await this.ensureRunner();
    const startedAt = new Date().toISOString();
    let startResult: { handle: ClaudeCodeRunHandle };
    try {
      startResult = await runner.start(input);
    } catch (err) {
      throw new ClaudeCodeProviderError(
        `ClaudeCode startRun failed: ${errorMessage(err)}`,
        { retryable: false, cause: err },
      );
    }
    const handle = startResult.handle;
    this.runs.set(handle.runId, { handle, startedAt, input });
    return handle.ref;
  }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    const runner = await this.ensureRunner();
    const handle = await this.resolveStreamHandle(runner, input);
    try {
      for await (const event of this.iterateRunEvents(runner, handle)) {
        yield event;
        if (this.isTerminalEvent(event)) {
          await this.recordFinalSnapshot(handle, event);
          return;
        }
      }
      // The runner's iterator ended without a terminal event. If the run
      // was cancelled (SdkRunner sets the internal `cancelRequested` flag
      // and the SDK's `Query.interrupt()` closes the generator without
      // emitting a result message), surface a synthetic `run_cancelled`
      // so callers can rely on a terminal event in the stream.
      const postSnap = await runner.snapshot(handle);
      if (postSnap.status === "cancelled") {
        const cancelledEvent: ProviderRunEvent = {
          type: "run_cancelled",
          run: this.snapshotAsRef(postSnap, handle),
        };
        yield cancelledEvent;
        await this.recordFinalSnapshot(handle, cancelledEvent);
        return;
      }
      if (postSnap.status === "failed") {
        const failedEvent: ProviderRunEvent = {
          type: "run_failed",
          run: this.snapshotAsRef(postSnap, handle),
          error: postSnap.error ?? "run ended without a terminal event",
        };
        yield failedEvent;
        await this.recordFinalSnapshot(handle, failedEvent);
        return;
      }
    } catch (err) {
      // The SDK runner surfaces LLM errors (4xx, network, JSON parse) as
      // thrown exceptions rather than `result` messages. Map them to a
      // `run_failed` event so callers always see a terminal — matches the
      // spec 017 §5 contract ("Map terminal events to run_completed /
      // run_failed / run_cancelled") and lets the engine show the error
      // in the Inbox without a separate `getRun` poll.
      const message = errorMessage(err);
      const snap = await runner.snapshot(handle).catch(() => null);
      const failedEvent: ProviderRunEvent = {
        type: "run_failed",
        run: snap ? this.snapshotAsRef(snap, handle) : handle.ref,
        error: message,
      };
      yield failedEvent;
      await this.recordFinalSnapshot(handle, failedEvent);
      return;
    }
  }

  /**
   * Narrow a `ProviderRunSnapshot` (the full post-run state) down to the
   * `ProviderRunRef` shape expected by terminal event schemas (`run_cancelled`,
   * `run_failed`). Both shapes share the same identifier fields, so this is
   * a structural cast that throws away `outputText` / `usage` etc.
   */
  private snapshotAsRef(
    snap: ProviderRunSnapshot,
    handle: ClaudeCodeRunHandle,
  ): ProviderRunRef {
    return {
      ...handle.ref,
      status: snap.status === "running" ? "running" : snap.status,
    };
  }

  private async resolveStreamHandle(
    runner: ClaudeCodeRunner,
    input: StreamRunInput,
  ): Promise<ClaudeCodeRunHandle> {
    const hasExistingRunId =
      "runId" in input && (input as { runId?: string }).runId != null;
    if (hasExistingRunId) {
      const runId = (input as { runId: string }).runId;
      const existing = this.runs.get(runId);
      if (!existing) {
        throw new ClaudeCodeProviderError(
          `streamRun: unknown runId "${runId}"`,
          { retryable: false },
        );
      }
      return existing.handle;
    }
    // Start branch: build a new handle and remember it so getRun/cancelRun
    // can find it later by `ref.runId`.
    const started = await runner.start(input as unknown as StartRunInput);
    const handle = started.handle;
    this.runs.set(handle.runId, {
      handle,
      startedAt: handle.ref.startedAt ?? new Date().toISOString(),
      input: input as unknown as StartRunInput,
    });
    return handle;
  }

  private async *iterateRunEvents(
    runner: ClaudeCodeRunner,
    handle: ClaudeCodeRunHandle,
  ): AsyncIterable<ProviderRunEvent> {
    let event: ProviderRunEvent | null;
    do {
      event = await runner.next(handle);
      if (event !== null) yield event;
    } while (event !== null);
  }

  private isTerminalEvent(
    event: ProviderRunEvent,
  ): event is Extract<
    ProviderRunEvent,
    { type: "run_completed" | "run_failed" | "run_cancelled" }
  > {
    return (
      event.type === "run_completed" ||
      event.type === "run_failed" ||
      event.type === "run_cancelled"
    );
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    const runner = await this.ensureRunner();
    const internal = this.runs.get(input.runId);
    if (!internal) {
      throw new ClaudeCodeProviderError(
        `getRun: unknown runId "${input.runId}"`,
        { retryable: false },
      );
    }
    return runner.snapshot(internal.handle);
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    const runner = await this.ensureRunner();
    const internal = this.runs.get(input.runId);
    if (!internal) {
      throw new ClaudeCodeProviderError(
        `cancelRun: unknown runId "${input.runId}"`,
        { retryable: false },
      );
    }
    await runner.cancel(internal.handle);
    const snap = await runner.snapshot(internal.handle);
    return snap;
  }

  // ------------------------------------------------------------------ internals

  private async ensureRunner(): Promise<ClaudeCodeRunner> {
    if (!this.ownsRunner) return this.runner;
    if (this.runnerInitPromise) return this.runnerInitPromise;
    this.runnerInitPromise = this.buildRunner();
    return this.runnerInitPromise;
  }

  private async buildRunner(): Promise<ClaudeCodeRunner> {
    const recordDir =
      this.opts.recordDir ?? readEnv("CHRONA_CLAUDE_CODE_RECORD_DIR");
    const strict =
      this.opts.strictUnknownEvents ??
      readEnv("CHRONA_CLAUDE_CODE_STRICT_UNKNOWN_EVENTS") === "1";
    const mcpBaseUrl =
      this.opts.config.mcpBaseUrl ??
      readEnv("CHRONA_MCP_BASE_URL") ??
      defaultMcpBaseUrl();
    const controlBaseUrl = readEnv("CHRONA_BASE_URL") ?? mcpBaseUrl;
    // The MCP server at /api/mcp sits behind the same `apiKeyAuth()`
    // middleware as every other /api/* route (apps/server/src/middleware/
    // auth.ts), so the Bearer token we hand the SDK here MUST be the
    // server's static `API_KEY` (the same one operators set in
    // apps/server/.env). Skill mode overrides this via `input.control.
    // runToken` (see runner start()), but the per-run token is a separate
    // scope (per node attempt), not the MCP transport credential.
    const mcpRunToken =
      this.opts.config.mcpRunToken ??
      readEnv("CHRONA_API_KEY") ??
      readEnv("CHRONA_MCP_BEARER_TOKEN") ??
      "";
    const env: Record<string, string> = {
      ...(this.opts.config.env ?? {}),
      ...(this.opts.config.apiKey ? { ANTHROPIC_API_KEY: this.opts.config.apiKey } : {}),
    };
    const cfg: ClaudeCodeRunnerConfig = {
      model: this.opts.config.model ?? DEFAULT_MODEL,
      timeoutMs: this.opts.config.timeoutMs,
      mcpBaseUrl,
      mcpRunToken,
      env: Object.keys(env).length > 0 ? env : undefined,
      binaryPath: this.opts.config.binaryPath,
      cwd: this.opts.config.cwd,
      recordDir,
      strictUnknownEvents: strict,
      controlPlane: this.opts.config.controlPlane,
      controlBaseUrl,
      skillDir: this.opts.config.skillDir,
    };
    return createClaudeCodeRunner(cfg);
  }

  /**
   * Cheap probe: if we own a runner, just construct it (which will fail if
   * the SDK can't be loaded and the `claude` binary is missing for the CLI
   * path; but `createClaudeCodeRunner` never throws on construction — only
   * on first `start`). We additionally run a `version --help` probe via
   * `claude --version` for CLI availability.
   *
   * Reason strings are actionable per the spec.
   */
  private async probe(): Promise<string | null> {
    if (this.opts.runner) return null; // user provided runner → trust it
    if (readEnv("CHRONA_CLAUDE_CODE_RECORD_DIR")) return null; // record-only
    const binary = this.opts.config.binaryPath ?? "claude";
    try {
      const proc = Bun.spawn([binary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exit = await proc.exited;
      if (exit !== 0) {
        return `Claude Code CLI exited with code ${exit}; ensure '${binary}' is installed and on PATH (https://docs.claude.com/en/docs/claude-code/setup).`;
      }
      return null;
    } catch (err) {
      return `Claude Code CLI not found on PATH (binary='${binary}'): ${errorMessage(err)}. Install Claude Code or set config.binaryPath.`;
    }
  }

  private async recordFinalSnapshot(
    handle: ClaudeCodeRunHandle,
    terminal: ProviderRunEvent,
  ): Promise<void> {
    if (!handle.recordPath) return;
    const status =
      terminal.type === "run_completed"
        ? "completed"
        : terminal.type === "run_failed"
          ? "failed"
          : "cancelled";
    const snapshot: ProviderRunSnapshot = {
      provider: this.provider,
      runId: handle.runId,
      nativeRunId: handle.ref.nativeRunId,
      providerRunId: handle.ref.providerRunId,
      sessionId: handle.ref.sessionId,
      status,
      outputText: terminal.type === "run_completed" ? terminal.outputText : undefined,
      output: terminal.type === "run_completed" ? terminal.output : undefined,
      error: terminal.type === "run_failed" ? terminal.error : undefined,
    };
    await appendProviderReplayRecord(handle.recordPath, {
      kind: "snapshot",
      provider: this.provider,
      recordedAt: new Date().toISOString(),
      snapshot,
    });
  }

  /** Convenience for tests: list known runIds. */
  knownRunIds(): string[] {
    return Array.from(this.runs.keys());
  }

  /** Test seam: expose the runner so unit tests can assert on handle state. */
  getRunnerForTests(): ClaudeCodeRunner {
    return this.runner;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
