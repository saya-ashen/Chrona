import { z } from "zod";
import { capacity, conflict } from "./store";
import { receiptResultSchema } from "./schema";
import type { Decision, ReportResult } from "./types";

type Candidate = { reportId: string; result: ReportResult; verified: boolean };
export function addReportCandidate(decision: Decision, candidate: Candidate): void {
  if (decision.report?.verified) {
    if (decision.report.reportId !== candidate.reportId) conflict("This decision already has a verified report");
    return;
  }
  const candidates = decision.reportCandidates ??= [];
  // Retain a seeded singular candidate without allowing it to reserve the selected report slot.
  if (decision.report && !candidates.some(c => c.reportId === decision.report!.reportId)) {
    if (candidates.length >= 8) capacity("Mind report candidate capacity reached");
    candidates.push({ ...decision.report, verified: false });
  }
  if (candidates.some(c => c.reportId === candidate.reportId)) return;
  if (candidates.length >= 8) capacity("Mind report candidate capacity reached");
  candidates.push({ ...candidate, verified: false });
}

const resultEvent = z.object({ kind: z.literal("tool-result"), payload: z.object({ type: z.literal("tool-result"), value: z.object({
  runId: z.string(), callId: z.string().min(1), target: z.literal("mind.report"), moduleId: z.string().min(1), hash: z.string().min(1),
  status: z.literal("succeeded"), outputState: z.literal("complete"), output: receiptResultSchema,
}).strict() }) });

/** Only a persisted routed result bound to this decision's Run authenticates a candidate. */
export function selectRunReport(decision: Decision, events: readonly unknown[]): void {
  if (decision.report?.verified) return;
  const candidates = [...(decision.reportCandidates ?? []), ...(decision.report ? [decision.report] : [])];
  for (const event of events) {
    const parsed = resultEvent.safeParse(event);
    if (!parsed.success || parsed.data.payload.value.runId !== decision.runId) continue;
    const receipt = parsed.data.payload.value.output;
    if (!("reportId" in receipt) || receipt.decisionId !== decision.id) continue;
    const selected = candidates.find(c => c.reportId === receipt.reportId);
    if (!selected) continue;
    decision.report = { ...selected, verified: true };
    return;
  }
}
