/**
 * runner-helpers — small, pure helpers used by `runner.ts`.
 */

import type { ProviderRunRef, ProviderRunSnapshot, StartRunInput } from "@chrona/providers-foundation";
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

export function runnerEnv(cfg: { env?: Record<string, string> }): NodeJS.ProcessEnv {
  return { ...process.env, ...(cfg.env ?? {}) };
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
