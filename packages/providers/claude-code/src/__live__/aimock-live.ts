/**
 * aimock-live.ts — harness for *live* Claude Code provider tests.
 *
 * Unlike the replay tests (which feed a pre-recorded NDJSON tape into
 * `createReplayRunner`), these helpers spawn the **real** `claude` binary via
 * the Agent SDK and point it at:
 *
 *   - a mocked LLM endpoint (`LLMock`) that speaks the Anthropic messages
 *     wire format. Request-declared tools are registered in-process by the
 *     provider through the Agent SDK.
 *
 * The result is a genuine end-to-end exercise of `runner.ts` (SDK backend) +
 * `normalizers.ts` + `ClaudeCodeProviderClient` against real Claude Code
 * process output — the only thing faked is the LLM's token stream.
 *
 * This file is NOT a test (it has no `.bun.test.ts` suffix) so the bun-test
 * glob never picks it up directly; the test files import these helpers.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LLMock } from "@copilotkit/aimock";

import {
  createClaudeCodeRunner,
  type ClaudeCodeRunner,
  type ClaudeCodeRunnerConfig,
} from "../runner";
import { ClaudeCodeProviderClient } from "../ClaudeCodeProviderClient";

/* -------------------------------------------------------------------------- */
/*                         Binary availability gate                            */
let cachedBinaryOk: string | null | undefined;

/**
 * Resolve a runnable `claude` binary path. Prefers one on `PATH` (so a
 * user's installed Claude Code is used). Falls back to the linux-x64 binary
 * shipped inside `@anthropic-ai/claude-agent-sdk-linux-x64` so the live
 * test suite still runs on machines that only have the npm dependency
 * (CI runners, dev containers). Cached for the process lifetime.
 *
 * Returns `null` when no runnable binary can be located.
 */
export function findClaudeBinary(): string | null {
  if (cachedBinaryOk !== undefined) return cachedBinaryOk;

  // 1) A `claude` already on PATH wins.
  const onPath = probeBinary("claude");
  if (onPath) {
    cachedBinaryOk = onPath;
    return onPath;
  }

  // 2) Fall back to the npm-shipped binary for the current platform. The
  //    `@anthropic-ai/claude-agent-sdk` family publishes one optional
  //    dependency per (os, arch, libc) tuple; the binary lives at the
  //    package root, named `claude`.
  const candidates: string[] = [];
  if (process.platform === "linux" && process.arch === "x64") {
    candidates.push(
      "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
      "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude",
    );
  } else if (process.platform === "darwin") {
    candidates.push("@anthropic-ai/claude-agent-sdk-darwin-x64/claude");
    if (process.arch === "arm64") {
      candidates.push("@anthropic-ai/claude-agent-sdk-darwin-arm64/claude");
    }
  } else if (process.platform === "win32") {
    candidates.push("@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe");
  }

  const packageRoot = resolvePackageRoot();
  if (packageRoot) {
    for (const rel of candidates) {
      const abs = resolve(packageRoot, "node_modules", ...rel.split("/"));
      if (existsSync(abs) && probeBinary(abs)) {
        cachedBinaryOk = abs;
        return abs;
      }
    }
  }

  cachedBinaryOk = null;
  return null;
}

/** True when a runnable `claude` binary is locatable. */
export function claudeBinaryAvailable(): boolean {
  return findClaudeBinary() !== null;
}

/** Best-effort probe — `spawnSync` against the named binary; return its path on success. */
function probeBinary(bin: string): string | null {
  let res: SpawnSyncReturns<Buffer>;
  try {
    res = spawnSync(bin, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
  } catch {
    return null;
  }
  if (res.status !== 0) return null;
  // Resolve "claude" to its on-disk path so callers can prepend its dir to PATH.
  if (bin.includes("/") || bin.includes("\\")) return bin;
  return resolveOnPath(bin) ?? bin;
}

function resolveOnPath(bin: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    const candidate = join(
      dir,
      process.platform === "win32" ? `${bin}.exe` : bin,
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Find the repo's `node_modules` root by walking up from this file. The
 * harness lives at `packages/providers/claude-code/src/__live__/`, so going
 * up four levels reaches the workspace root where the @anthropic-ai optional
 * deps are hoisted.
 */
function resolvePackageRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // …/packages/providers/claude-code/src/__live__ → 4 levels up → repo root
  const candidate = resolve(here, "..", "..", "..", "..");
  return existsSync(join(candidate, "package.json")) ? candidate : null;
}

/* -------------------------------------------------------------------------- */
/*                              Mock LLM lifecycle                             */
/* -------------------------------------------------------------------------- */

export interface MockLlm {
  mock: LLMock;
  url: string;
  stop: () => Promise<void>;
}

/** Boot an aimock LLM server on an ephemeral port. */
export async function startMockLlm(): Promise<MockLlm> {
  const mock = new LLMock({ port: 0 });
  await mock.start();
  return {
    mock,
    url: mock.url,
    stop: () => mock.stop(),
  };
}

/* -------------------------------------------------------------------------- */
/*                          Live client construction                          */
/* -------------------------------------------------------------------------- */

export interface LiveClient {
  client: ClaudeCodeProviderClient;
  runner: ClaudeCodeRunner;
  configDir: string;
  /** Absolute path of the runnable `claude` executable that was selected. */
  claudeExecutable: string;
  cleanup: () => void;
}

/**
 * Build a `ClaudeCodeProviderClient` whose runner spawns the real `claude`
 * binary, routed at the mocked LLM endpoint. Request-declared tools are
 * registered in-process by the provider.
 */
export async function makeLiveClient(opts: {
  mockUrl: string;
  model?: string;
  timeoutMs?: number;
}): Promise<LiveClient> {
  const claudeExecutable = findClaudeBinary();
  if (!claudeExecutable) {
    throw new Error(
      "makeLiveClient: no runnable `claude` binary. Install Claude Code or run on a machine with @anthropic-ai/claude-agent-sdk-linux-x64 present.",
    );
  }

  const configDir = mkdtempSync(join(tmpdir(), "claude-provider-live-"));
  const onPath = process.env.PATH ?? "";
  const executableDir = dirname(claudeExecutable);
  const needsPathPrepend = !onPath.split(":").includes(executableDir);
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: opts.mockUrl,
    ANTHROPIC_API_KEY: "sk-aimock-placeholder",
    ANTHROPIC_AUTH_TOKEN: "sk-aimock-placeholder",
    CLAUDE_CONFIG_DIR: configDir,
    DISABLE_OMC: "1",
    OMC_SKIP_HOOKS: "1",
    PATH: needsPathPrepend ? `${executableDir}:${onPath}` : onPath,
    HOME: process.env.HOME ?? "",
  };

  const cfg: ClaudeCodeRunnerConfig = {
    model: opts.model ?? "claude-opus-4-8",
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    mcpBaseUrl: "http://unused.test",
    mcpRunToken: "",
    env,
  };
  const runner = await createClaudeCodeRunner(cfg);
  const client = new ClaudeCodeProviderClient({
    config: { mcpBaseUrl: "http://unused.test" },
    runner,
  });

  return {
    client,
    runner,
    configDir,
    claudeExecutable,
    cleanup: () => rmSync(configDir, { recursive: true, force: true }),
  };
}

/* -------------------------------------------------------------------------- */
/*                                Misc helpers                                 */
/* -------------------------------------------------------------------------- */

export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

/* -------------------------------------------------------------------------- */
/*                          Tool-result content extractor                     */
/* -------------------------------------------------------------------------- */

/**
 * Claude Code tool results come back from the agent as an array of
 * content blocks (e.g. `[{ type: "text", text: "..." }]`). For test
 * assertions we just want the concatenated text so the assertion doesn't
 * break when Anthropic reshapes the block array.
 */
export function extractToolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String(block.text)
          : "",
      )
      .join("");
  }
  return JSON.stringify(result ?? "");
}
