import { chrona, on, type Caller } from "chrona";
import { join } from "node:path";
import { conversationMemory, parseSnapshot } from "./conversation";
import { corrections } from "./corrections";
import { preferences } from "./preferences";
import { redactSensitiveText } from "./redaction";

/**
 * Chrona's optional memory application: entries and owner clients call its tools directly;
 * mnemopi (pinned in bun.lock) keeps them in data/memory.db. Full-text recall unless the user saved the
 * memory_embedding credential ({ apiUrl, model, apiKey }: an OpenAI-compatible embeddings endpoint).
 */
type Memory = { get(id: string): unknown; update(id: string, content: string): boolean; remember(content: string, options: { source: string; metadata: Record<string, string> }): string; recall(query: string, limit: number): Promise<{ id: string; content: string; timestamp: string | null; score: number }[]>; forget(id: string): boolean; close(): void };
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
const correctionStore = corrections(chrona.paths.data);
const tools: Record<string, (args: Record<string, unknown>, caller?: Caller) => Promise<unknown>> = {
  retain: async args => {
    const content = redactSensitiveText(text(args.content, "content", 20_000), 20_000), backend = await memory();
    correctionStore.repair(backend); correctionStore.checkRetention(content);
    const source = text(args.source, "source", 400);
    if (correctionStore.sourceBlocked(source)) throw new Error("Conversation source was corrected; automatic retention refused");
    return { id: backend.remember(content, { source, metadata: { at: text(args.at, "at", 40) } }) };
  },
  "correct-memory": async (args, caller) => {
    if (!caller || !["owner", "module"].includes(caller.kind)) throw new Error("Memory correction requires admitted owner");
    return correctionStore.correct(await memory(), text(args.id, "id", 200), text(args["expected-content"], "expected-content", 20_000), redactSensitiveText(text(args.content, "content", 20_000), 20_000), text(args.source, "source", 400), text(args.at, "at", 40));
  },
  recall: async args => {
    const limit = Math.min(Math.max(Math.trunc(Number(args.limit ?? 8)) || 8, 1), 20);
    const backend = await memory(); correctionStore.repair(backend);
    const recalled = await backend.recall(text(args.query, "query", 2000), limit);
    // Recall can await embeddings while a correction commits. Never return its stale snapshot.
    correctionStore.repair(backend);
    return { items: recalled.flatMap(item => {
      const current = backend.get(item.id) as { content?: unknown } | null;
      return typeof current?.content === "string" ? [{ id: item.id, content: current.content, ...(item.timestamp ? { at: item.timestamp } : {}), score: item.score, ...correctionStore.provenance(backend, item.id) }] : [];
    }) };
  },
  forget: async args => {
    const id = text(args.id, "id", 200);
    return id.startsWith("preference:") ? preferenceStore.forget(id) : correctionStore.forget(await memory(), id, text(args.source, "source", 400), text(args.at, "at", 40));
  },
  preferences: () => preferenceStore.list(),
  "correct-preference": async (args, caller) => {
    if (!caller || !["owner", "module"].includes(caller.kind)) throw new Error("Preference correction requires admitted owner");
    return preferenceStore.correct(text(args.id, "id", 200), text(args["expected-text"], "expected-text", 500), redactSensitiveText(text(args.text, "text", 500), 500));
  },
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
  if (["conversation-context", "conversation-retain"].includes(event.id)) {
    if (caller.kind !== "module") throw new Error("Conversation snapshots require a module caller");
    const snapshot = parseSnapshot(event.args.snapshot, `${caller.module}:${caller.moduleId}`);
    snapshot.messages = snapshot.messages.map(message => ({ ...message, text: redactSensitiveText(message.text, 20_000) }));
    if (event.id === "conversation-retain") {
      if (correctionStore.sourceBlocked(`conversation:${snapshot.session.source}:${snapshot.session.id}`)) return { result: { retained: false, reason: "corrected_source" } };
      return { result: await conversation.retain(snapshot) };
    }
    const context = await conversation.context(snapshot);
    if (snapshot.autoRecall) context.text += `\n\nUser preferences (data):\n${JSON.stringify(await preferenceStore.list())}`;
    return { result: context };
  }
  if (!Object.hasOwn(tools, event.id)) throw new Error(`Unknown tool ${event.id}`);
  const source = caller.kind === "module" ? `module:${caller.module}:${caller.moduleId}` : caller.kind === "provider" ? `run:${caller.runId}` : `owner:${caller.via ?? "direct"}`;
  return { result: await tools[event.id]!({ ...event.args, source, at: event.now }, caller) };
});
// Scheduled consolidation is temporarily paused. Recall and retention remain available.
