/* eslint-disable complexity, max-lines-per-function, max-lines, max-depth, @typescript-eslint/no-unnecessary-condition -- Provider runner keeps streaming protocol state transitions explicit. */
/**
 * runner.ts — the IO seam for the Claude Code provider.
 *
 * Sole place that touches:
 *   - the `@anthropic-ai/claude-agent-sdk` package
 *   - the per-run filesystem / MCP config / replay tape
 *
 * Everything above this file (ClaudeCodeProviderClient, normalizers) works
 * in terms of `@chrona/providers-foundation` types only, which is what
 * makes replay-based TDD possible without spawning Claude Code.
 *
 * Backends:
 *   - "sdk"    : drives the local `claude` binary via the Agent SDK (`query()`).
 *                The only real-driver backend. Cancel via `Query.interrupt()`.
 *   - "replay" : CI / unit-test only. Replays a recorded NDJSON tape.
 *
 * The SDK package is a hard dependency: `createClaudeCodeRunner` requires it
 * to load. There is no `claude -p` subprocess fallback — if the SDK cannot be
 * imported the run fails loudly rather than silently degrading to an
 * untested code path.
 *
 * Spec: specs/017-provider-claude-code/spec.md
 * Plan:  specs/017-provider-claude-code/plan.md §0.1, §0.5
 */

import { join } from "node:path";
import { realpathSync } from "node:fs";
import {
	appendProviderReplayRecord,
	providerReplayRecord,
	readProviderReplayTape,
	replayPathForRun,
	type ProviderReplayRecord,
	type ProviderReplayStartRecord,
} from "@chrona/providers-foundation";

import type {
	ProviderRunEvent,
	ProviderRunRef,
	ProviderRunSnapshot,
	StartRunInput,
} from "@chrona/providers-foundation";
import {
	query as sdkQuery,
	type SDKMessage,
	type HookInput,
} from "@anthropic-ai/claude-agent-sdk";
import {
	createNormalizerContext,
	mapClaudeCodeStreamItems,
	type NormalizerContext,
	type NormalizerOptions,
} from "./normalizers";
import {
	renderPrompt,
	runnerEnv,
	snapshotFromRef,
	stripTrailingSlash,
} from "./runner-helpers";
import { createLogger, type ChronaLogger } from "@chrona/logging";
import { ClaudeCodeProviderError } from "./types";
import {
	createRunToolsMcpServer,
	RUN_TOOLS_MCP_SERVER_NAME,
} from "./mcp-node-tools";

const runnerLogger = createLogger("packages.providers.claude-code");

function isProviderDebugEnabled(logger: ChronaLogger = runnerLogger): boolean {
	return logger.isLevelEnabled("debug");
}

function logProviderDebug(
	logger: ChronaLogger,
	event: string,
	data?: Record<string, unknown>,
): void {
	logger.debug(event, data);
}

type SdkHookInput = HookInput;
type SdkQueryOptions = NonNullable<Parameters<typeof sdkQuery>[0]["options"]>;
type SdkHooksOption = SdkQueryOptions["hooks"];

/**
 * Build SDK hooks for debug-level provider diagnostics. These hooks fire for
 * tool invocation, prompt submission, session boundaries, permission requests,
 * and SDK lifecycle notifications. They are only installed when the Chrona log
 * level enables debug output.
 */
function buildDebugHooks(logger: ChronaLogger): SdkHooksOption {
	// The SDK's HookInput union is 30 cases wide; we just need a permissive
	// record so the callback signatures line up at the call site. Each
	// callback returns `{}` (a valid `SyncHookJSONOutput`) to tell the SDK:
	// "do not block, do not override, do not inject context."
	const events = [
		"PreToolUse",
		"PostToolUse",
		"PostToolUseFailure",
		"PostToolBatch",
		"Notification",
		"UserPromptSubmit",
		"SessionStart",
		"SessionEnd",
		"Stop",
		"SubagentStart",
		"SubagentStop",
		"PreCompact",
		"PermissionRequest",
		"Setup",
	] as const;
	const result: Record<
		string,
		Array<{ hooks: Array<(input: SdkHookInput) => Promise<unknown>> }>
	> = {};
	for (const name of events) {
		result[name] = [
			{
				hooks: [
					async (input: SdkHookInput) => {
						// Each hook input is a discriminated union by `hook_event_name`.
						// We spread the literal fields we care about into the log entry
						// without depending on the full union type.
						const event =
							(input as { hook_event_name?: string }).hook_event_name ?? name;
						const summary: Record<string, unknown> = { event };
						const toolName = (input as { tool_name?: string }).tool_name;
						if (toolName) summary["tool_name"] = toolName;
						const toolInput = (input as { tool_input?: unknown }).tool_input;
						if (toolInput !== undefined) summary["tool_input"] = toolInput;
						const toolResponse = (input as { tool_response?: unknown })
							.tool_response;
						if (toolResponse !== undefined)
							summary["tool_response"] = toolResponse;
						const error = (input as { error?: unknown }).error;
						if (error !== undefined) summary["error"] = error;
						const durationMs = (input as { duration_ms?: unknown }).duration_ms;
						if (durationMs !== undefined) summary["duration_ms"] = durationMs;
						const message = (input as { message?: unknown }).message;
						if (message !== undefined) summary["message"] = message;
						const sessionId = (input as { session_id?: unknown }).session_id;
						if (sessionId !== undefined) summary["session_id"] = sessionId;
						logProviderDebug(logger, "claude_code.hook", summary);
						return {};
					},
				],
			},
		];
	}
	return result as SdkHooksOption;
}

export interface ClaudeCodeRunnerConfig {
	/** Default "claude-opus-4-8". */
	model?: string;
	/** Idle timeout (ms). Aborts only when SDK produces no events within this window. */
	timeoutMs?: number;
	/** Optional endpoint configuration retained for constructor compatibility. */
	mcpBaseUrl: string;
	/** Optional endpoint credential retained for constructor compatibility. */
	mcpRunToken: string;

	/** CWD for the spawned process. Default: `process.cwd()`. */
	cwd?: string;
	/** Pass-through env (merged on top of `process.env`). */
	env?: Record<string, string>;
	/** Replay record dir. When set, real-driver runs append NDJSON records. */
	recordDir?: string;
	/**
	 * Strict-unknown-event switch. When true, the normalizer throws on
	 * unrecognized stream `type` instead of mapping to `raw_event`.
	 * Mirrors Hermes's `CHRONA_HERMES_STRICT_UNKNOWN_EVENTS`.
	 */
	strictUnknownEvents?: boolean;
	/** Advanced SDK option overrides for isolated tests / embedders. Core transport options still win. */
	sdkOptions?: Partial<SdkQueryOptions>;
	/** Optional Claude binary override. Hidden from normal UI. */
	binaryPath?: string;
}

export interface ClaudeCodeRunnerDiagnostics {
	debugFile?: string;
	recordPath?: string;
	abortSignalAborted?: boolean;
	cancelRequested?: boolean;
	lastRawEvent?: Record<string, unknown>;
	lastMappedEvent?: Record<string, unknown>;
	recentRawEvents?: Record<string, unknown>[];
	iteratorError?: Record<string, unknown>;
	timeoutMs?: number;
	timeoutMode?: "idle";
	timeoutTriggered?: boolean;
	lastActivityAt?: string;
	timedOutAt?: string;
}

function errorDiagnostics(err: unknown): Record<string, unknown> {
	return {
		name: err instanceof Error ? err.name : typeof err,
		message: err instanceof Error ? err.message : String(err),
		stack: err instanceof Error ? err.stack : undefined,
	};
}

function summarizeSdkRawEvent(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== "object") return { valueType: typeof raw };
	const rec = raw as Record<string, unknown>;
	const message =
		typeof rec.message === "object" && rec.message !== null
			? (rec.message as Record<string, unknown>)
			: undefined;
	const content = Array.isArray(message?.content) ? message.content : undefined;
	const tool = content?.find(
		(item): item is Record<string, unknown> =>
			Boolean(item) && typeof item === "object" && "name" in item,
	);
	return {
		type: rec.type ?? null,
		subtype: rec.subtype ?? null,
		sessionId: rec.session_id ?? rec.sessionId ?? null,
		messageId: message?.id ?? null,
		role: message?.role ?? null,
		stopReason: message?.stop_reason ?? null,
		toolName: tool?.name ?? null,
		toolUseId: tool?.id ?? null,
	};
}

function summarizeProviderEvent(
	event: ProviderRunEvent,
): Record<string, unknown> {
	return {
		type: event.type,
		tool: "tool" in event ? event.tool : undefined,
		text: event.type === "text_delta" ? event.text : undefined,
	};
}

function pushRecentRaw(
	handle: ClaudeCodeRunHandle,
	rawSummary: Record<string, unknown>,
): void {
	const diagnostics = (handle.diagnostics ??= {});
	diagnostics.lastRawEvent = rawSummary;
	const recent = (diagnostics.recentRawEvents ??= []);
	recent.push(rawSummary);
	if (recent.length > 8) recent.shift();
}

interface SdkHandle {
	kind: "sdk";
	/** `Query` extends AsyncGenerator<SDKMessage, void>; we hold the reference. */
	query: AsyncGenerator<ProviderRunEvent, void> & {
		interrupt: () => Promise<void>;
	};
	pendingEvents?: ProviderRunEvent[];
	cancelRequested: boolean;
	terminalToolAccepted?: boolean;
}

interface ReplayHandle {
	kind: "replay";
	records: readonly ProviderReplayRecord[];
	index: number;
	cancelRequested: boolean;
}

export type ClaudeCodeRunHandle = {
	runId: string;
	ref: ProviderRunRef;
	internal: SdkHandle | ReplayHandle;
	normalizer: NormalizerContext;
	/** Optional path of the NDJSON tape we are writing to (real-driver record mode). */
	recordPath?: string;
	/** Caller-owned session id used to associate SDK resume state. */
	runSessionId: string;
	logger: ChronaLogger;
	externalSignal?: AbortSignal;
	diagnostics?: ClaudeCodeRunnerDiagnostics;
	idleTimeout?: IdleTimeoutHandle;
};

export interface ClaudeCodeRunner {
	/** Boot a run and return the runId + ref. Events are pulled via `stream()`. */
	start(input: StartRunInput): Promise<{ handle: ClaudeCodeRunHandle }>;
	/** Pull the next event for a handle; resolves to `null` when the run is terminal. */
	next(handle: ClaudeCodeRunHandle): Promise<ProviderRunEvent | null>;
	/** Snapshot the current state of a run. */
	snapshot(handle: ClaudeCodeRunHandle): Promise<ProviderRunSnapshot>;
	/** Cancel a running run. */
	cancel(handle: ClaudeCodeRunHandle): Promise<void>;
	/** Release resources (subprocess kill, file handles). Always call on shutdown. */
	dispose(handle: ClaudeCodeRunHandle): Promise<void>;
}

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_TIMEOUT_MS = 120 * 1000;
const HEALTH_PROBE_TIMEOUT_MS = 15_000;
const HEALTH_PROBE_PROMPT = "Reply with exactly `ready`. Do not use tools.";
const HEALTH_PROBE_FAILURE = "Claude Code SDK connectivity probe failed";

/* -------------------------------------------------------------------------- */
/*                                Public factories                            */
/**
 * Create a real-driver runner. Loads the `@anthropic-ai/claude-agent-sdk`
 * package and drives the local `claude` binary through it. The SDK is a
 * hard dependency — `init()` throws if it cannot be imported (no CLI
 * subprocess fallback).
 */
export async function createClaudeCodeRunner(
	cfg: ClaudeCodeRunnerConfig,
): Promise<ClaudeCodeRunner> {
	return new SdkRunner(cfg).init();
}

/**
 * Replay-only runner. Reads a single NDJSON tape (a file path, not a
 * directory) written by a previous real run or hand-authored for fixture
 * purposes. Replays it deterministically. Never spawns a process, never
 * imports the SDK.
 */
export function createReplayRunner(tapePath: string): ClaudeCodeRunner {
	return new ReplayRunner(tapePath);
}

/* -------------------------------------------------------------------------- */
/*                           Chrona self-path resolution                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the absolute path to the Chrona CLI binary that owns the
 * current process tree. In the production flow, `chrona` is the entry
 * point — `process.argv[1]` is the chrona binary path (or the compiled
 * ELF / Mach-O / PE binary at the launcher cache). In dev, it's the
 * workspace script (`packages/cli/src/index.ts` or `bun-entry.ts`)
 * invoked through `bun run`. Either way, realpath resolves symlinks so
 * the agent gets a stable absolute path.
 *
 * Returns `undefined` when argv[1] is missing, non-absolute, or
 * unresolvable — callers fall back to bare `chrona` (PATH lookup).
 */
function resolveSelfChronaPath(): string | undefined {
	const candidate = process.argv[1];
	if (!candidate) return undefined;
	try {
		return realpathSync(candidate);
	} catch {
		return undefined;
	}
}

/**
 * Build the env passed to a spawned `claude` process. Always sets
 * `CHRONA_CLI` value spawned process can resolve:
 * - Caller env override (`cfg.env.CHRONA_CLI`)
 * - Real path current chrona binary (e.g. launcher cache ELF
 *   in production, `packages/cli/src/index.ts` in dev)
 * - Bare `chrona` (PATH lookup) final fallback
 *
 * Exported for unit testing the env-construction seam without spawning
 * a real `claude` process.
 */
export function claudeRunEnv(cfg: ClaudeCodeRunnerConfig): NodeJS.ProcessEnv {
	return runnerEnv({
		env: {
			...(cfg.env ?? {}),
			CHRONA_CLI: cfg.env?.CHRONA_CLI ?? resolveSelfChronaPath() ?? "chrona",
		},
	});
}

/* -------------------------------------------------------------------------- */
/*                                Replay runner                                */
/* -------------------------------------------------------------------------- */

class ReplayRunner implements ClaudeCodeRunner {
	constructor(private readonly tapePath: string) {}

	async start(_input: StartRunInput): Promise<{ handle: ClaudeCodeRunHandle }> {
		void _input;
		const tape = await readProviderReplayTape(this.tapePath);
		const startRec = tape.start;
		if (!startRec) {
			throw new ClaudeCodeProviderError(
				`Replay tape missing 'start' record: ${this.tapePath}`,
				{ retryable: false },
			);
		}
		const ref = startRec.run;
		// Replay: keep the handle's runId in lockstep with the start record's
		// ref.runId so client.runs Map (keyed by handle.runId) and ref.runId
		// resolve to the same handle across startRun → getRun/cancelRun.
		const runId = ref.runId;
		const handle: ClaudeCodeRunHandle = {
			runId,
			ref,
			runSessionId: ref.sessionId,
			internal: {
				kind: "replay",
				records: tape.records,
				index: 0,
				cancelRequested: false,
			},
			normalizer: createNormalizerContext(),
			logger: runnerLogger.child({ runId, mode: "replay" }),
		};
		return { handle };
	}

	async next(handle: ClaudeCodeRunHandle): Promise<ProviderRunEvent | null> {
		if (handle.internal.kind !== "replay") {
			throw new ClaudeCodeProviderError("ReplayRunner.next: bad handle kind", {
				retryable: false,
			});
		}
		const { records } = handle.internal;
		while (handle.internal.index < records.length) {
			const rec = records[handle.internal.index++]!;
			if (rec.kind === "event") {
				return rec.event;
			}
			// `start` and `snapshot` records are metadata — skip on the event stream.
		}
		return null;
	}

	async snapshot(handle: ClaudeCodeRunHandle): Promise<ProviderRunSnapshot> {
		if (handle.internal.kind !== "replay") {
			throw new ClaudeCodeProviderError(
				"ReplayRunner.snapshot: bad handle kind",
				{
					retryable: false,
				},
			);
		}
		return snapshotFromReplayRecords(handle);
	}

	async cancel(handle: ClaudeCodeRunHandle): Promise<void> {
		if (handle.internal.kind !== "replay") {
			throw new ClaudeCodeProviderError(
				"ReplayRunner.cancel: bad handle kind",
				{
					retryable: false,
				},
			);
		}
		handle.internal.cancelRequested = true;
	}

	async dispose(): Promise<void> {
		// No-op: replay has no IO.
	}
}

/* -------------------------------------------------------------------------- */
/*                                  SDK runner                                 */
/* -------------------------------------------------------------------------- */

function binaryOption(cfg: ClaudeCodeRunnerConfig): Partial<SdkQueryOptions> {
	const path = cfg.binaryPath?.trim();
	return path ? ({ executable: path } as Partial<SdkQueryOptions>) : {};
}

function healthProbeResult(message: SDKMessage): string | null | undefined {
	if (message.type !== "result") return undefined;
	if (message.subtype === "success" && !message.is_error) return null;
	const errors =
		"errors" in message && Array.isArray(message.errors)
			? message.errors.join("; ")
			: undefined;
	return `${HEALTH_PROBE_FAILURE}: ${errors || message.subtype}`;
}

export async function probeClaudeCodeSdk(input: {
	config: ClaudeCodeRunnerConfig;
	timeoutMs?: number;
}): Promise<string | null> {
	const timeoutMs = input.timeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), timeoutMs);
	let query: ReturnType<typeof sdkQuery> | null = null;

	try {
		query = sdkQuery({
			prompt: HEALTH_PROBE_PROMPT,
			options: {
				...(input.config.sdkOptions ?? {}),
				model: input.config.model,
				cwd: input.config.cwd,
				env: claudeRunEnv(input.config),
				tools: [],
				maxTurns: 1,
				permissionMode: "dontAsk",
				abortController,
				...binaryOption(input.config),
			},
		});

		for await (const message of query) {
			const result = healthProbeResult(message);
			if (result !== undefined) return result;
		}
		return `${HEALTH_PROBE_FAILURE}: no result message`;
	} catch (err) {
		if (abortController.signal.aborted)
			return `${HEALTH_PROBE_FAILURE}: timed out after ${timeoutMs}ms`;
		return `${HEALTH_PROBE_FAILURE}: ${err instanceof Error ? err.message : String(err)}`;
	} finally {
		clearTimeout(timeout);
		query?.close();
	}
}

/**
 * Thrown by `probeMcpServer` when the MCP transport the SDK is about to
 * register is unreachable, unauthorized, or returns an unexpected tool list.
 * Surfaced as a start()-time error so callers see the real transport cause.
 */
export class McpProbeError extends Error {
	readonly mcpBaseUrl: string;
	readonly status: number;
	readonly toolCount: number;
	constructor(input: {
		message: string;
		mcpBaseUrl: string;
		status: number;
		toolCount: number;
		cause?: unknown;
	}) {
		super(input.message, { cause: input.cause });
		this.name = "McpProbeError";
		this.mcpBaseUrl = input.mcpBaseUrl;
		this.status = input.status;
		this.toolCount = input.toolCount;
	}
}

const MCP_PROBE_TIMEOUT_MS = 5_000;
const MCP_PROBE_PROTOCOL_VERSION = "2025-03-26";

/**
 * Probe an external MCP endpoint. This retained diagnostic helper is
 * transport-only; declared run tools are registered through the SDK-local
 * MCP server in `SdkRunner.start`.
 */
export async function probeMcpServer(input: {
	baseUrl: string;
	token: string;
	runId: string;
}): Promise<{ toolNames: string[]; status: number; sessionId: string | null }> {
	// An empty token is not a client-side error: an endpoint may accept
	// unauthenticated requests. We send no Authorization header and let the
	// endpoint response determine whether credentials are needed.
	const baseUrl = stripTrailingSlash(input.baseUrl);
	const { runId, token } = input;
	const url = `${baseUrl}/api/mcp`;
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		MCP_PROBE_TIMEOUT_MS,
	).unref();
	const body = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: MCP_PROBE_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "claude-code-provider-preflight", version: "0.0.0" },
		},
	});
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body,
			signal: controller.signal,
		});
	} catch (cause) {
		clearTimeout(timer);
		const message = cause instanceof Error ? cause.message : String(cause);
		runnerLogger.error("claude_code.mcp_probe_failed", {
			runId,
			baseUrl,
			reason: "fetch_error",
			message,
		});
		throw new McpProbeError({
			message: `MCP server at ${url} is unreachable: ${message}`,
			mcpBaseUrl: baseUrl,
			status: 0,
			toolCount: 0,
			cause,
		});
	}
	clearTimeout(timer);
	const status = response.status;
	const sessionId = response.headers.get("mcp-session-id");
	if (status === 401 || status === 403) {
		const body = await response.text().catch(() => "");
		runnerLogger.error("claude_code.mcp_probe_failed", {
			runId,
			baseUrl,
			reason: "auth_rejected",
			status,
			bodyExcerpt: body.slice(0, 200),
		});
		throw new McpProbeError({
			message:
				`MCP server rejected the Bearer token (HTTP ${status}). ` +
				"Set CHRONA_API_KEY to the server's API_KEY (or pass `mcpRunToken` in the client config).",
			mcpBaseUrl: baseUrl,
			status,
			toolCount: 0,
		});
	}
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		runnerLogger.error("claude_code.mcp_probe_failed", {
			runId,
			baseUrl,
			reason: "non_2xx",
			status,
			bodyExcerpt: body.slice(0, 200),
		});
		throw new McpProbeError({
			message: `MCP server returned HTTP ${status} for initialize: ${body.slice(0, 200)}`,

			mcpBaseUrl: baseUrl,
			status,
			toolCount: 0,
		});
	}
	// MCP initialize succeeds server-side; tool registration happens
	// separately. Issue a follow-up `tools/list` to confirm the endpoint
	// exposes at least one tool. Streamable HTTP returns JSON when configured
	// with `enableJsonResponse: true`; otherwise SSE — accept both.
	const tools = await probeMcpToolsList({ baseUrl, token, sessionId, runId });
	if (tools.length === 0) {
		runnerLogger.error("claude_code.mcp_probe_failed", {
			runId,
			baseUrl,
			reason: "no_tools",
		});
		throw new McpProbeError({
			message: `MCP server at ${url} returned 0 tools.`,
			mcpBaseUrl: baseUrl,
			status,
			toolCount: 0,
		});
	}
	runnerLogger.debug("claude_code.mcp_probe_ok", {
		runId,
		baseUrl,
		toolCount: tools.length,
		toolNames: tools,
	});
	return { toolNames: tools, status, sessionId };
}

async function probeMcpToolsList(input: {
	baseUrl: string;
	token: string;
	sessionId: string | null;
	runId: string;
}): Promise<string[]> {
	const url = `${input.baseUrl}/api/mcp`;
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		MCP_PROBE_TIMEOUT_MS,
	).unref();
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...(input.sessionId ? { "Mcp-Session-Id": input.sessionId } : {}),
				...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
				params: {},
			}),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) return [];
	// Try JSON; fall back to scanning SSE `data:` frames.
	const text = await response.text();
	try {
		const parsed = JSON.parse(text) as {
			result?: { tools?: Array<{ name: string }> };
		};
		if (Array.isArray(parsed?.result?.tools)) {
			return parsed.result.tools.map((t) => t.name);
		}
	} catch {
		/* not JSON; fall through to SSE */
	}
	const tools: string[] = [];
	for (const frame of text.split("\n\n")) {
		for (const line of frame.split("\n")) {
			if (!line.startsWith("data:")) continue;
			const data = line.slice(5).trim();
			if (!data) continue;
			try {
				const parsed = JSON.parse(data) as {
					result?: { tools?: Array<{ name: string }> };
				};
				if (Array.isArray(parsed?.result?.tools)) {
					for (const t of parsed.result.tools) tools.push(t.name);
				}
			} catch {
				/* skip */
			}
		}
	}
	return tools;
}
export function mcpUrlForSession(
	baseUrl: string,
	sessionId?: string | null,
): string {
	try {
		const url = new URL(`${stripTrailingSlash(baseUrl)}/api/mcp`);
		const trimmedSessionId =
			typeof sessionId === "string" ? sessionId.trim() : "";
		if (trimmedSessionId) {
			url.searchParams.set("session_id", trimmedSessionId);
		}
		return url.toString();
	} catch (cause) {
		throw new Error(`Invalid Claude Code MCP base URL: ${baseUrl}`, { cause });
	}
}
export function extractSdkSessionId(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const rec = raw as Record<string, unknown>;
	return typeof rec.session_id === "string" && rec.session_id.length > 0
		? rec.session_id
		: undefined;
}

export async function runClaudeConversationTurn(input: {
	sessionRef?: string;
	prompt: string;
	fork: boolean;
	config: ClaudeCodeRunnerConfig;
	signal?: AbortSignal;
}) {
	const abortController = new AbortController();
	const abort = () => abortController.abort();
	input.signal?.addEventListener("abort", abort, { once: true });
	let sessionRef = input.sessionRef ?? "";
	let outputText = "";
	let usage: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadInputTokens?: number;
		cacheCreationInputTokens?: number;
		contextWindow?: number;
	} | null = null;
	let compacted = false;
	try {
		const query = sdkQuery({
			prompt: input.prompt,
			options: {
				...(input.config.sdkOptions ?? {}),
				model: input.config.model ?? DEFAULT_MODEL,
				cwd: input.config.cwd,
				env: claudeRunEnv(input.config),
				abortController,
				...(input.sessionRef ? { resume: input.sessionRef } : {}),
				...(input.fork && input.sessionRef ? { forkSession: true } : {}),
				persistSession: true,
				permissionMode: "dontAsk",
				allowedTools: [],
				disallowedTools: [
					"Bash",
					"Edit",
					"Write",
					"NotebookEdit",
					"WebFetch",
					"WebSearch",
					"Task",
					"Agent",
				],
				mcpServers: {},
				...binaryOption(input.config),
			},
		});
		for await (const message of query) {
			const record = message as unknown as Record<string, unknown>;
			const nextSessionRef = extractSdkSessionId(message);
			if (nextSessionRef) sessionRef = nextSessionRef;
			if (record.type === "system" && record.subtype === "compact_boundary") {
				compacted = true;
			}
			if (record.type === "result") {
				if (typeof record.result === "string") outputText = record.result;
				const resultUsage = record.usage as Record<string, unknown> | undefined;
				const modelUsage = record.modelUsage as
					| Record<string, Record<string, unknown>>
					| undefined;
				const firstModelUsage = modelUsage
					? Object.values(modelUsage)[0]
					: undefined;
				usage = {
					inputTokens: numberField(resultUsage, "input_tokens"),
					outputTokens: numberField(resultUsage, "output_tokens"),
					cacheReadInputTokens:
						numberField(resultUsage, "cache_read_input_tokens") ??
						numberField(firstModelUsage, "cacheReadInputTokens"),
					cacheCreationInputTokens:
						numberField(resultUsage, "cache_creation_input_tokens") ??
						numberField(firstModelUsage, "cacheCreationInputTokens"),
					contextWindow: numberField(firstModelUsage, "contextWindow"),
				};
			}
		}
	} finally {
		input.signal?.removeEventListener("abort", abort);
	}
	return { sessionRef, outputText, usage, compacted };
}

function numberField(record: Record<string, unknown> | undefined, key: string) {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function validClaudeCodeResumeSessionRef(
	value: string | undefined,
): string | undefined {
	const ref = value?.trim();
	if (!ref) return undefined;
	if (ref.startsWith("claude-sdk-")) return undefined;
	return ref;
}

function updateHandleSdkSession(
	handle: ClaudeCodeRunHandle,
	sdkSessionId: string,
): void {
	handle.ref = {
		...handle.ref,
		nativeRunId: sdkSessionId,
		providerRunId: sdkSessionId,
		sessionId: sdkSessionId,
	};
}

interface IdleTimeoutHandle {
	reset(): void;
	clear(): void;
}

/**
 * Idle bound on SDK progress: abort only if Claude Code produces no stream
 * events for the configured window. Long tool/model runs survive as long as
 * the SDK keeps making observable progress.
 */
function armIdleTimeout(
	abortController: AbortController,
	diagnostics: ClaudeCodeRunnerDiagnostics,
	timeoutMs: number,
): IdleTimeoutHandle {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const reset = () => {
		if (timer) clearTimeout(timer);
		diagnostics.lastActivityAt = new Date().toISOString();
		timer = setTimeout(() => {
			diagnostics.timeoutTriggered = true;
			diagnostics.timedOutAt = new Date().toISOString();
			abortController.abort();
		}, timeoutMs);
		timer.unref();
	};
	const clear = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
	};
	reset();
	return { reset, clear };
}

class SdkRunner implements ClaudeCodeRunner {
	private readonly sdkSessionByRunSessionId = new Map<string, string>();

	private readonly cfg: ClaudeCodeRunnerConfig;
	constructor(cfg: ClaudeCodeRunnerConfig) {
		this.cfg = cfg;
	}
	async init(): Promise<this> {
		// Static import (vs. dynamic) is safe: the SDK is a hard dep declared
		// in this package's `dependencies` and is required for the provider
		// to function at all. Replay-only consumers use `createReplayRunner`
		// and never reach this class, so they don't pay the import cost.
		return this;
	}

	async start(input: StartRunInput): Promise<{ handle: ClaudeCodeRunHandle }> {
		const cfg = this.cfg;
		const model = cfg.model ?? DEFAULT_MODEL;
		const readOnly = input.toolPolicy === "read_only";
		const terminalOnly = input.toolPolicy === "terminal_only";
		const tools = readOnly ? [] : (input.tools ?? []);
		const abortController = new AbortController();
		const sdkHandle = {} as SdkHandle;
		const mcpServers =
			tools.length > 0
				? {
						[RUN_TOOLS_MCP_SERVER_NAME]: createRunToolsMcpServer({
							tools,
							onToolAccepted: (toolName) => {
								if (toolName === input.terminalToolName) {
									if (sdkHandle) sdkHandle.terminalToolAccepted = true;
									queueMicrotask(() => abortController.abort());
								}
							},
						}),
					}
				: undefined;
		const runId = `claude-sdk-${crypto.randomUUID()}`;
		// Prefer the live in-process capture (same process, mid-conversation);
		// fall back to the engine-supplied `resumeSessionRef` so a restarted
		// process can still resume the prior SDK session from persisted state.
		const resumedSdkSessionId =
			this.sdkSessionByRunSessionId.get(input.sessionId) ??
			validClaudeCodeResumeSessionRef(input.resumeSessionRef);
		const log = runnerLogger.child({
			runId,
			sessionId: input.sessionId,
			sessionKey: input.sessionKey ?? null,
		});
		const debugEnabled = isProviderDebugEnabled(log);
		const debugFile = debugEnabled
			? join(
					process.env["CHRONA_CLAUDE_DEBUG_DIR"] ?? "/tmp",
					`chrona-claude-${runId}.log`,
				)
			: undefined;
		const options = {
			...(cfg.sdkOptions ?? {}),
			model,
			...(mcpServers ? { mcpServers } : {}),
			permissionMode:
				readOnly || terminalOnly ? "dontAsk" : "bypassPermissions",
			...(readOnly || terminalOnly
				? {
						allowedTools: [],
						disallowedTools: [
							"Bash",
							"Edit",
							"Write",
							"NotebookEdit",
							"WebFetch",
							"WebSearch",
							"Task",
						],
					}
				: {}),
			abortController,
			cwd: cfg.cwd,
			env: claudeRunEnv(cfg),
			...(resumedSdkSessionId ? { resume: resumedSdkSessionId } : {}),
			// Honor an explicit binary override; otherwise SDK uses its
			// built-in `claude` executable.
			...binaryOption(cfg),
			...(debugEnabled ? { hooks: buildDebugHooks(log) } : {}),
			...(debugFile ? { debugFile } : {}),
		} as Parameters<typeof sdkQuery>[0]["options"];

		const prompt = renderPrompt(input) ?? "";
		log.info("claude_code.run_start", {
			controlPlane: mcpServers ? "declared_tools" : "none",
			hasDebugFile: Boolean(debugFile),
			resumedSdkSessionId: resumedSdkSessionId ?? null,
		});
		logProviderDebug(log, "claude_code.run_options", {
			cwd: cfg.cwd,
			timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			timeoutMode: "idle",
			mcpServerName: mcpServers ? RUN_TOOLS_MCP_SERVER_NAME : undefined,
			declaredToolNames: tools.map((tool) => tool.name),
			options,
		});
		logProviderDebug(log, "claude_code.prompt", { prompt });
		const queryObj = sdkQuery({
			prompt,
			options,
		});
		const initialProviderSessionId = resumedSdkSessionId ?? runId;
		const ref: ProviderRunRef = {
			provider: "claude_code",
			runId,
			nativeRunId: initialProviderSessionId,
			providerRunId: initialProviderSessionId,
			sessionId: initialProviderSessionId,
			status: "running",
			startedAt: new Date().toISOString(),
			stream: { supported: true, reconnectable: true },
		};
		Object.assign(sdkHandle, {
			kind: "sdk",
			query: queryObj as unknown as SdkHandle["query"],
			pendingEvents: [],
			cancelRequested: false,
			terminalToolAccepted: false,
		});
		const handle: ClaudeCodeRunHandle = {
			runId,
			ref,
			runSessionId: input.sessionId,
			internal: sdkHandle,
			normalizer: createNormalizerContext(),
			logger: log,
			externalSignal: input.signal,
			diagnostics: {
				debugFile,
				recordPath: undefined,
				abortSignalAborted: input.signal?.aborted ?? false,
				cancelRequested: false,
				timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				timeoutMode: "idle",
				recentRawEvents: [],
			},
		};
		handle.idleTimeout = armIdleTimeout(
			abortController,
			handle.diagnostics ?? {},
			cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		if (input.signal) {
			const onAbort = () => {
				if (handle.internal.kind === "sdk") {
					handle.internal.cancelRequested = true;
					abortController.abort();
				}
			};
			if (input.signal.aborted) onAbort();
			else input.signal.addEventListener("abort", onAbort, { once: true });
		}

		if (cfg.recordDir) {
			const path = replayPathForRun(cfg.recordDir, runId);
			handle.recordPath = path;
			handle.diagnostics = {
				...(handle.diagnostics ?? {}),
				recordPath: path,
			};
			const startRec: ProviderReplayStartRecord = providerReplayRecord(
				"claude_code",
				ref,
				input,
			);
			await appendProviderReplayRecord(path, startRec);
		}
		return { handle };
	}

	async next(handle: ClaudeCodeRunHandle): Promise<ProviderRunEvent | null> {
		if (handle.internal.kind !== "sdk") {
			throw new ClaudeCodeProviderError("SdkRunner.next: bad handle kind", {
				retryable: false,
			});
		}
		const pendingEvents = (handle.internal.pendingEvents ??= []);
		if (pendingEvents.length > 0) {
			return pendingEvents.shift() ?? null;
		}

		const q = handle.internal.query;
		for (;;) {
			let result: IteratorResult<ProviderRunEvent, void>;
			try {
				result = await q.next();
			} catch (err) {
				const diagnostics = (handle.diagnostics ??= {});
				diagnostics.abortSignalAborted =
					handle.externalSignal?.aborted ?? false;
				diagnostics.cancelRequested = handle.internal.cancelRequested;
				diagnostics.iteratorError = errorDiagnostics(err);
				handle.logger.error("claude_code.sdk_iterator_failed", {
					runId: handle.runId,
					sdkSessionId: handle.ref.sessionId,
					recordPath: handle.recordPath,
					debugFile: diagnostics.debugFile,
					abortSignalAborted: diagnostics.abortSignalAborted,
					cancelRequested: diagnostics.cancelRequested,
					lastRawEvent: diagnostics.lastRawEvent,
					lastMappedEvent: diagnostics.lastMappedEvent,
					recentRawEvents: diagnostics.recentRawEvents,
					error: diagnostics.iteratorError,
				});
				throw err;
			}
			if (handle.idleTimeout) handle.idleTimeout.reset();
			if (result.done) {
				handle.logger.debug("claude_code.stream_done");
				return null;
			}
			pushRecentRaw(handle, summarizeSdkRawEvent(result.value));
			const sdkSessionId = extractSdkSessionId(result.value);
			if (sdkSessionId) {
				this.sdkSessionByRunSessionId.set(handle.runSessionId, sdkSessionId);
				updateHandleSdkSession(handle, sdkSessionId);
			}
			const events = mapClaudeCodeStreamItems(
				[result.value],
				handle.normalizer,
				{
					cancelRequested: handle.internal.cancelRequested,
					strictUnknownEvents: handle.normalizer.strictUnknownEvents,
				} satisfies NormalizerOptions,
			);
			if (events.length === 0) continue;
			const [event, ...restEvents] = events as [
				ProviderRunEvent,
				...ProviderRunEvent[],
			];
			if (handle.diagnostics)
				handle.diagnostics.lastMappedEvent = summarizeProviderEvent(event);
			handle.logger.debug("claude_code.stream_event", {
				rawType: (result.value as { type?: unknown }).type ?? null,
				mappedType: event.type,
				emitted: true,
			});
			pendingEvents.push(...restEvents);
			if (
				event.type === "run_completed" ||
				event.type === "run_failed" ||
				event.type === "run_cancelled"
			) {
				handle.logger.info("claude_code.run_terminal", {
					status: event.type,
				});
				if (handle.idleTimeout) handle.idleTimeout.clear();
			}
			return event;
		}
	}

	async snapshot(handle: ClaudeCodeRunHandle): Promise<ProviderRunSnapshot> {
		return {
			provider: "claude_code",
			runId: handle.runId,
			nativeRunId: handle.ref.nativeRunId,
			providerRunId: handle.ref.providerRunId,
			sessionId: handle.ref.sessionId,
			status:
				handle.internal.kind === "sdk" && handle.internal.cancelRequested
					? "cancelled"
					: handle.internal.kind === "sdk" &&
							handle.internal.terminalToolAccepted
						? "completed"
						: "running",
		};
	}

	async cancel(handle: ClaudeCodeRunHandle): Promise<void> {
		if (handle.internal.kind !== "sdk") return;
		handle.internal.cancelRequested = true;
		if (handle.idleTimeout) handle.idleTimeout.clear();
		await handle.internal.query.interrupt();
	}

	async dispose(): Promise<void> {
		// No long-lived handles beyond the Query object (GC).
	}
}

/* -------------------------------------------------------------------------- */
/*                              Replay snapshot helpers                       */
/* -------------------------------------------------------------------------- */

function snapshotFromReplayRecords(
	handle: ClaudeCodeRunHandle,
): ProviderRunSnapshot {
	if (handle.internal.kind !== "replay") {
		throw new ClaudeCodeProviderError(
			"snapshotFromReplayRecords: bad handle kind",
			{ retryable: false },
		);
	}
	const records = handle.internal.records;
	const snapRec = records.findLast(
		(r): r is Extract<ProviderReplayRecord, { kind: "snapshot" }> =>
			r.kind === "snapshot",
	);
	if (snapRec) return snapRec.snapshot;

	const lastTerminal = records.findLast(
		(r): r is Extract<ProviderReplayRecord, { kind: "event" }> =>
			r.kind === "event" && isTerminalType(r.event.type),
	);
	if (lastTerminal)
		return snapshotFromTerminalEvent(lastTerminal.event, handle);

	return snapshotFromRef(
		handle,
		handle.internal.cancelRequested ? "cancelled" : "running",
	);
}

function isTerminalType(
	type: string,
): type is "run_completed" | "run_failed" | "run_cancelled" {
	return (
		type === "run_completed" ||
		type === "run_failed" ||
		type === "run_cancelled"
	);
}

function snapshotFromTerminalEvent(
	event: ProviderRunEvent,
	handle: ClaudeCodeRunHandle,
): ProviderRunSnapshot {
	if (event.type === "run_completed") {
		return {
			provider: event.provider ?? handle.ref.provider,
			runId: handle.runId,
			nativeRunId: event.nativeRunId,
			providerRunId: event.run.providerRunId ?? event.run.runId,
			sessionId: event.sessionId ?? handle.ref.sessionId,
			status: "completed",
			outputText: event.outputText,
			output: event.output,
		};
	}
	if (event.type === "run_failed" || event.type === "run_cancelled") {
		return {
			provider: event.provider ?? handle.ref.provider,
			runId: handle.runId,
			nativeRunId: event.nativeRunId,
			providerRunId: handle.ref.runId,
			sessionId: event.sessionId ?? handle.ref.sessionId,
			status: event.type === "run_failed" ? "failed" : "cancelled",
			error: "Reconstructed from tape terminal event",
		};
	}
	return snapshotFromRef(handle, "running");
}
