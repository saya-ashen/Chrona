/* eslint-disable complexity, max-lines -- Claude protocol adaptation explicitly handles every SDK event variant. */
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
	assertProviderStartSupported,
	BoundedTerminalRunSnapshots,
	type AgentProviderClient,
	ProviderOperationError,
	type CancelRunInput,
	type CreateSessionInput,
	type GetRunInput,
	type HealthCheckInput,
	type ProviderCapabilities,
	type ProviderConversationCapabilities,
	type ProviderConversationState,
	type ProviderConversationHandoffInput,
	type ProviderConversationHandoffResult,
	type ProviderConversationTurnInput,
	type ProviderConversationTurnResult,
	type ProviderHealth,
	type ProviderRunEvent,
	type ProviderRunRef,
	type ProviderRunSnapshot,
	type ProviderSessionRef,
	type StartRunInput,
	type StreamRunInput,
} from "@chrona/providers-foundation";

import {
	createClaudeCodeRunner,
	probeClaudeCodeSdk,
	runClaudeConversationTurn,
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
	model?: string;
	timeoutMs?: number;
	mcpBaseUrl?: string;
	/** Optional endpoint credential retained for backward-compatible construction. */
	mcpRunToken?: string;
	apiKey?: string;
	cwd?: string;
	/** Optional Claude binary override. Hidden from normal UI. */
	binaryPath?: string;
	env?: Record<string, string>;
	/** Optional config/state directory. Omitted means Claude Code default user-level config. */
	configDirectory?: string;
	/** Reserved named profile selector. */
	profileName?: string;

	/** Advanced SDK option overrides for isolated tests / embedders. Core transport options still win. */
	sdkOptions?: ClaudeCodeRunnerConfig["sdkOptions"];
}

const DEFAULT_MODEL = "claude-opus-4-8";
const PROVIDER_NAME = "claude_code";

function readEnv(name: string): string | undefined {
	const v = process.env[name];
	return v && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Default endpoint URL retained for backward-compatible configuration.
 * Declared run tools are registered through the SDK-local MCP transport.
 */
function defaultMcpBaseUrl(): string {
	const port = readEnv("PORT") ?? "3101";
	return `http://localhost:${port}`;
}

const SDK_ABORTED_BY_USER_MESSAGE = "Claude Code process aborted by user";

interface ProviderFailureContext {
	terminalToolName?: string;
	sawTerminalToolCall: boolean;
	sawTerminalToolResult: boolean;
	lastEventType?: ProviderRunEvent["type"];
	lastTool?: string;
	lastText?: string;
}

function isTerminalTool(
	tool: string | undefined,
	terminalToolName: string | undefined,
): boolean {
	if (!tool || !terminalToolName) return false;
	return tool === terminalToolName || tool.endsWith(`__${terminalToolName}`);
}

function noteProviderEvent(
	ctx: ProviderFailureContext,
	event: ProviderRunEvent,
): void {
	ctx.lastEventType = event.type;
	if (event.type === "text_delta") ctx.lastText = event.text;
	if (event.type === "tool_call" || event.type === "tool_result") {
		ctx.lastTool = event.tool;
		if (isTerminalTool(event.tool, ctx.terminalToolName)) {
			if (event.type === "tool_call") ctx.sawTerminalToolCall = true;
			else ctx.sawTerminalToolResult = true;
		}
	}
}

function newProviderFailureContext(
	terminalToolName?: string,
): ProviderFailureContext {
	return {
		terminalToolName,
		sawTerminalToolCall: false,
		sawTerminalToolResult: false,
	};
}

function providerFailureDiagnostic(ctx: ProviderFailureContext) {
	return {
		stage: ctx.sawTerminalToolResult
			? "after_terminal_tool_result"
			: ctx.sawTerminalToolCall
				? "during_terminal_tool_call"
				: "before_terminal_tool_call",
		terminalToolName: ctx.terminalToolName,
		lastEventType: ctx.lastEventType,
		lastTool: ctx.lastTool,
		lastText: ctx.lastText,
	};
}

function formatTimeout(timeoutMs?: number): string {
	if (timeoutMs === undefined) return "configured idle timeout";
	return `${Math.round(timeoutMs / 1000)}s idle timeout`;
}

function providerAbortMessage(ctx: ProviderFailureContext): string {
	if (ctx.sawTerminalToolResult)
		return "Claude Code process aborted after the terminal tool result";
	if (ctx.sawTerminalToolCall)
		return "Claude Code process aborted while calling the terminal tool";
	return "Claude Code process aborted before the terminal tool completed";
}

function providerFailureMessage(
	err: unknown,
	ctx?: ProviderFailureContext,
	handle?: ClaudeCodeRunHandle,
): string {
	const message = errorMessage(err);
	if (message !== SDK_ABORTED_BY_USER_MESSAGE) return message;
	if (handle?.diagnostics?.timeoutTriggered) {
		return `Claude Code run timed out after ${formatTimeout(handle.diagnostics.timeoutMs)}: ${providerAbortMessage(ctx ?? newProviderFailureContext())}`;
	}
	return providerAbortMessage(ctx ?? newProviderFailureContext());
}

function providerFailureRaw(
	err: unknown,
	ctx: ProviderFailureContext,
	handle?: ClaudeCodeRunHandle,
) {
	return {
		provider: "claude_code",
		errorName: err instanceof Error ? err.name : undefined,
		errorMessage: errorMessage(err),
		...providerFailureDiagnostic(ctx),
		runner: handle?.diagnostics,
	};
}

export class ClaudeCodeProviderClient implements AgentProviderClient {
	readonly provider = PROVIDER_NAME;
	private readonly opts: ClaudeCodeProviderOptions;
	private readonly runner: ClaudeCodeRunner;
	private readonly ownsRunner: boolean;
	private readonly runs = new Map<string, InternalRun>();
	private readonly terminalSnapshots = new BoundedTerminalRunSnapshots();
	private readonly startedClientOperations = new Set<string>();
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
			actionInvocation: "external_control_plane",
			startIdempotency: "unsupported",
			lookupByClientOperationId: false,
			approval: {
				supported: false,
				choices: [],
				scopes: [],
				resolveAll: false,
			},
			recovery: {
				sessionResume: true,
				historyReplay: true,
				activeRunLookup: true,
				streamReconnect: false,
				crossProcessDurable: false,
				mode: "local_stream_only",
				providerResumeRef: true,
				runEventReplay: true,
			},
		};
	}

	getConversationCapabilities(): ProviderConversationCapabilities {
		return {
			resume: true,
			fork: true,
			compact: true,
			handoff: "application",
			contextUsage: "aggregate",
		};
	}

	async inspectConversation(
		sessionRef: string,
	): Promise<ProviderConversationState> {
		return {
			available: Boolean(sessionRef.trim()),
			sessionRef,
			compacted: false,
		};
	}

	async handoffConversation(
		input: ProviderConversationHandoffInput,
	): Promise<ProviderConversationHandoffResult> {
		if (!this.ownsRunner) {
			throw new ClaudeCodeProviderError(
				"Conversation handoff is unavailable for replay runners",
			);
		}
		const config = await this.buildRunnerConfig();
		const summaryTurn = await runClaudeConversationTurn({
			sessionRef: input.sessionRef,
			prompt: [
				"Create a compact handoff for a new independent coding-agent session.",
				"Preserve decisions, constraints, relevant implementation context, and unfinished work.",
				"Do not execute the next task. Return only the handoff context for the new session.",
				"",
				input.instructions,
			].join("\n"),
			fork: true,
			config,
			signal: input.signal,
		});
		const newSession = await runClaudeConversationTurn({
			prompt: [
				"The following is a handoff from a completed session.",
				"Keep it as context for the next session. Do not execute work yet; wait for the next prompt.",
				"",
				summaryTurn.outputText,
			].join("\n"),
			fork: false,
			config,
			signal: input.signal,
		});
		if (!newSession.sessionRef) {
			throw new ClaudeCodeProviderError(
				"Conversation handoff did not create a new session",
			);
		}
		return {
			sessionRef: newSession.sessionRef,
			handoffText: summaryTurn.outputText,
		};
	}

	async runConversationTurn(
		input: ProviderConversationTurnInput,
	): Promise<ProviderConversationTurnResult> {
		if (!this.ownsRunner) {
			throw new ClaudeCodeProviderError(
				"Conversation continuation is unavailable for replay runners",
			);
		}
		return runClaudeConversationTurn({
			sessionRef: input.sessionRef,
			prompt: input.prompt,
			fork: input.mode === "fork",
			config: await this.buildRunnerConfig(),
			signal: input.signal,
		});
	}

	async checkHealth(input: HealthCheckInput = {}): Promise<ProviderHealth> {
		const checkedAt = new Date().toISOString();
		const started = Date.now();
		const reason = await this.probe(input.timeoutMs);
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
	async createSession(
		input: CreateSessionInput = {},
	): Promise<ProviderSessionRef> {
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
		assertProviderStartSupported(this.getCapabilities(), input, this.provider);
		if (this.startedClientOperations.has(input.clientOperationId)) {
			throw new ProviderOperationError({
				code: "provider_start_outcome_unknown",
				provider: this.provider,
				message: `Claude Code cannot safely attach client operation ${input.clientOperationId}`,
			});
		}
		const runner = await this.ensureRunner();
		const startedAt = new Date().toISOString();
		let startResult: { handle: ClaudeCodeRunHandle };
		try {
			startResult = await runner.start(input);
		} catch (err) {
			this.startedClientOperations.add(input.clientOperationId);
			throw new ProviderOperationError({
				code: "provider_start_outcome_unknown",
				provider: this.provider,
				message: `Claude Code start outcome is unknown for client operation ${input.clientOperationId}`,
				cause: err,
			});
		}
		this.startedClientOperations.add(input.clientOperationId);
		const handle = startResult.handle;
		handle.ref.providerResumeRef ??=
			input.resumeSessionRef ??
			handle.ref.nativeSessionId ??
			handle.ref.nativeRunId ??
			handle.ref.runId;
		this.runs.set(handle.runId, { handle, startedAt, input });
		return handle.ref;
	}

	async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
		const runner = await this.ensureRunner();
		const handle = await this.resolveStreamHandle(runner, input);
		const terminalToolName = this.runs.get(handle.runId)?.input
			.terminalToolName;
		let terminalToolCall:
			| { name: string; callId: string; input: Record<string, unknown> }
			| undefined;
		const failureContext = newProviderFailureContext(terminalToolName);
		try {
			for await (const event of this.iterateRunEvents(runner, handle)) {
				if (event.type === "tool_call" && event.tool === terminalToolName) {
					terminalToolCall = {
						name: event.tool,
						callId: event.callId,
						input: event.input,
					};
				}
				noteProviderEvent(failureContext, event);
				if (this.isTerminalEvent(event)) {
					const terminalEvent =
						event.type === "run_completed" && terminalToolCall
							? { ...event, terminalToolCall }
							: event;
					await this.recordFinalSnapshot(handle, terminalEvent);
					yield terminalEvent;
					return;
				}
				yield event;
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
				await this.recordFinalSnapshot(handle, cancelledEvent);
				yield cancelledEvent;
				return;
			}
			if (postSnap.status === "completed") {
				const completedEvent: ProviderRunEvent = {
					type: "run_completed",
					run: this.snapshotAsRef(postSnap, handle),
					terminalToolCall,
				};
				await this.recordFinalSnapshot(handle, completedEvent);
				yield completedEvent;
				return;
			}
			if (postSnap.status === "failed") {
				const failedEvent: ProviderRunEvent = {
					type: "run_failed",
					run: this.snapshotAsRef(postSnap, handle),
					error: postSnap.error ?? "run ended without a terminal event",
				};
				await this.recordFinalSnapshot(handle, failedEvent);
				yield failedEvent;
				return;
			}
		} catch (err) {
			// The SDK runner surfaces errors as thrown exceptions rather than
			// `result` messages. `Query.interrupt()` (our cancel path) typically
			// makes the generator throw an abort error — so a thrown exception
			// after a cancel is a cancellation, not a failure. Check the snapshot
			// before classifying the error.
			const postSnap = await runner.snapshot(handle).catch(() => null);
			if (postSnap?.status === "cancelled") {
				const cancelledEvent: ProviderRunEvent = {
					type: "run_cancelled",
					run: this.snapshotAsRef(postSnap, handle),
				};
				await this.recordFinalSnapshot(handle, cancelledEvent);
				yield cancelledEvent;
				return;
			}
			if (postSnap?.status === "completed") {
				const completedEvent: ProviderRunEvent = {
					type: "run_completed",
					run: this.snapshotAsRef(postSnap, handle),
					terminalToolCall,
				};
				await this.recordFinalSnapshot(handle, completedEvent);
				yield completedEvent;
				return;
			}
			// Otherwise it is a genuine LLM/runtime error (4xx, network, JSON
			// parse). Map it to `run_failed` so callers always see a terminal.
			const message = providerFailureMessage(err, failureContext, handle);
			const failedEvent: ProviderRunEvent = {
				type: "run_failed",
				run: { ...handle.ref, status: "failed" },
				error: message,
				raw: providerFailureRaw(err, failureContext, handle),
			};
			await this.recordFinalSnapshot(handle, failedEvent);
			yield failedEvent;
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
		if ("runId" in input && input.runId) {
			const existing = this.runs.get(input.runId);
			if (!existing) {
				throw new ClaudeCodeProviderError(
					`streamRun: unknown runId "${input.runId}"`,
					{ retryable: false },
				);
			}
			return existing.handle;
		}
		// Start branch: build a new handle and remember it so getRun/cancelRun
		// can find it later by `ref.runId`.
		const startInput = input as Exclude<StreamRunInput, { runId: string }>;
		const started = await runner.start(startInput);
		const handle = started.handle;
		this.runs.set(handle.runId, {
			handle,
			startedAt: handle.ref.startedAt ?? new Date().toISOString(),
			input: startInput,
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
		if (internal) return runner.snapshot(internal.handle);
		const snapshot = this.terminalSnapshots.get(input.runId);
		if (snapshot) return snapshot;
		throw new ClaudeCodeProviderError(
			`getRun: unknown runId "${input.runId}"`,
			{ retryable: false },
		);
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
		// The MCP server at /api/mcp sits behind the same `apiKeyAuth()`
		// middleware as every other /api/* route (apps/server/src/middleware/
		// auth.ts), so the Bearer token we hand the SDK here MUST be the
		// server's static `API_KEY` (the same one operators set in
		// apps/server/.env).

		const mcpRunToken =
			this.opts.config.mcpRunToken ??
			readEnv("CHRONA_API_KEY") ??
			readEnv("CHRONA_MCP_BEARER_TOKEN") ??
			"";
		const env: Record<string, string> = {
			...(this.opts.config.env ?? {}),
			...(this.opts.config.apiKey
				? { ANTHROPIC_API_KEY: this.opts.config.apiKey }
				: {}),
			...(this.opts.config.configDirectory
				? { CLAUDE_CONFIG_DIR: this.opts.config.configDirectory }
				: {}),
		};
		const cfg: ClaudeCodeRunnerConfig = {
			model: this.opts.config.model ?? DEFAULT_MODEL,
			timeoutMs: this.opts.config.timeoutMs,
			mcpBaseUrl,
			mcpRunToken,
			env: Object.keys(env).length > 0 ? env : undefined,
			cwd: this.opts.config.cwd,
			recordDir,
			strictUnknownEvents: strict,

			sdkOptions: this.opts.config.sdkOptions,
		};
		return createClaudeCodeRunner(cfg);
	}

	/**
	 * Health sends a one-turn SDK query, not `claude --version` or SDK startup.
	 * That verifies the same model/auth/process path real runs need.
	 */
	private async probe(timeoutMs?: number): Promise<string | null> {
		if (this.opts.runner) return null; // user provided runner → trust it
		if (readEnv("CHRONA_CLAUDE_CODE_RECORD_DIR")) return null; // record-only
		return probeClaudeCodeSdk({
			config: await this.buildRunnerConfig(),
			timeoutMs,
		});
	}

	private async buildRunnerConfig(): Promise<ClaudeCodeRunnerConfig> {
		const recordDir =
			this.opts.recordDir ?? readEnv("CHRONA_CLAUDE_CODE_RECORD_DIR");
		const strict =
			this.opts.strictUnknownEvents ??
			readEnv("CHRONA_CLAUDE_CODE_STRICT_UNKNOWN_EVENTS") === "1";
		const mcpBaseUrl =
			this.opts.config.mcpBaseUrl ??
			readEnv("CHRONA_MCP_BASE_URL") ??
			defaultMcpBaseUrl();
		const mcpRunToken =
			this.opts.config.mcpRunToken ??
			readEnv("CHRONA_API_KEY") ??
			readEnv("CHRONA_MCP_BEARER_TOKEN") ??
			"";
		const env: Record<string, string> = {
			...(this.opts.config.env ?? {}),
			...(this.opts.config.apiKey
				? { ANTHROPIC_API_KEY: this.opts.config.apiKey }
				: {}),
		};
		return {
			model: this.opts.config.model ?? DEFAULT_MODEL,
			timeoutMs: this.opts.config.timeoutMs,
			mcpBaseUrl,
			mcpRunToken,
			env: Object.keys(env).length > 0 ? env : undefined,
			binaryPath: this.opts.config.binaryPath,
			cwd: this.opts.config.cwd,
			recordDir,
			strictUnknownEvents: strict,
			sdkOptions: this.opts.config.sdkOptions,
		};
	}

	private async recordFinalSnapshot(
		handle: ClaudeCodeRunHandle,
		terminal: ProviderRunEvent,
	): Promise<void> {
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
			terminalToolCall:
				terminal.type === "run_completed"
					? terminal.terminalToolCall
					: undefined,
			outputText:
				terminal.type === "run_completed" ? terminal.outputText : undefined,
			output: terminal.type === "run_completed" ? terminal.output : undefined,
			error: terminal.type === "run_failed" ? terminal.error : undefined,
		};
		this.runs.delete(handle.runId);
		this.terminalSnapshots.set(snapshot);
		try {
			await this.ensureRunner().then((runner) => runner.dispose(handle));
		} catch (error) {
			console.error("Claude Code run disposal failed", error);
		}
		if (handle.recordPath) {
			await appendProviderReplayRecord(handle.recordPath, {
				kind: "snapshot",
				provider: this.provider,
				recordedAt: new Date().toISOString(),
				snapshot,
			});
		}
	}

	/** Convenience for tests: list live runIds only. */
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
