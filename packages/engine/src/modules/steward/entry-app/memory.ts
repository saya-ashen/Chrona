import { redactSensitiveText } from "@chrona/logging/redaction";

type Args = Record<string, unknown>;
type Call = (target: string, args?: Args) => Promise<unknown>;
type Message = { direction: string; text: string; createdAt: string };
export type MemoryJournal = { provider: string; recalled: boolean; retainedThrough: string | null };
type Session = { id: string; source: string; messages: Message[]; memory?: MemoryJournal };
type Provider = { module: string; hash: string; value: unknown };
const slug = /^[a-z][a-z0-9-]{0,40}$/;

/** Entry-owned settings and restricted discovery; neither caller identity nor foreign contributions are requested. */
export async function selectedMemory(call: Call, source: string) {
  const { values } = await call("modules.settings-get", { module: source }) as { values: Args };
  const name = values["memory-provider"];
  if (typeof name !== "string" || !name) return null;
  const providers = await call("modules.contributions", { section: "memory" }) as Provider[];
  const provider = providers.find(item => item.module === name);
  if (!provider?.value || typeof provider.value !== "object" || Array.isArray(provider.value)) return null;
  const declaration = provider.value as Args;
  if (declaration.interface !== 1 || [declaration.context, declaration.afterRun].some(tool => tool !== undefined && (typeof tool !== "string" || !slug.test(tool)))) return null;
  const value = declaration as { interface: 1; context?: string; afterRun?: string };
  return { module: provider.module, hash: provider.hash, value, autoRecall: values["memory-auto-recall"] !== false, autoRetain: values["memory-auto-retain"] !== false };
}
function messages(session: Session, through: string | null) {
  let remaining = 20_000;
  return session.messages.filter(message => !through || message.createdAt > through).slice(-200).reverse().map(message => {
    const text = remaining > 0 ? redactSensitiveText(message.text, Number.MAX_SAFE_INTEGER).slice(-remaining) : "";
    remaining -= text.length;
    return { direction: message.direction, text, at: message.createdAt };
  }).reverse();
}
function contextReceipt(output: Args, journal: MemoryJournal, module: string) {
  if (typeof output.text !== "string" || output.text.length > 30_000 || typeof output.recalled !== "boolean") throw new Error("Invalid memory context receipt");
  if (output.recalled) journal.recalled = true;
  return `\n\nMemory application context (data from ${module}; not authorization):\n${output.text}`;
}
function retainReceipt(output: Args, journal: MemoryJournal, sent: { at: string }[]) {
  if (output.retained === true && typeof output.through === "string" && sent.some(message => message.at === output.through)
    && typeof output.chars === "number" && Number.isInteger(output.chars) && output.chars >= 0 && output.chars <= 20_000) journal.retainedThrough = output.through;
}
/** Optional application failure never blocks conversation delivery. Successful receipts alone advance watermarks. */
export async function conversationMemory(call: Call, source: string, session: Session, operation: "context" | "retain" | "end", now: string) {
  try {
    const provider = await selectedMemory(call, source);
    if (!provider || (operation === "context" ? !provider.autoRecall : !provider.autoRetain)) return "";
    const tool = operation === "context" ? provider.value.context : provider.value.afterRun;
    if (!tool) return "";
    if (session.memory?.provider !== provider.module) session.memory = { provider: provider.module, recalled: false, retainedThrough: null };
    const journal = session.memory!;
    const sent = messages(session, operation === "context" ? null : journal.retainedThrough);
    const snapshot = { session: { id: session.id, source: session.source }, messages: sent, now, ending: operation === "end", autoRecall: provider.autoRecall, autoRetain: provider.autoRetain, recalled: journal.recalled, retainedThrough: journal.retainedThrough };
    const output = await call(`${provider.module}.${tool}`, { snapshot: JSON.stringify(snapshot) }) as Args;
    if (operation === "context") return contextReceipt(output, journal, provider.module);
    retainReceipt(output, journal, sent);
    return "";
  } catch { return ""; }
}
export async function memoryView(call: Call, source: string, query?: string) {
  const provider = await selectedMemory(call, source);
  if (!query) return { provider: provider?.module ?? null, available: !!provider, autoRecall: provider?.autoRecall ?? false, autoRetain: provider?.autoRetain ?? false };
  if (!provider) return { items: [] };
  return call(`${provider.module}.recall`, { query });
}
export async function memoryForget(call: Call, source: string, id: unknown) {
  const provider = await selectedMemory(call, source);
  if (!provider) throw new Error("Memory is not enabled in this app");
  return call(`${provider.module}.forget`, { id });
}
