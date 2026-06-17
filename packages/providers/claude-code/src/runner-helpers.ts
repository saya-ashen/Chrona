/**
 * runner-helpers — small, pure helpers used by `runner.ts`.
 *
 * Pulled out of the main runner file to keep each module under the lint
 * `max-lines` cap (500 lines). All helpers here are side-effect-free
 * (except `mountChronaNodeSkill`, which copies the bundled skill into a
 * per-run directory and returns its path).
 */

import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  const instructions = renderInstructions(input.instructions);
  const payload = renderInputPayload(input.input);
  if (!payload) return instructions;
  if (!instructions) return payload;
  return `${instructions}\n\n## Chrona provider input\n${payload}`;
}

function renderInstructions(instructions: StartRunInput["instructions"]): string | undefined {
  if (typeof instructions === "string") return instructions;
  if (typeof instructions === "object") {
    const anyInst = instructions as { text?: unknown; messages?: unknown };
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

function renderInputPayload(input: StartRunInput["input"]): string | undefined {
  if (typeof input === "string") return input;
  if ("type" in input && input.type === "text" && typeof input.text === "string") return input.text;
  const entries = Object.entries(input).filter(([key]) => key !== "signal");
  if (entries.length === 0) return undefined;
  return JSON.stringify(Object.fromEntries(entries), null, 2);
}

const CHRONA_NODE_SKILL_SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "skills",
  "chrona-node",
);

export async function mountChronaNodeSkill(cfg: ClaudeCodeRunnerConfig, source = cfg.skillDir): Promise<string> {
  const dir = join(cfg.recordDir ?? join(process.cwd(), ".claude-code-mcp"), `skill-${crypto.randomUUID()}`);
  const target = join(dir, ".claude", "skills", "chrona-node");
  await mkdir(target, { recursive: true });
  await cp(source ?? CHRONA_NODE_SKILL_SOURCE, target, { recursive: true, force: true });
  return dir;
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
