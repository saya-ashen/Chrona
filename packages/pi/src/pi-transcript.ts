import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderTranscriptItem } from "@chrona/contracts/steward";

type Block = { type?: string; text?: string; name?: string; arguments?: unknown };
type Entry = { type?: string; timestamp?: string; message?: { role?: string; content?: (Block | null)[] | string; toolName?: string; isError?: boolean } };
function items(entry: Entry): ProviderTranscriptItem[] {
  const message = entry.message, at = entry.timestamp ?? "";
  if (entry.type !== "message" || !message) return [];
  const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : Array.isArray(message.content) ? message.content.filter((block): block is Block => block !== null && typeof block === "object") : [];
  if (message.role === "assistant") return blocks.flatMap<ProviderTranscriptItem>(block => {
    if (block.type === "text" && block.text?.trim()) return [{ at, kind: "text", text: block.text.trim() }];
    if (block.type === "toolCall" && block.name) return [{ at, kind: "tool", tool: block.name, args: JSON.stringify(block.arguments ?? {}) }];
    return [];
  });
  if (message.role !== "toolResult") return [];
  return [{ at, kind: "result", tool: message.toolName ?? "", text: blocks.filter(block => block.type === "text").map(block => block.text ?? "").join("\n"), error: message.isError === true }];
}
/** Pi owns its JSONL format. Thinking, user prompts and non-message records never enter the normalized transcript. */
export async function piTranscript({ sessionDir, limit }: { sessionDir: string; limit: number }): Promise<ProviderTranscriptItem[]> {
  const files = (await readdir(sessionDir, { recursive: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return [] as string[]; throw error; })).filter(name => name.endsWith(".jsonl")).sort();
  const result: ProviderTranscriptItem[] = [];
  for (const file of files) for (const line of (await readFile(join(sessionDir, file), "utf8")).split("\n")) {
    let entry: Entry | null;
    try { entry = JSON.parse(line) as Entry | null; } catch { continue; }
    if (entry && typeof entry === "object") result.push(...items(entry));
  }
  return result.slice(-limit);
}
