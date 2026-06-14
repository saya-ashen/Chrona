/**
 * runner-helpers — small, pure helpers used by `runner.ts`.
 *
 * Pulled out of the main runner file to keep each module under the lint
 * `max-lines` cap (500 lines). All helpers here are side-effect-free
 * (except `writeMcpConfigFile`, which only writes a per-run JSON file
 * to disk and returns the path).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProviderRunRef, ProviderRunSnapshot, StartRunInput } from "@chrona/providers-foundation";

import type { ClaudeCodeRunnerConfig } from "./runner";

export interface BaseRefOptions {
  provider?: string;
  baseRef?: ProviderRunRef;
}

export function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export function renderPrompt(input: StartRunInput): string | undefined {
  if (typeof input.instructions === "string") return input.instructions;
  if (typeof input.instructions === "object") {
    const anyInst = input.instructions as { text?: unknown; messages?: unknown };
    if (typeof anyInst.text === "string") return anyInst.text;
    if (Array.isArray(anyInst.messages)) {
      return (anyInst.messages as { role?: string; content?: unknown }[])
        .map((m) => {
          const role = m.role ?? "user";
          const content =
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content ?? "");
          return `${role}: ${content}`;
        })
        .join("\n");
    }
  }
  return undefined;
}

export async function writeMcpConfigFile(cfg: ClaudeCodeRunnerConfig): Promise<string> {
  const dir = cfg.recordDir ?? join(process.cwd(), ".claude-code-mcp");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `mcp-${crypto.randomUUID()}.json`);
  const content = JSON.stringify(
    {
      mcpServers: {
        chrona: {
          type: "http",
          url: `${stripTrailingSlash(cfg.mcpBaseUrl)}/api/mcp`,
          headers: { Authorization: `Bearer ${cfg.mcpRunToken}` },
        },
      },
    },
    null,
    2,
  );
  await writeFile(path, content, "utf8");
  return path;
}

export function snapshotFromRef(
  handle: { runId: string; ref: ProviderRunRef },
  status: ProviderRunSnapshot["status"],
): ProviderRunSnapshot {
  return {
    provider: handle.ref.provider,
    runId: handle.runId,
    nativeRunId: handle.ref.nativeRunId,
    providerRunId: handle.ref.providerRunId,
    sessionId: handle.ref.sessionId,
    status,
  };
}
