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

import { realpathSync } from "node:fs";
import { join } from "node:path";
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
import { query as sdkQuery, type HookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  createNormalizerContext,
  mapClaudeCodeStreamItems,
  type NormalizerContext,
  type NormalizerOptions,
} from "./normalizers";
import {
  mountChronaNodeSkill,
  renderPrompt,
  snapshotFromRef,
  stripTrailingSlash,
} from "./runner-helpers";
import { createLogger, type ChronaLogger } from "@chrona/logging";
import { ClaudeCodeProviderError } from "./types";

const runnerLogger = createLogger("packages.providers.claude-code");

function isProviderDebugEnabled(logger: ChronaLogger = runnerLogger): boolean {
  return logger.isLevelEnabled("debug");
}

function logProviderDebug(logger: ChronaLogger, event: string, data?: Record<string, unknown>): void {
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
  const result: Record<string, Array<{ hooks: Array<(input: SdkHookInput) => Promise<unknown>> }>> = {};
  for (const name of events) {
    result[name] = [
      {
        hooks: [
          async (input: SdkHookInput) => {
            // Each hook input is a discriminated union by `hook_event_name`.
            // We spread the literal fields we care about into the log entry
            // without depending on the full union type.
            const event = (input as { hook_event_name?: string }).hook_event_name ?? name;
            const summary: Record<string, unknown> = { event };
            const toolName = (input as { tool_name?: string }).tool_name;
            if (toolName) summary["tool_name"] = toolName;
            const toolInput = (input as { tool_input?: unknown }).tool_input;
            if (toolInput !== undefined) summary["tool_input"] = toolInput;
            const toolResponse = (input as { tool_response?: unknown }).tool_response;
            if (toolResponse !== undefined) summary["tool_response"] = toolResponse;
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
   /**
   * Path to the `claude` executable handed to the SDK
   * (`pathToClaudeCodeExecutable`). Default: the SDK's built-in executable.
   */
  binaryPath?: string;
  /** Default "claude-opus-4-8". */
  model?: string;
  /** Total run timeout (ms). Overall bound on the SDK run. */
  timeoutMs?: number;
  /** Chrona /api/mcp base URL. */
  mcpBaseUrl: string;
  /** Per-run Bearer token sent in the MCP `Authorization` header. */
  mcpRunToken: string;
  /** Control transport used by Chrona node execution. Default: "mcp". */
  controlPlane?: "mcp" | "skill";
  /** Chrona /agent/control base URL for skill-mode CLI calls. */
  controlBaseUrl?: string;
  /** Optional source skill directory override. */
  skillDir?: string;
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
}

interface SdkHandle {
  kind: "sdk";
  /** `Query` extends AsyncGenerator<SDKMessage, void>; we hold the reference. */
  query: AsyncGenerator<ProviderRunEvent, void> & {
    interrupt: () => Promise<void>;
  };
  cancelRequested: boolean;
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
  /** AbortSignal forwarded from `StartRunInput.signal` (best-effort). */
  chronaSessionId: string;
  logger: ChronaLogger;
  externalSignal?: AbortSignal;
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
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

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
 * `CHRONA_CLI` to a value the spawned process can resolve:
 *   - Caller env override (`cfg.env.CHRONA_CLI`)
 *   - Per-run skill mount (`<skillRoot>/.claude/skills/chrona-node/bin/chrona`)
 *   - Real path of the current chrona binary (e.g. launcher cache ELF
 *     in production, `packages/cli/src/index.ts` in dev)
 *   - Bare `chrona` (PATH lookup) as final fallback
 *
 * When `controlPlane === "skill"`, also sets `CHRONA_BASE_URL` +
 * `CHRONA_RUN_TOKEN` and prepends the mounted skill bin to `PATH` so
 * the agent's `Bash` tool can resolve `chrona` without an absolute path.
 *
 * Exported for unit testing the env-construction seam without spawning
 * a real `claude` process.
 */
export function skillEnv(cfg: ClaudeCodeRunnerConfig, input: StartRunInput, skillRoot?: string): NodeJS.ProcessEnv {
  const env = { ...process.env, ...(cfg.env ?? {}) };
  if (env.CHRONA_CLI === undefined) {
    let resolved: string | undefined;
    if (skillRoot) {
      // Skill mount is the most explicit: the runner just wrote the
      // per-run `bin/chrona` shim there. Use the absolute path so the
      // agent never has to depend on PATH lookup at all.
      const skillBin = join(skillRoot, ".claude", "skills", "chrona-node", "bin");
      resolved = join(skillBin, "chrona");
    } else {
      // No skill mount. The current process was started by the chrona
      // binary (production) or `bun run` of `packages/cli/src/index.ts`
      // (dev). In both cases `process.argv[1]` is the chrona entry —
      // resolve symlinks and pass the real absolute path.
      resolved = resolveSelfChronaPath();
    }
    env.CHRONA_CLI = resolved ?? "chrona";
  }
  if (skillRoot) {
    env.PATH = `${join(skillRoot, ".claude", "skills", "chrona-node", "bin")}:${env.PATH ?? ""}`;
  }
  if (cfg.controlPlane === "skill") {
    env.CHRONA_BASE_URL = input.control?.baseUrl ?? cfg.controlBaseUrl ?? cfg.mcpBaseUrl;
    env.CHRONA_RUN_TOKEN = input.control?.runToken ?? cfg.mcpRunToken;
  }
  return env;
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
      chronaSessionId: ref.sessionId,
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
      throw new ClaudeCodeProviderError("ReplayRunner.snapshot: bad handle kind", {
        retryable: false,
      });
    }
    return snapshotFromReplayRecords(handle);
  }

  async cancel(handle: ClaudeCodeRunHandle): Promise<void> {
    if (handle.internal.kind !== "replay") {
      throw new ClaudeCodeProviderError("ReplayRunner.cancel: bad handle kind", {
        retryable: false,
      });
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

/** SDK option fragment that pins the `claude` executable, when overridden. */
function binaryOption(
  cfg: ClaudeCodeRunnerConfig,
): { pathToClaudeCodeExecutable?: string } {
  return cfg.binaryPath ? { pathToClaudeCodeExecutable: cfg.binaryPath } : {};
}

/**
 * Thrown by `probeMcpServer` when the MCP transport the SDK is about to
 * register is unreachable, unauthorized, or returns a tool list we don't
 * expect. Surfaced as a start()-time error so callers see the real cause
 * (token mismatch, wrong base URL, server offline) instead of a generic
 * "Provider completed without calling chrona_plan_generate" downstream.
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
 * Probe the Chrona MCP transport the SDK is about to register. Sends a
 * single `initialize` request (MCP Streamable HTTP) and:
 *   - 401/403 → throws `McpProbeError` ("MCP server rejected the Bearer
 *     token. Set CHRONA_API_KEY to the server's API_KEY, or pass
 *     `mcpRunToken` in the client config.")
 *   - non-2xx → throws `McpProbeError` with status + body excerpt
 *   - 2xx but no tools → throws (the agent would have nothing to call)
 *   - 2xx with tools → returns the tool name list for diagnostics
 *
 * Cheap: one POST, no streaming, no session reuse. Runs before the SDK
 * spawns `claude` so a broken MCP config is the first thing the caller
 * sees, not the last.
 */
export async function probeMcpServer(input: {
  baseUrl: string;
  token: string;
  runId: string;
}): Promise<{ toolNames: string[]; status: number; sessionId: string | null }> {
  const { baseUrl, token, runId } = input;
  // An empty token is NOT a client-side error: when the server runs without
  // `API_KEY` set, `apiKeyAuth()` passes every request through and no Bearer
  // is required (local dev). We therefore probe WITHOUT an Authorization
  // header and let the server's response decide — a server that DOES require
  // auth answers 401/403, which the branches below map to the actionable
  // "set CHRONA_API_KEY" error. This avoids rejecting a request the server
  // would have accepted.
  const url = `${baseUrl}/api/mcp`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_PROBE_TIMEOUT_MS).unref();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROBE_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "chrona-claude-code-preflight", version: "0.0.0" },
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
  // separately. Issue a follow-up `tools/list` to confirm the tool group
  // we expect (`mcp__chrona__*`) actually has entries. Streamable HTTP
  // returns JSON when the server is configured with
  // `enableJsonResponse: true`; otherwise SSE — we accept both.
  const tools = await probeMcpToolsList({ baseUrl, token, sessionId, runId });
  if (tools.length === 0) {
    runnerLogger.error("claude_code.mcp_probe_failed", {
      runId,
      baseUrl,
      reason: "no_tools",
    });
    throw new McpProbeError({
      message: `MCP server at ${url} returned 0 tools. The agent will have no \`mcp__chrona__*\` tool to call.`,
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
  const timer = setTimeout(() => controller.abort(), MCP_PROBE_TIMEOUT_MS).unref();
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
export function mcpUrlForSession(baseUrl: string, sessionId?: string | null): string {
  const url = new URL(`${stripTrailingSlash(baseUrl)}/api/mcp`);
  const trimmedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (trimmedSessionId) {
    url.searchParams.set("session_id", trimmedSessionId);
  }
  return url.toString();
}
export function extractSdkSessionId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  return typeof rec.session_id === "string" && rec.session_id.length > 0
    ? rec.session_id
    : undefined;
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



/**
 * Wall-clock bound on the run: abort the SDK query if it overruns. The timer
 * is unref'd so it never keeps the process alive, and aborting an already-
 * finished query is a harmless no-op.
 */
function armRunTimeout(abortController: AbortController, timeoutMs: number): void {
  setTimeout(() => abortController.abort(), timeoutMs).unref();
}

class SdkRunner implements ClaudeCodeRunner {
  private readonly sdkSessionByChronaSessionId = new Map<string, string>();

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
    const skillMode = cfg.controlPlane === "skill";
    const skillRoot = skillMode ? await mountChronaNodeSkill(cfg, input.control?.skillsDir) : undefined;
    const mcpBaseUrl = stripTrailingSlash(cfg.mcpBaseUrl);
    const mcpUrl = mcpUrlForSession(mcpBaseUrl, input.sessionId);
    const mcpServers = skillMode
      ? undefined
      : {
          chrona: {
            type: "http" as const,
            url: mcpUrl,
            // Omit the Authorization header entirely when no token is
            // configured: a server running without `API_KEY` accepts
            // unauthenticated requests, and sending `Bearer ` (empty)
            // would be a malformed header rather than "no auth".
            headers: cfg.mcpRunToken
              ? { Authorization: `Bearer ${cfg.mcpRunToken}` }
              : {},
          },
        };
    if (!skillMode) {
      // Fail-fast: the agent model needs the `mcp__chrona__*` tool group
      // to be reachable BEFORE it can call `mcp__chrona__chrona_plan_generate`.
      // The 401 we keep hitting in dev comes from this transport being
      // registered with a stale/invalid token — the agent would only
      // notice mid-session (wasting a model turn + scraping the OMC skill
      // catalog instead of running the task). Probe the MCP server once
      // here so a bad token / wrong URL is reported at start() time.
      await probeMcpServer({
        baseUrl: mcpBaseUrl,
        token: cfg.mcpRunToken,
        runId: "preflight",
      });
    }
    const abortController = new AbortController();
    const skillOptions: { additionalDirectories?: string[]; skills?: string[] } = {};
    if (skillMode && typeof skillRoot === "string") {
      const mountedSkillRoot: string = skillRoot;
      skillOptions.additionalDirectories = [mountedSkillRoot] as string[];
      skillOptions.skills = [input.control?.skillName ?? "chrona-node"];
    }
    const runId = `claude-sdk-${crypto.randomUUID()}`;
    // Prefer the live in-process capture (same process, mid-conversation);
    // fall back to the engine-supplied `resumeSessionRef` so a restarted
    // process can still resume the prior SDK session from persisted state.
    const resumedSdkSessionId =
      this.sdkSessionByChronaSessionId.get(input.sessionId) ?? input.resumeSessionRef;
    const log = runnerLogger.child({
      runId,
      sessionId: input.sessionId,
      sessionKey: input.sessionKey ?? null,
      controlPlane: cfg.controlPlane,
    });
    const debugEnabled = isProviderDebugEnabled(log);
    const debugFile = debugEnabled
      ? join(process.env["CHRONA_CLAUDE_DEBUG_DIR"] ?? "/tmp", `chrona-claude-${runId}.log`)
      : undefined;
    const options = {
      model,
      mcpServers,
      allowedTools: skillMode ? ["Bash"] : ["mcp__chrona__*"],
      permissionMode: "bypassPermissions",
      abortController,
      cwd: cfg.cwd,
      env: skillEnv(cfg, input, skillRoot),
      ...(resumedSdkSessionId ? { resume: resumedSdkSessionId } : {}),
      // Honor an explicit binary override; otherwise the SDK uses its
      // built-in `claude` executable.
      ...binaryOption(cfg),
      ...skillOptions,
      ...(debugEnabled ? { hooks: buildDebugHooks(log) } : {}),
      ...(debugFile ? { debugFile } : {}),
    } as Parameters<typeof sdkQuery>[0]["options"];

    const prompt = renderPrompt(input) ?? "";
    log.info("claude_code.run_start", {
      model,
      skillMode,
      allowedTools: options?.allowedTools,
      hasDebugFile: Boolean(debugFile),
      resumedSdkSessionId: resumedSdkSessionId ?? null,
    });
    logProviderDebug(log, "claude_code.run_options", {
      cwd: cfg.cwd,
      binaryPath: cfg.binaryPath ?? null,
      timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      mcpBaseUrl,
      mcpUrl,
      skillRoot,
      options,
    });
    logProviderDebug(log, "claude_code.prompt", { prompt });
    armRunTimeout(abortController, cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
    const handle: ClaudeCodeRunHandle = {
      runId,
      ref,
      chronaSessionId: input.sessionId,
      internal: {
        kind: "sdk",
        query: queryObj as unknown as SdkHandle["query"],
        cancelRequested: false,
      },
      normalizer: createNormalizerContext(),
      logger: log,
      externalSignal: input.signal,
    };
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
    const q = handle.internal.query;
    const result = await q.next();
    if (result.done) {
      handle.logger.debug("claude_code.stream_done");
      return null;
    }
    const sdkSessionId = extractSdkSessionId(result.value);
    if (sdkSessionId) {
      this.sdkSessionByChronaSessionId.set(handle.chronaSessionId, sdkSessionId);
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
    const event = events[0];
    handle.logger.debug("claude_code.stream_event", {
      rawType: (result.value as { type?: unknown }).type ?? null,
      mappedType: event.type,
      emitted: true,
    });
    if (event.type === "run_completed" || event.type === "run_failed" || event.type === "run_cancelled") {
      handle.logger.info("claude_code.run_terminal", {
        status: event.type,
      });
    }
    return event;
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
          : "running",
    };
  }

  async cancel(handle: ClaudeCodeRunHandle): Promise<void> {
    if (handle.internal.kind !== "sdk") return;
    handle.internal.cancelRequested = true;
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
  if (lastTerminal) return snapshotFromTerminalEvent(lastTerminal.event, handle);

  return snapshotFromRef(handle, handle.internal.cancelRequested ? "cancelled" : "running");
}

function isTerminalType(
  type: string,
): type is "run_completed" | "run_failed" | "run_cancelled" {
  return (
    type === "run_completed" || type === "run_failed" || type === "run_cancelled"
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

