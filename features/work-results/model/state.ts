import { workResults as wr } from "@chrona/contracts";

export function resultWriteReason(context: wr.WorkResultContext, allowed: boolean) {
  if (!context.writesEnabled) return "writeDisabled" as const;
  if (!context.workOpen) return "closed" as const;
  return allowed ? null : "forbidden" as const;
}
export function canComposeResult(context: wr.WorkResultContext, view: wr.WorkResultView) {
  return context.canSubmit && (!view.version || view.state?.current === true);
}
export function resultReviewReason(context: wr.WorkResultContext, view: wr.WorkResultView, accept: boolean) {
  const denied = resultWriteReason(context, context.canReview);
  if (denied) return denied;
  if (!view.version || !view.state?.current) return "historical" as const;
  return accept && !view.state.canAcceptContent ? "notReady" as const : null;
}
export const emptyResultContent: wr.WorkResultContent = {
  schemaVersion: 1, outcome: { title: "", summary: "" }, readiness: { status: "ready", summary: "" },
  findings: [], decisions: [], caveats: [], nextActions: [], evidence: [], deliverables: [],
};
export function supportingDetails(content: wr.WorkResultContent) {
  const { outcome: _outcome, readiness: _readiness, schemaVersion: _schema, ...details } = content;
  return JSON.stringify(details, null, 2);
}
export function buildResultDraft(content: wr.WorkResultContent, details: string) {
  const parsed: unknown = JSON.parse(details);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid structured details");
  // Never let advanced details replace the visible outcome/readiness fields.
  if (Object.keys(parsed).some((key) => !["findings", "decisions", "caveats", "nextActions", "evidence", "deliverables", "page"].includes(key))) throw new Error("Invalid details key");
  return wr.workResultContentSchema.parse({ ...content, ...parsed });
}
