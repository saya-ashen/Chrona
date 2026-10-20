import type { ProviderRunView, ProviderQuestion } from "@chrona/contracts";

export type ProviderRecordView = ProviderRunView & { closedInteractions: ProviderRunView["interactions"] };
export type ProviderDisplayMode = "all" | "questions" | "summary";
export function providerWork(runs: ProviderRunView[], mode: ProviderDisplayMode = "all") {
  const pending = (run: ProviderRunView) => run.interactions.some(question => question.status === "pending");
  const active = runs.filter(run => run.active && (mode === "questions" ? pending(run) : mode !== "summary" || !pending(run)));
  const questions = mode === "summary" ? [] : active.flatMap(run => run.interactions.filter(question => question.status === "pending").map(question => ({ run, question })));
  const history = mode === "questions" ? [] : runs.filter(run => run.usage || run.resources || run.interactions.length).map(run => ({ ...run, closedInteractions: run.interactions.filter(item => item.status !== "pending") }));
  return { active, questions, history, hasContent: active.length + questions.length + history.length > 0 };
}
export function providerAnswerReady(question: ProviderQuestion, choice: number | null, text: string) {
  return question.method === "select" ? choice !== null && choice >= 0 && choice < question.options.length : text.trim().length > 0;
}
export function providerUsageText(usage: NonNullable<ProviderRunView["usage"]>, locale: string) {
  return { tokens: new Intl.NumberFormat(locale).format(usage.total), cost: new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(usage.cost),
    context: usage.contextTokens !== null && usage.contextWindow ? `${new Intl.NumberFormat(locale).format(usage.contextTokens)} / ${new Intl.NumberFormat(locale).format(usage.contextWindow)}` : null };
}
