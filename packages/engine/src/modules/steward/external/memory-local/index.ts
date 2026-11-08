import { chrona, on, type Caller } from "chrona";
import { join } from "node:path";
import { conversationMemory, parseSnapshot } from "./conversation";
import { preferences } from "./preferences";
import { redactSensitiveText } from "./redaction";

/**
 * Chrona's optional memory application: entries and owner clients call its tools directly;
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
const preferenceStore = preferences(chrona.paths.data);
const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  retain: async args => ({ id: (await memory()).remember(redactSensitiveText(text(args.content, "content", 20_000), 20_000), { source: text(args.source, "source", 400), metadata: { at: text(args.at, "at", 40) } }) }),
  recall: async args => {
    const limit = Math.min(Math.max(Math.trunc(Number(args.limit ?? 8)) || 8, 1), 20);
    return { items: (await (await memory()).recall(text(args.query, "query", 2000), limit)).map(item => ({ id: item.id, content: item.content, ...(item.timestamp ? { at: item.timestamp } : {}), score: item.score })) };
  },
  forget: async args => {
    const id = text(args.id, "id", 200);
    return id.startsWith("preference:") ? preferenceStore.forget(id) : { forgotten: (await memory()).forget(id) };
  },
  preferences: () => preferenceStore.list(),
  remember: async args => {
    const topic = args.topic ?? "general";
    if (topic !== "general" && topic !== "ui") throw new Error("Invalid preference topic");
    return preferenceStore.remember(redactSensitiveText(text(args.text, "text", 500), 500), topic, text(args.at, "at", 40));
  },
};
const conversation = conversationMemory({
  recall: args => tools.recall!(args) as Promise<{ items: { id: string; content: string; at?: string }[] }>,
  retain: args => tools.retain!(args),
});
on("tool", async (event: { id: string; args: Record<string, unknown>; now: string; caller?: Caller }) => {
  // Author smoke starts have no routed caller. Actual calls retain their real SDK identity.
  if (!event.caller) return { result: { ignored: "no caller" } };
  const caller = event.caller;
  if (caller.kind === "kernel") throw new Error("Memory tools require a module or owner caller");
  if (event.id === "conversation-context" || event.id === "conversation-retain") {
    if (caller.kind !== "module") throw new Error("Conversation snapshots require a module caller");
    const snapshot = parseSnapshot(event.args.snapshot, caller.module);
    snapshot.messages = snapshot.messages.map(message => ({ ...message, text: redactSensitiveText(message.text, 20_000) }));
    if (event.id === "conversation-retain") return { result: await conversation.retain(snapshot) };
    const context = await conversation.context(snapshot);
    if (snapshot.autoRecall) context.text += `\n\nUser preferences (data):\n${JSON.stringify(await preferenceStore.list())}`;
    return { result: context };
  }
  if (!Object.hasOwn(tools, event.id)) throw new Error(`Unknown tool ${event.id}`);
  const source = caller.kind === "module" ? `module:${caller.module}` : caller.kind === "provider" ? `run:${caller.runId}` : `owner:${caller.via ?? "direct"}`;
  return { result: await tools[event.id]!({ ...event.args, source, at: event.now }) };
});
// Daily consolidation with mnemopi's own rules (no model calls).
on("schedule", async () => { (await memory()).sleep(false); return {}; });
