import { providerQuestionSchema, type ProviderRunInput, type ProviderQuestion, type ProviderAnswer } from "@chrona/contracts/steward";
import { providerText, providerToolPhase, providerUsage, safeProviderQuestion, validProviderAnswer } from "@chrona/domain/steward/provider";

type RecordValue = Record<string, unknown>;
export class PiEvents {
  private baseline: unknown;
  private queue: Promise<unknown> = Promise.resolve();
  private controller = new AbortController();
  private dialogs = new Map<string, Promise<void>>();
  private progressCount = 0;
  constructor(private input: ProviderRunInput, private secrets: string[], private write: (record: RecordValue) => Promise<void>, private fail: (message: string) => void) {}
  get waiting() { return this.dialogs.size > 0; }
  private track(action: () => Promise<void>) { this.queue = this.queue.then(action).catch(() => {}); }
  progress(phase: Parameters<NonNullable<ProviderRunInput["events"]>["progress"]>[0]["phase"], tool: string | null = null) {
    if (!this.input.events || ++this.progressCount > 250) return;
    this.track(() => this.input.events!.progress({ phase, tool }));
  }
  receive(event: RecordValue) {
    if (this.controller.signal.aborted) return;
    if (event.type === "agent_start" || event.type === "tool_execution_end") this.progress("thinking");
    if (event.type === "auto_retry_start" || event.type === "compaction_start" || event.type === "summarization_retry_scheduled") this.progress("recovering");
    if (event.type === "tool_execution_start") { const { phase, tool } = providerToolPhase(providerText(event.toolName, this.secrets, 100)); this.progress(phase, tool); }
    if (event.type === "extension_ui_request") this.interaction(event);
  }
  private interaction(event: RecordValue) {
    if (!["select", "confirm", "input", "editor"].includes(String(event.method))) return; // No raw notify/widget/editor injection.
    if (!this.input.events) { this.fail("Pi interaction is not connected to Chrona"); return; }
    const id = event.id;
    if (typeof id !== "string" || !id || id.length > 200 || this.dialogs.size >= 3) { this.fail("Invalid Pi interaction"); return; }
    if (this.dialogs.has(id)) return;
    const input = this.parseQuestion(event);
    if (!input) { this.fail("Invalid or expired Pi interaction"); return; }
    this.progress("waiting");
    const task = this.answer(id, input.question, input.options).catch(() => { if (!this.controller.signal.aborted) this.fail("Could not complete Pi interaction"); }).finally(() => { this.dialogs.delete(id); });
    this.dialogs.set(id, task);
  }
  private parseQuestion(event: RecordValue) {
    const remaining = this.input.deadline.getTime() - Date.now();
    const timeout = typeof event.timeout === "number" && Number.isFinite(event.timeout) ? event.timeout : 300_000;
    const parsed = providerQuestionSchema.safeParse({ method: event.method, title: event.title ?? "Pi", message: event.message ?? event.placeholder ?? "", options: event.options ?? [], prefill: event.method === "editor" ? event.prefill : undefined, timeoutMs: Math.floor(Math.min(300_000, timeout, remaining)) });
    if (!parsed.success) return null; // Never offer approval of silently truncated context.
    const question = safeProviderQuestion(parsed.data, this.secrets);
    return question ? { question, options: parsed.data.options } : null;
  }
  private async answer(id: string, question: ProviderQuestion, options: string[]) {
    const answer = await this.input.events!.question(question, this.controller.signal);
    if (this.controller.signal.aborted) return;
    await this.write({ type: "extension_ui_response", id, ...this.response(question, answer, options) });
    this.progress("thinking");
  }
  private response(question: ProviderQuestion, answer: ProviderAnswer, options: string[]): RecordValue {
    if (!validProviderAnswer(question, answer)) throw new Error("Invalid Pi interaction response");
    if (answer.decision === "cancel") return { cancelled: true };
    if (question.method === "confirm") return { confirmed: answer.value };
    if (question.method === "select" && typeof answer.value === "number") return { value: options[answer.value] };
    return { value: answer.value };
  }
  async initialize(inspect: () => Promise<RecordValue>) {
    if (!this.input.events) return;
    try { this.baseline = await inspect(); } catch { /* Unknown remains unknown, never fabricated as zero. */ }
  }
  async collect(inspect: () => Promise<RecordValue>) {
    if (!this.input.events) return;
    try {
      const value = providerUsage(await inspect(), this.baseline);
      if (value) this.track(() => this.input.events!.usage(value));
    } catch { /* Optional statistics must not turn completed work into failure. */ }
    await this.queue;
  }
  async resources(version: string, commands: unknown, extensions: number) {
    if (!this.input.events) return;
    const skills = Array.isArray(commands) ? commands.filter(command => command.source === "skill").map(command => providerText(command.name, this.secrets, 100)).slice(0, 50) : [];
    this.track(() => this.input.events!.resources({ version, skills, extensions }));
    await this.queue;
  }
  interrupt() { this.controller.abort(); }
  async close() { this.interrupt(); await Promise.allSettled([...this.dialogs.values(), this.queue]); }
}
