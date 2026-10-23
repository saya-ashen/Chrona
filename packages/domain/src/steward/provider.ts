import { providerUsageSchema, type ProviderAnswer, type ProviderProgress, type ProviderQuestion, type ProviderUsage, type ProviderInteraction } from "@chrona/contracts/steward";

/** Known secrets plus common credential formats. Never a promise of arbitrary secret detection. */
export function providerText(value: unknown, secrets: string[] = [], limit = 2000, multiline = false): string {
  let text = typeof value === "string" ? value : "";
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.replaceAll(secret, "[redacted]");
  return text.replace(/\p{Cc}\[[0-?]*[ -/]*[@-~]/gu, "").replace(/\r\n?/g, "\n").replace(/[\p{Cc}\p{Cf}]/gu, char => multiline && (char === "\n" || char === "\t") ? char : " ")
    .replace(/\b(?:sk-[\w-]{12,}|Bearer\s+[^\s,;]+)/gi, "[redacted]")
    .replace(/((?:password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]").slice(0, limit);
}
export function safeProviderQuestion(raw: ProviderQuestion, secrets: string[] = []): ProviderQuestion | null {
  const question = { ...raw, title: providerText(raw.title, secrets, 200), message: providerText(raw.message, secrets), options: raw.options.map(option => providerText(option, secrets, 300)), ...(raw.prefill === undefined ? {} : { prefill: providerText(raw.prefill, secrets, 8000, true) }) };
  if ([question.title, question.message, question.prefill ?? "", ...question.options].some(text => text.includes("[redacted]"))) return null;
  return question;
}
export function validProviderAnswer(question: ProviderQuestion, answer: ProviderAnswer): boolean {
  if (answer.decision === "cancel") return true;
  if (question.method === "confirm") return typeof answer.value === "boolean";
  if (question.method === "select") return typeof answer.value === "number" && Number.isInteger(answer.value) && answer.value >= 0 && answer.value < question.options.length;
  return typeof answer.value === "string" && answer.value.length <= 8000;
}
export function providerToolPhase(name: unknown): ProviderProgress {
  const tool = typeof name === "string" && /^[\w:.-]{1,100}$/.test(name) ? name : null;
  const phases = new Map<string, ProviderProgress["phase"]>([["read", "reading"], ["grep", "reading"], ["find", "reading"], ["ls", "reading"], ["edit", "writing"], ["write", "writing"], ["web_search", "searching"], ["fetch_content", "searching"], ["bash", "executing"]]);
  const phase = tool ? phases.get(tool) ?? "executing" : "executing";
  return { phase, tool };
}
export function providerRunActive(run: { status: string; deadlineAt: Date | null; leaseUntil: Date | null }, connected: boolean, now: Date): boolean {
  return run.status === "running" && connected && !!run.deadlineAt && run.deadlineAt > now && !!run.leaseUntil && run.leaseUntil > now;
}
export function providerRequestStatus(question: ProviderInteraction, receipt: ProviderInteraction["status"] | undefined, alive: boolean, waiting: boolean, now: Date): ProviderInteraction["status"] {
  if (receipt) return receipt;
  if (Date.parse(question.expiresAt) <= now.getTime()) return "expired";
  return alive && waiting ? "pending" : "interrupted";
}
/** Reject malformed/negative counters. A reset/missing baseline cannot be advertised as a run delta. */
export function providerUsage(current: unknown, baseline?: unknown): ProviderUsage | null {
  const parse = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const raw = value as { tokens?: Record<string, unknown>; cost?: unknown; contextUsage?: { tokens?: unknown; contextWindow?: unknown } | null };
    const parsed = providerUsageSchema.safeParse({ scope: "session", ...raw.tokens, cost: raw.cost, contextTokens: raw.contextUsage?.tokens ?? null, contextWindow: raw.contextUsage?.contextWindow ?? null });
    return parsed.success ? parsed.data : null;
  };
  const sessionId = (value: unknown) => value && typeof value === "object" && "sessionId" in value && typeof value.sessionId === "string" ? value.sessionId : null;
  const now = parse(current), before = parse(baseline);
  if (!now) return null;
  const sameSession = sessionId(current) !== null && sessionId(current) === sessionId(baseline);
  const keys = ["input", "output", "cacheRead", "cacheWrite", "total", "cost"] as const;
  if (!before || !sameSession || keys.some(key => now[key] < before[key])) return now;
  const result = { ...now, scope: "run" as const };
  for (const key of keys) result[key] = now[key] - before[key];
  return result;
}
