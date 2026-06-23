/**
 * claude-binary.ts — resolve a runnable `claude` executable WITHOUT requiring
 * a system-installed Claude Code CLI.
 *
 * Chrona depends on `@anthropic-ai/claude-agent-sdk`, which declares one
 * `optionalDependencies` entry per (os, arch, libc) tuple — each ships a
 * `claude` binary at its package root (e.g.
 * `@anthropic-ai/claude-agent-sdk-linux-x64/claude`). The SDK's `query()`
 * uses that bundled binary by default, so the runtime never needs an external
 * install.
 *
 * This helper exposes the same resolution for code paths that spawn `claude`
 * directly (the provider health probe) and for the live-test harness:
 *
 *   1. Resolve the platform SDK package via `require.resolve` (robust against
 *      hoisting / nested node_modules — no relative path walking).
 *   2. Fall back to a `claude` already on PATH (a developer's own install).
 *
 * Returns `null` only when neither source yields a path on disk.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

let cached: string | null | undefined;

/** Candidate SDK platform packages for the current (platform, arch). */
function platformPackages(): string[] {
  const { platform, arch } = process;
  if (platform === "linux") {
    if (arch === "x64") {
      return [
        "@anthropic-ai/claude-agent-sdk-linux-x64",
        "@anthropic-ai/claude-agent-sdk-linux-x64-musl",
      ];
    }
    if (arch === "arm64") {
      return [
        "@anthropic-ai/claude-agent-sdk-linux-arm64",
        "@anthropic-ai/claude-agent-sdk-linux-arm64-musl",
      ];
    }
  } else if (platform === "darwin") {
    return arch === "arm64"
      ? ["@anthropic-ai/claude-agent-sdk-darwin-arm64"]
      : ["@anthropic-ai/claude-agent-sdk-darwin-x64"];
  } else if (platform === "win32") {
    return arch === "arm64"
      ? ["@anthropic-ai/claude-agent-sdk-win32-arm64"]
      : ["@anthropic-ai/claude-agent-sdk-win32-x64"];
  }
  return [];
}

/** Binary file name inside a platform SDK package. */
function binaryName(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}

/**
 * Resolve the SDK-bundled `claude` binary path, or `null` if no platform
 * package is installed for the current host.
 */
export function resolveSdkClaudeBinary(): string | null {
  const require = createRequire(import.meta.url);
  for (const pkg of platformPackages()) {
    try {
      // Resolve the package's own package.json to locate its root dir; the
      // binary lives alongside it. `require.resolve` honors node_modules
      // hoisting, unlike walking relative paths.
      const pkgJson = require.resolve(`${pkg}/package.json`);
      const abs = join(dirname(pkgJson), binaryName());
      if (existsSync(abs)) return abs;
    } catch {
      // Package not installed for this platform — try the next candidate.
    }
  }
  return null;
}

/** Look up a bare `claude` on PATH. Returns the dir-qualified path or `null`. */
function claudeOnPath(): string | null {
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const name = binaryName();
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve a `claude` binary path for spawning. Prefers the SDK-bundled binary
 * (always present in a correctly-installed Chrona) and falls back to a
 * developer's PATH install. Cached for the process lifetime.
 *
 * Returns `null` only when neither source is available.
 */
export function resolveClaudeBinary(): string | null {
  if (cached !== undefined) return cached;
  cached = resolveSdkClaudeBinary() ?? claudeOnPath();
  return cached;
}
