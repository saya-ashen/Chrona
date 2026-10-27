// @ts-expect-error Chrona supplies the SDK at run time.
import { chrona, on } from "chrona";
import { join } from "node:path";

/**
 * Chrona's built-in memory provider (v2-21): the kernel's memory system module calls retain, recall and forget;
 * mnemopi (pinned in bun.lock) keeps them in data/memory.db. Full-text recall unless the user saved the
 * memory_embedding credential ({ apiUrl, model, apiKey }: an OpenAI-compatible embeddings endpoint).
 */
type Memory = { remember(content: string, options: { source: string; metadata: Record<string, string> }): string; recall(query: string, limit: number): Promise<{ id: string; content: string; timestamp: string | null; score: number }[]>; forget(id: string): boolean; sleep(dryRun?: boolean): unknown; close(): void };
// A variable specifier: the package is installed with the module, not with Chrona.
const PACKAGE = "@oh-my-pi/pi-mnemopi";
let opened: Promise<Memory> | undefined;

async function embedding() {
  try {
    const { value } = await chrona.secret({ name: "memory_embedding" }) as { value: Record<string, string> };
    return value.apiUrl && value.apiKey ? { noEmbeddings: false, embeddingApiUrl: value.apiUrl, embeddingApiKey: value.apiKey, ...(value.model ? { embeddingModel: value.model } : {}) } : null;
  } catch { return null; }
}
function memory() {
  opened ??= (async () => {
    const { Mnemopi } = await import(PACKAGE) as { Mnemopi: new (options: Record<string, unknown>) => Memory };
    return new Mnemopi({ dbPath: join(chrona.paths.data, "memory.db"), bank: "chrona", llm: false, ...(await embedding() ?? { noEmbeddings: true }) });
  })();
  return opened;
}
const text = (value: unknown, name: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} must be a non-empty string of at most ${max} characters`);
  return value;
};
const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  retain: async args => ({ id: (await memory()).remember(text(args.content, "content", 20_000), { source: text(args.source, "source", 200), metadata: { at: text(args.at, "at", 40) } }) }),
  recall: async args => {
    const limit = Math.min(Math.max(Math.trunc(Number(args.limit ?? 8)) || 8, 1), 20);
    return { items: (await (await memory()).recall(text(args.query, "query", 2000), limit)).map(item => ({ id: item.id, content: item.content, ...(item.timestamp ? { at: item.timestamp } : {}), score: item.score })) };
  },
  forget: async args => ({ forgotten: (await memory()).forget(text(args.id, "id", 200)) }),
};
on("tool", async (event: { id: string; args: Record<string, unknown>; caller?: { kind: string } }) => {
  // Only the kernel's memory module calls these; the build's smoke start sends a tool event without a caller.
  if (!event.caller) return { result: { ignored: "no caller" } };
  if (event.caller.kind !== "kernel") throw new Error("Only Chrona's memory module may call this");
  if (!Object.hasOwn(tools, event.id)) throw new Error(`Unknown tool ${event.id}`);
  return { result: await tools[event.id]!(event.args) };
});
// Daily consolidation with mnemopi's own rules (no model calls).
on("schedule", async () => { (await memory()).sleep(false); return {}; });
