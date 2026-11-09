import { randomUUID } from "node:crypto";
import { providerAnswerSchema, providerQuestionSchema, type ProviderAnswer, type ProviderQuestion, type ExecutionPayload } from "@chrona/contracts/steward";
export type QuestionView = Extract<ExecutionPayload, { type: "question" }>["question"];
type Pending = { question: ProviderQuestion; expires: number; finish(answer: ProviderAnswer, status: QuestionView["status"]): boolean };

/** Live promises only. Editor prefill and dialog messages never enter the journal.
 * Recovered answers cannot recreate a question or replay a provider response. */
export class Questions {
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly deadline: number, private readonly emit: (view: QuestionView) => void) {}
  ask(raw: ProviderQuestion, signal: AbortSignal): Promise<ProviderAnswer> {
    const question = providerQuestionSchema.parse(raw);
    if (signal.aborted || this.pending.size >= 3 || this.deadline <= Date.now()) return Promise.resolve({ decision: "cancel" });
    const requestId = `question:${randomUUID()}`, expires = Math.min(this.deadline, Date.now() + question.timeoutMs);
    const view: QuestionView = { requestId, method: question.method, title: question.title, options: question.options, expiresAt: new Date(expires).toISOString(), status: "pending" };
    return new Promise((resolve, reject) => {
      const finish = (answer: ProviderAnswer, status: QuestionView["status"]) => {
        if (!this.pending.delete(requestId)) return false;
        clearTimeout(timer); signal.removeEventListener("abort", interrupted);
        try { this.emit({ ...view, status }); resolve(answer); return true; } catch (error) { reject(error); return false; }
      };
      const interrupted = () => finish({ decision: "cancel" }, "interrupted");
      const timer = setTimeout(() => finish({ decision: "cancel" }, "expired"), Math.max(1, expires - Date.now())); timer.unref();
      this.pending.set(requestId, { question, expires, finish }); signal.addEventListener("abort", interrupted, { once: true });
      try { this.emit(view); if (signal.aborted) interrupted(); } catch (error) { this.pending.delete(requestId); clearTimeout(timer); signal.removeEventListener("abort", interrupted); reject(error); }
    });
  }
  answer(requestId: string, raw: unknown) {
    const answer = providerAnswerSchema.parse(raw), pending = this.pending.get(requestId);
    if (!pending) throw new Error("Question is stale, expired or belongs to another execution");
    if (pending.expires <= Date.now()) { pending.finish({ decision: "cancel" }, "expired"); throw new Error("Question has expired"); }
    const { question } = pending;
    if (answer.decision === "submit") {
      const valid = question.method === "confirm" ? typeof answer.value === "boolean" : question.method === "select" ? typeof answer.value === "number" && answer.value < question.options.length : typeof answer.value === "string";
      if (!valid) throw new Error("Answer does not match pending question method");
    }
    if (!pending.finish(answer, answer.decision === "cancel" ? "cancelled" : "answered")) throw new Error("Answer effect could not be durably recorded");
  }
  close() { for (const entry of [...this.pending.values()]) entry.finish({ decision: "cancel" }, "interrupted"); }
}
