/**
 * runner.ts — the IO seam for the Claude Code provider.
 *
 * Sole place that touches:
 *   - the `@anthropic-ai/claude-agent-sdk` package
 *   - the spawned `claude -p` subprocess (CLI fallback)
 *   - the per-run filesystem / MCP config / replay tape
 *
 * Everything above this file (ClaudeCodeProviderClient, normalizers) works
 * in terms of `@chrona/providers-foundation` types only, which is what
 * makes replay-based TDD possible without spawning Claude Code.
 *
 * Backends:
 *   - "sdk"    : drives the local `claude` binary via the Agent SDK (`query()`).
 *                Default. Cancel via `Query.interrupt()`.
 *   - "cli"    : spawns `claude -p` directly with `--mcp-config` +
 *                `--strict-mcp-config`. Fallback when the SDK package is
 *                not installed or fails to load.
 *   - "replay" : CI / unit-test only. Replays a recorded NDJSON tape.
 *
 * Spec: specs/017-provider-claude-code/spec.md
 * Plan:  specs/017-provider-claude-code/plan.md §0.1, §0.5
 */

import { spawn, type ChildProcess } from "node:child_process";
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
  writeMcpConfigFile,
  writeSkillSettingsFile,
} from "./runner-helpers";
import { ClaudeCodeProviderError } from "./types";

/** How the runner connects to Claude Code. */
export type RunnerBackend = "sdk" | "cli" | "replay";

export interface ClaudeCodeRunnerConfig {
  /** SDK / CLI mode. Ignored in `createReplayRunner`. */
  backend?: Exclude<RunnerBackend, "replay">;
  /** Override the `claude` CLI path (CLI mode only). Default: "claude". */
  binaryPath?: string;
  /** Default "claude-opus-4-8". */
  model?: string;
  /** Total run timeout (ms). SDK uses as overall bound; CLI uses as SIGKILL fallback. */
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

interface CliHandle {
  kind: "cli";
  child: ChildProcess;
  /** NDJSON line buffer (one line at a time). */
  lineBuf: string;
  cancelRequested: boolean;
  /** Resolver for the next event (used by `stream()` to push via promise queue). */
  pending: {
    resolve: (event: ProviderRunEvent | null) => void;
  } | null;
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
  internal: SdkHandle | CliHandle | ReplayHandle;
  normalizer: NormalizerContext;
  /** Optional path of the NDJSON tape we are writing to (real-driver record mode). */
  recordPath?: string;
  /** AbortSignal forwarded from `StartRunInput.signal` (best-effort). */
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
const SDK_IMPORT_NAME = "@anthropic-ai/claude-agent-sdk";

/* -------------------------------------------------------------------------- */
/*                                Public factories                            */
/* -------------------------------------------------------------------------- */

/**
 * Create a real-driver runner. Tries to load the SDK at construction time;
 * if that fails, falls back to CLI mode automatically. Callers can force a
 * specific backend via `config.backend`.
 */
export async function createClaudeCodeRunner(
  cfg: ClaudeCodeRunnerConfig,
): Promise<ClaudeCodeRunner> {
  const backend = await resolveBackend(cfg);
  if (backend === "cli") {
    return new CliRunner(cfg).init();
  }
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
/*                               Backend resolution                            */
/* -------------------------------------------------------------------------- */

async function resolveBackend(
  cfg: ClaudeCodeRunnerConfig,
): Promise<Exclude<RunnerBackend, "replay">> {
  if (cfg.backend) return cfg.backend;
  try {
    await import(/* @vite-ignore */ SDK_IMPORT_NAME);
    return "sdk";
  } catch (err) {
    // SDK package not present or failed to load — fall back to CLI.
    void err;
    return "cli";
  }
}
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
      internal: {
        kind: "replay",
        records: tape.records,
        index: 0,
        cancelRequested: false,
      },
      normalizer: createNormalizerContext(),
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
/*                                 CLI runner                                  */
/* -------------------------------------------------------------------------- */

class CliRunner implements ClaudeCodeRunner {
  private readonly cfg: ClaudeCodeRunnerConfig;
  constructor(cfg: ClaudeCodeRunnerConfig) {
    this.cfg = cfg;
  }
  async init(): Promise<this> {
    return this;
  }

  async start(input: StartRunInput): Promise<{ handle: ClaudeCodeRunHandle }> {
    const cfg = this.cfg;
    const model = cfg.model ?? DEFAULT_MODEL;
    const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model",
      model,
      "--permission-mode",
      "bypassPermissions",
    ];
    let skillRoot: string | undefined;
    if (cfg.controlPlane === "skill") {
      skillRoot = await mountChronaNodeSkill(cfg, input.control?.skillsDir);
      const settingsPath = await writeSkillSettingsFile(cfg, input.control?.skillName ?? "chrona-node");
      args.push("--add-dir", skillRoot, "--settings", settingsPath, "--allowedTools", "Bash");
    } else {
      const mcpConfigPath = await writeMcpConfigFile(cfg);
      args.push(
        "--mcp-config",
        mcpConfigPath,
        "--strict-mcp-config",
        "--allowedTools",
        "mcp__chrona__*",
      );
    }
    const prompt = renderPrompt(input);
    if (prompt) args.push(prompt);

    const child = spawn(cfg.binaryPath ?? "claude", args, {
      cwd: cfg.cwd ?? process.cwd(),
      env: skillEnv(cfg, input, skillRoot),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const runId = `claude-cli-${crypto.randomUUID()}`;
    const ref: ProviderRunRef = {
      provider: "claude_code",
      runId,
      nativeRunId: runId,
      providerRunId: runId,
      sessionId: runId,
      status: "running",
      startedAt: new Date().toISOString(),
      stream: { supported: true, reconnectable: false },
    };
    const handle: ClaudeCodeRunHandle = {
      runId,
      ref,
      internal: {
        kind: "cli",
        child,
        lineBuf: "",
        cancelRequested: false,
        pending: null,
      },
      normalizer: createNormalizerContext(),
      externalSignal: input.signal,
    };

    // Wall-clock timeout + external signal
    installCliLifecycle(child, handle, timeoutMs, input.signal);

    // Replay start record
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
    if (handle.internal.kind !== "cli") {
      throw new ClaudeCodeProviderError("CliRunner.next: bad handle kind", {
        retryable: false,
      });
    }
    const cli = handle.internal;
    if (cli.child.exitCode !== null) {
      // Process already exited; drain any remaining buffered partial line.
      if (cli.lineBuf.trim().length > 0) {
        const last = cli.lineBuf;
        cli.lineBuf = "";
        return normalizeCliLine(last, handle, cli.cancelRequested);
      }
      return null;
    }
    return new Promise<ProviderRunEvent | null>((resolve) => {
      cli.pending = { resolve };
    });
  }

  async snapshot(handle: ClaudeCodeRunHandle): Promise<ProviderRunSnapshot> {
    if (handle.internal.kind !== "cli") {
      throw new ClaudeCodeProviderError("CliRunner.snapshot: bad handle kind", {
        retryable: false,
      });
    }
    const cli = handle.internal;
    const status: ProviderRunSnapshot["status"] = cli.child.exitCode === null
      ? cli.cancelRequested
        ? "cancelled"
        : "running"
      : "completed";
    return {
      provider: "claude_code",
      runId: handle.runId,
      nativeRunId: handle.ref.nativeRunId,
      providerRunId: handle.ref.providerRunId,
      sessionId: handle.ref.sessionId,
      status,
    };
  }

  async cancel(handle: ClaudeCodeRunHandle): Promise<void> {
    if (handle.internal.kind !== "cli") {
      throw new ClaudeCodeProviderError("CliRunner.cancel: bad handle kind", {
        retryable: false,
      });
    }
    handle.internal.cancelRequested = true;
    handle.internal.child.kill("SIGTERM");
  }

  async dispose(handle: ClaudeCodeRunHandle): Promise<void> {
    if (handle.internal.kind !== "cli") return;
    if (handle.internal.child.exitCode === null) {
      handle.internal.child.kill("SIGTERM");
    }
  }
}

function normalizeCliLine(
  line: string,
  handle: ClaudeCodeRunHandle,
  cancelRequested: boolean,
): ProviderRunEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null; // skip malformed lines; record is best-effort
  }
  const events = mapClaudeCodeStreamItems([parsed], handle.normalizer, {
    cancelRequested,
    strictUnknownEvents: handle.normalizer.strictUnknownEvents,
  } satisfies NormalizerOptions);
  return events[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/*                                  SDK runner                                 */
/* -------------------------------------------------------------------------- */

class SdkRunner implements ClaudeCodeRunner {
  private readonly cfg: ClaudeCodeRunnerConfig;
  private sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null;
  constructor(cfg: ClaudeCodeRunnerConfig) {
    this.cfg = cfg;
  }
  async init(): Promise<this> {
    if (!this.sdkModule) {
      this.sdkModule = await import(/* @vite-ignore */ SDK_IMPORT_NAME);
    }
    return this;
  }

  async start(input: StartRunInput): Promise<{ handle: ClaudeCodeRunHandle }> {
    const sdk = (await this.init()).sdkModule!;
    const cfg = this.cfg;
    const model = cfg.model ?? DEFAULT_MODEL;
    const skillMode = cfg.controlPlane === "skill";
    const skillRoot = skillMode ? await mountChronaNodeSkill(cfg, input.control?.skillsDir) : undefined;
    const mcpServers = skillMode
      ? undefined
      : {
          chrona: {
            type: "http" as const,
            url: `${stripTrailingSlash(cfg.mcpBaseUrl)}/api/mcp`,
            headers: { Authorization: `Bearer ${cfg.mcpRunToken}` },
          },
        };
    const abortController = new AbortController();
    const skillOptions: { additionalDirectories?: string[]; skills?: string[] } = {};
    if (skillMode && typeof skillRoot === "string") {
      const mountedSkillRoot: string = skillRoot;
      skillOptions.additionalDirectories = [mountedSkillRoot] as string[];
      skillOptions.skills = [input.control?.skillName ?? "chrona-node"];
    }
    const options = {
      model,
      mcpServers,
      allowedTools: skillMode ? ["Bash"] : ["mcp__chrona__*"],
      permissionMode: "bypassPermissions",
      abortController,
      cwd: cfg.cwd,
      env: skillEnv(cfg, input, skillRoot),
      ...skillOptions,
    } as Parameters<typeof sdk.query>[0]["options"];
    const queryObj = sdk.query({
      prompt: renderPrompt(input) ?? "",
      options,
    });
    const runId = `claude-sdk-${crypto.randomUUID()}`;
    const ref: ProviderRunRef = {
      provider: "claude_code",
      runId,
      nativeRunId: runId,
      providerRunId: runId,
      sessionId: runId,
      status: "running",
      startedAt: new Date().toISOString(),
      stream: { supported: true, reconnectable: true },
    };
    const handle: ClaudeCodeRunHandle = {
      runId,
      ref,
      internal: {
        kind: "sdk",
        query: queryObj as unknown as SdkHandle["query"],
        cancelRequested: false,
      },
      normalizer: createNormalizerContext(),
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
    if (result.done) return null;
    const events = mapClaudeCodeStreamItems(
      [result.value],
      handle.normalizer,
      {
        cancelRequested: handle.internal.cancelRequested,
        strictUnknownEvents: handle.normalizer.strictUnknownEvents,
      } satisfies NormalizerOptions,
    );
    return events[0] ?? null;
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

function installCliLifecycle(
  child: ChildProcess,
  handle: ClaudeCodeRunHandle,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
): void {
  const killTimer = setTimeout(() => {
    if (handle.internal.kind === "cli" && !handle.internal.cancelRequested) {
      handle.internal.cancelRequested = true;
      child.kill("SIGTERM");
      setTimeout(() => child.killed || child.kill("SIGKILL"), 5000).unref();
    }
  }, timeoutMs);
  child.once("exit", () => clearTimeout(killTimer));

  if (externalSignal) {
    const onAbort = () => {
      if (handle.internal.kind === "cli") {
        handle.internal.cancelRequested = true;
        child.kill("SIGTERM");
      }
    };
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }
}

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

