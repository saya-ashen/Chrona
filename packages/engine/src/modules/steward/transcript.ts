import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StewardPorts } from "./ports";

export type TranscriptItem =
  | { at: string; kind: "text"; text: string }
  | { at: string; kind: "tool"; tool: string; args: string }
  | { at: string; kind: "result"; tool: string; text: string; error: boolean };

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}…（已截断）` : text;
/** Credentials that may show up in tool output: Chrona's own secrets by value, and common token shapes. */
function redactor() {
  const values = Object.entries(process.env).filter(([key, value]) => /(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && value && value.length >= 8).map(([, value]) => value!);
  return (text: string) => values.reduce((out, value) => out.replaceAll(value, "[redacted]"), text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, "Bearer [redacted]").replace(/\b(sk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}/g, "[redacted]");
}
type Block = { type?: string; text?: string; name?: string; arguments?: unknown };
type Entry = { type?: string; timestamp?: string; message?: { role?: string; content?: Block[] | string; toolName?: string; isError?: boolean } };
function transcriptItems(entry: Entry, redact: (text: string) => string): TranscriptItem[] {
  const message = entry.message, at = entry.timestamp ?? "";
  if (entry.type !== "message" || !message) return [];
  const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content ?? [];
  if (message.role === "assistant") return blocks.flatMap<TranscriptItem>(block => {
    if (block.type === "text" && block.text?.trim()) return [{ at, kind: "text" as const, text: redact(clip(block.text.trim(), 4000)) }];
    if (block.type === "toolCall" && block.name) return [{ at, kind: "tool" as const, tool: block.name, args: redact(clip(JSON.stringify(block.arguments ?? {}), 500)) }];
    return [];
  });
  if (message.role !== "toolResult") return [];
  const text = blocks.filter(block => block.type === "text").map(block => block.text ?? "").join("\\n");
  return [{ at, kind: "result", tool: message.toolName ?? "", text: redact(clip(text, 2000)), error: message.isError === true }];
}

/**
 * `chat.transcript` (v2-13): what the Provider did in a conversation, from its Pi session files (`.chrona/sessions/`), as a
 * timeline: its text, tool calls and clipped results. The prompt and the model's thinking are left out; credentials redacted.
 */
export async function sessionTranscript(ports: Pick<StewardPorts, "dataDir">, sessionId: string, limit = 300): Promise<TranscriptItem[]> {
  const dir = join(ports.dataDir, "sessions", sessionId, ".chrona", "sessions");
  const files = (await readdir(dir, { recursive: true }).catch(() => [] as string[])).filter(name => name.endsWith(".jsonl")).sort();
  const redact = redactor(), items: TranscriptItem[] = [];
  for (const file of files) {
    for (const line of (await readFile(join(dir, file), "utf8")).split("\n")) {
      let entry: Entry;
      try { entry = JSON.parse(line) as Entry; } catch { continue; }
      items.push(...transcriptItems(entry, redact));
    }
  }
  return items.slice(-limit);
}
