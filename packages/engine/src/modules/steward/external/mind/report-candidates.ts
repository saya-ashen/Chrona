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

function transcriptReceipt(text: string | undefined) {
  let raw: unknown;
  try { raw = JSON.parse(text ?? ""); } catch { return null; }
  if (raw !== null && typeof raw === "object" && "result" in raw) raw = raw.result;
  const parsed = receiptResultSchema.safeParse(raw);
  return parsed.success && "reportId" in parsed.data ? parsed.data : null;
}

/** Caller must fetch this transcript from the exact current run after checking its identity. */
// eslint-disable-next-line complexity -- Successful receipt, tool and candidate checks form one authentication boundary.
export function selectTranscriptReport(decision: Decision, transcript: readonly { kind: string; tool?: string; error?: boolean; text?: string }[]): void {
  if (decision.report?.verified) return;
  const candidates = [...(decision.reportCandidates ?? []), ...(decision.report ? [decision.report] : [])];
  for (const item of transcript) {
    if (item.kind !== "result" || item.error !== false || !["m_mind_report", "mind.report"].includes(item.tool ?? "")) continue;
    const receipt = transcriptReceipt(item.text);
    if (!receipt || receipt.decisionId !== decision.id) continue;
    const selected = candidates.find(c => c.reportId === receipt.reportId);
    if (!selected) continue;
    decision.report = { ...selected, verified: true };
    return;
  }
}
