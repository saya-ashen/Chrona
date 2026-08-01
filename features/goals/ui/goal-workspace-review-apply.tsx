"use client";
import { v4 as uuidv4 } from "uuid";

import { useEffect, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardContent, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@shared/ui";
import { applyGoalReviewProposal, generateGoalReview, rejectGoalReviewProposal } from "../browser-api";
import { goalAiProgressText, type GoalCopy, type GoalData, type GoalReviewProposalData } from "../model/goal-types";

type DialogProps = { goal: GoalData; copy: GoalCopy; open: boolean; onOpenChange: (open: boolean) => void };
type Proposal = GoalReviewProposalData | null;
type ReviewItem = NonNullable<Proposal>["items"][number];
type ReviewDecision = { itemId: string; action: "accept" | "reject" | "convert_to_task" };

function activeProposal(goal: GoalData): Proposal {
  const latest = goal.reviewProposals[0] ?? null;
  if (!latest) return null;
  if (latest.status === "Generating" || latest.status === "Ready" || latest.status === "PartiallyApplied" || latest.status === "Failed") return latest;
  return null;
}

function itemPayload(item: ReviewItem) {
  return item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) ? item.payload as Record<string, unknown> : {};
}

function reviewItemLabel(item: ReviewItem, copy: GoalCopy) {
  const payload = itemPayload(item);
  if (item.kind === "brief_field") {
    const labels: Record<string, string> = { outcome: copy.outcomeLabel, currentFocus: copy.currentFocus, strategy: copy.strategy, constraints: copy.constraints };
    return labels[String(payload.field ?? "")] ?? copy.operationalBrief;
  }
  if (item.kind === "next_review_at") return copy.nextReview;
  if (item.kind === "task_candidate") return String(payload.title ?? copy.reviewTaskSuggestion);
  return String(payload.title ?? copy.successCriteria);
}

function reviewItemTitle(item: ReviewItem, copy: GoalCopy) {
  const label = reviewItemLabel(item, copy);
  if (item.kind === "brief_field" || item.kind === "next_review_at") return copy.updateReviewField.replace("{field}", label);
  if (item.kind === "task_candidate") return copy.createTaskReviewItem.replace("{title}", label);
  return copy.resolveEvidenceReviewItem.replace("{title}", label);
}

function reviewItemCurrentValue(item: ReviewItem, goal: GoalData) {
  if (item.kind === "next_review_at") return goal.nextReviewAt;
  if (item.kind !== "brief_field" || !goal.workbench.brief) return undefined;
  const field = String(itemPayload(item).field ?? "");
  if (field === "outcome" || field === "currentFocus" || field === "strategy" || field === "constraints") return goal.workbench.brief[field];
  return undefined;
}

function canApplyReviewItem(item: ReviewItem) {
  if (item.kind !== "evidence_gap") return true;
  const payload = itemPayload(item);
  return Boolean(payload.suggestedTask && typeof payload.suggestedTask === "object" && !Array.isArray(payload.suggestedTask));
}

function reviewDecision(item: ReviewItem, accept: boolean): ReviewDecision {
  return {
    itemId: item.itemId,
    action: accept ? item.kind === "evidence_gap" ? "convert_to_task" : "accept" : "reject",
  };
}

function allReviewDecisions(proposal: NonNullable<Proposal>) {
  return proposal.items
    .filter((item) => item.decision === "Pending")
    .map((item) => reviewDecision(item, true));
}

function useReviewActions({ goal, copy, proposal, mode, onOpenChange }: DialogProps & { proposal: Proposal; mode: "initial" | "progress" }) {
  const revalidator = useRevalidator();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressText, setProgressText] = useState(copy.aiProgress.queued);
  const run = async (operation: () => Promise<unknown>, close = false) => {
    if (pending) return;
    setPending(true); setError(null);
    try { await operation(); await revalidator.revalidate(); if (close) onOpenChange(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : copy.actionError); await revalidator.revalidate(); }
    finally { setPending(false); }
  };
  const applyDecisions = (decisions: ReviewDecision[], close: boolean) => proposal
    ? run(() => applyGoalReviewProposal(goal.id, proposal.id, { idempotencyKey: uuidv4(), decisions }), close)
    : undefined;
  return {
    pending, error, progressText,
    generate: () => {
      setProgressText(copy.aiProgress.queued);
      return run(() => generateGoalReview(goal.id, { idempotencyKey: uuidv4(), mode }, { onProgress: (event) => setProgressText(goalAiProgressText(copy, event)) }));
    },
    applyItem: (item: ReviewItem, accept: boolean) => applyDecisions([reviewDecision(item, accept)], proposal?.items.filter((candidate) => candidate.decision === "Pending").length === 1),
    applyAll: () => proposal ? applyDecisions(allReviewDecisions(proposal), true) : undefined,
    rejectAll: () => proposal ? run(() => rejectGoalReviewProposal(goal.id, proposal.id, { idempotencyKey: uuidv4() }), true) : undefined,
  };
}

export function ReviewApplyDialogContent({ goal, copy, open, onOpenChange }: DialogProps) {
  const proposal = activeProposal(goal);
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = proposal?.mode ?? (searchParams.get("review") === "initial" ? "initial" : "progress");
  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && searchParams.has("review")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("review");
      setSearchParams(nextParams, { replace: true });
    }
    onOpenChange(nextOpen);
  };
  const { pending, error, progressText, generate, applyItem, applyAll, rejectAll } = useReviewActions({ goal, copy, proposal, mode, open, onOpenChange: changeOpen });
  const revalidator = useRevalidator();
  useEffect(() => { if (!open || proposal?.status !== "Generating") return; const timer = window.setInterval(() => void revalidator.revalidate(), 2_000); return () => window.clearInterval(timer); }, [open, proposal?.status, revalidator]);
  const initial = mode === "initial";
  return <Dialog open={open} onOpenChange={changeOpen}><DialogContent className="flex max-h-[88dvh] flex-col sm:max-w-3xl"><DialogHeader><DialogTitle>{initial ? copy.initialPlanTitle : copy.applyReview}</DialogTitle><DialogDescription>{initial ? copy.initialPlanDescription : copy.applyReviewDescription}</DialogDescription></DialogHeader><div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"><ReviewStats goal={goal} copy={copy} /><ReviewBody goal={goal} proposal={proposal} copy={copy} description={initial ? copy.initialPlanDescription : copy.applyReviewDescription} pending={pending} progressText={progressText} generate={generate} onApplyItem={(item) => applyItem(item, true)} onRejectItem={(item) => applyItem(item, false)} />{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}</div><ReviewFooter copy={copy} proposal={proposal} pending={pending} onClose={() => changeOpen(false)} onApplyAll={() => applyAll()} onRejectAll={() => rejectAll()} /></DialogContent></Dialog>;
}

function ReviewStats({ goal, copy }: Pick<DialogProps, "goal" | "copy">) { return <div className="grid gap-2 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-3"><span>{goal.outcome.criteria.filter((criterion) => criterion.satisfied).length}/{goal.outcome.criteria.length} {copy.successCriteria}</span><span>{goal.workbench.focus.newResults.length} {copy.newResults}</span><span>{goal.acceptedResults.length} {copy.acceptedResults}</span></div>; }
function ReviewBody({ goal, proposal, copy, description, pending, progressText, generate, onApplyItem, onRejectItem }: { goal: GoalData; proposal: Proposal; copy: GoalCopy; description: string; pending: boolean; progressText: string; generate: () => void; onApplyItem: (item: ReviewItem) => void; onRejectItem: (item: ReviewItem) => void }) {
  if (!proposal) return <ReviewGenerateCard copy={copy} description={description} pending={pending} progressText={progressText} generate={generate} />;
  if (proposal.status === "Generating") return <Card><CardContent className="flex items-center gap-3 p-5 text-sm"><RefreshCw className="size-4 animate-spin" /><div><p className="font-medium" role="status">{progressText}</p><p className="text-muted-foreground">{copy.proposalSource} · AI</p></div></CardContent></Card>;
  if (proposal.status === "Failed") return <ReviewFailedCard copy={copy} pending={pending} progressText={progressText} generate={generate} />;
  return <ReviewItems goal={goal} proposal={proposal} copy={copy} pending={pending} onApplyItem={onApplyItem} onRejectItem={onRejectItem} />;
}
function ReviewGenerateCard({ copy, description, pending, progressText, generate }: { copy: GoalCopy; description: string; pending: boolean; progressText: string; generate: () => void }) { return <Card><CardContent className="space-y-3 p-5"><p className="font-medium">{copy.reviewSummary}</p><p className="text-sm text-muted-foreground">{description}</p>{pending ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><RefreshCw className="size-4 animate-spin" />{progressText}</p> : null}<Button disabled={pending} onClick={generate}><RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />{pending ? progressText : copy.generateReview}</Button></CardContent></Card>; }
function ReviewFailedCard({ copy, pending, progressText, generate }: { copy: GoalCopy; pending: boolean; progressText: string; generate: () => void }) {
  return <div role={pending ? undefined : "alert"} className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p className="font-medium text-destructive">{copy.proposalFailed}</p>{pending ? <p className="mt-3 flex items-center gap-2 font-medium text-foreground" role="status"><RefreshCw className="size-4 animate-spin" />{progressText}</p> : null}<Button className="mt-3" variant="outline" disabled={pending} onClick={generate}><RefreshCw className={pending ? "size-4 animate-spin" : "hidden"} />{pending ? progressText : copy.generateReview}</Button></div>;
}
function ReviewItems({ goal, proposal, copy, pending, onApplyItem, onRejectItem }: { goal: GoalData; proposal: NonNullable<Proposal>; copy: GoalCopy; pending: boolean; onApplyItem: (item: ReviewItem) => void; onRejectItem: (item: ReviewItem) => void }) {
  if (proposal.items.length === 0) return <p className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">{copy.proposalNoItems}</p>;
  return <div className="space-y-3">{proposal.items.map((item) => <ReviewItemCard key={item.id} goal={goal} item={item} copy={copy} pending={pending} onApply={() => onApplyItem(item)} onReject={() => onRejectItem(item)} />)}</div>;
}

function ReviewItemCard({ goal, item, copy, pending, onApply, onReject }: { goal: GoalData; item: ReviewItem; copy: GoalCopy; pending: boolean; onApply: () => void; onReject: () => void }) {
  const pendingItem = item.decision === "Pending";
  const applicable = canApplyReviewItem(item);
  const evidenceRefs = normalizeEvidenceRefs(item.evidenceRefs);
  const warnings = Array.isArray(item.warnings) ? item.warnings.filter((warning): warning is string => typeof warning === "string") : [];
  const label = reviewItemLabel(item, copy);
  const title = reviewItemTitle(item, copy);
  const applyLabel = item.kind === "evidence_gap" ? copy.createReviewTask : copy.applyReviewItem;
  return <article className="space-y-4 rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{title}</h3><Badge variant="outline">{reviewDecisionLabel(item.decision, copy)}</Badge></div><ReviewChangePreview item={item} currentValue={reviewItemCurrentValue(item, goal)} copy={copy} /><ReviewItemDetails rationale={item.rationale} evidenceRefs={evidenceRefs} warnings={warnings} copy={copy} />{item.decisionReason ? <p className="text-sm text-destructive">{item.decisionReason}</p> : null}{pendingItem ? <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button size="sm" variant="outline" disabled={pending} onClick={onReject} aria-label={`${copy.rejectReviewItem}: ${label}`}>{copy.rejectReviewItem}</Button><Button size="sm" disabled={pending || !applicable} onClick={onApply} aria-label={`${applyLabel}: ${label}`}>{pending ? copy.saving : applyLabel}</Button></div> : null}</article>;
}

function ReviewChangePreview({ item, currentValue, copy }: { item: ReviewItem; currentValue: unknown; copy: GoalCopy }) {
  if (currentValue === undefined) return <section aria-label={copy.suggestedReviewValue} className="rounded-lg border border-primary/20 bg-primary/5 p-3"><p className="mb-2 text-xs font-semibold text-primary">{copy.suggestedReviewValue}</p><ReviewItemValue item={item} copy={copy} /></section>;
  return <div className="grid gap-3 sm:grid-cols-2"><section aria-label={copy.currentReviewValue} className="rounded-lg bg-muted/40 p-3"><p className="mb-2 text-xs font-medium text-muted-foreground">{copy.currentReviewValue}</p><ReviewBriefValue value={currentValue ?? copy.noReview} /></section><section aria-label={copy.suggestedReviewValue} className="rounded-lg border border-primary/20 bg-primary/5 p-3"><p className="mb-2 text-xs font-semibold text-primary">{copy.suggestedReviewValue}</p><ReviewItemValue item={item} copy={copy} /></section></div>;
}

function ReviewItemValue({ item, copy }: { item: ReviewItem; copy: GoalCopy }) {
  const payload = itemPayload(item);
  if (item.kind === "brief_field") return <ReviewBriefValue value={payload.value} />;
  if (item.kind === "next_review_at") return <p className="text-sm">{String(payload.value ?? "")}</p>;
  if (item.kind === "task_candidate") return <ReviewTaskValue payload={payload} copy={copy} />;
  return <ReviewEvidenceGapValue payload={payload} copy={copy} />;
}

function ReviewBriefValue({ value }: { value: unknown }) {
  if (!Array.isArray(value)) return <p className="whitespace-pre-wrap text-sm">{String(value ?? "")}</p>;
  return <ul className="list-disc space-y-1 pl-5 text-sm">{value.map((entry, index) => <li key={index}>{String(entry)}</li>)}</ul>;
}

function ReviewTaskValue({ payload, copy }: { payload: Record<string, unknown>; copy: GoalCopy }) {
  const description = String(payload.description ?? "");
  const expectedOutcome = String(payload.expectedOutcome ?? "");
  return <div className="space-y-2 text-sm">{description ? <p>{description}</p> : null}{expectedOutcome ? <p><span className="font-medium">{copy.expectedOutcome}:</span> {expectedOutcome}</p> : null}</div>;
}

function ReviewEvidenceGapValue({ payload, copy }: { payload: Record<string, unknown>; copy: GoalCopy }) {
  const description = String(payload.description ?? "");
  const suggestedTask = payload.suggestedTask && typeof payload.suggestedTask === "object" && !Array.isArray(payload.suggestedTask) ? payload.suggestedTask as Record<string, unknown> : null;
  return <div className="space-y-2 text-sm">{description ? <p>{description}</p> : null}{suggestedTask ? <ReviewSuggestedTask task={suggestedTask} copy={copy} /> : <p className="text-muted-foreground">{copy.reviewItemCannotApply}</p>}</div>;
}

function ReviewSuggestedTask({ task, copy }: { task: Record<string, unknown>; copy: GoalCopy }) {
  return <div className="rounded-md border bg-background p-3"><p className="font-medium">{String(task.title ?? copy.reviewTaskSuggestion)}</p>{task.description ? <p className="mt-1 text-muted-foreground">{String(task.description)}</p> : null}{task.expectedOutcome ? <p className="mt-2"><span className="font-medium">{copy.expectedOutcome}:</span> {String(task.expectedOutcome)}</p> : null}</div>;
}

type ReviewEvidenceRef = { type: string; label?: string };

function normalizeEvidenceRefs(value: unknown): ReviewEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const reference = entry as Record<string, unknown>;
    if (typeof reference.type !== "string") return [];
    return [{ type: reference.type, ...(typeof reference.label === "string" ? { label: reference.label } : {}) }];
  });
}

function ReviewItemDetails({ rationale, evidenceRefs, warnings, copy }: { rationale: string; evidenceRefs: ReviewEvidenceRef[]; warnings: string[]; copy: GoalCopy }) {
  const summaries = [
    copy.reviewReason,
    evidenceRefs.length ? copy.reviewEvidenceCount.replace("{count}", String(evidenceRefs.length)) : "",
    warnings.length ? copy.reviewWarningCount.replace("{count}", String(warnings.length)) : "",
  ].filter(Boolean).join(" · ");
  return <details className="group rounded-lg border border-border/70 bg-muted/15 p-3"><summary className="cursor-pointer text-sm font-medium">{summaries}</summary><div className="mt-3 space-y-3"><p className="text-sm text-muted-foreground">{rationale}</p>{evidenceRefs.length ? <section><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.evidenceReferences}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{evidenceRefs.map((reference, index) => <li key={`${reference.type}-${index}`}>{reference.label ?? copy.sourceEvidence}</li>)}</ul></section> : null}{warnings.length ? <section><p className="text-xs font-medium uppercase tracking-wide text-warning">{copy.reviewWarnings}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-warning">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></section> : null}</div></details>;
}

function reviewDecisionLabel(decision: ReviewItem["decision"], copy: GoalCopy) {
  const labels: Record<ReviewItem["decision"], string> = { Pending: copy.proposalPending, Accepted: copy.proposalAccepted, Rejected: copy.proposalRejected, Converted: copy.proposalConverted, Ignored: copy.proposalIgnored, Stale: copy.proposalStale };
  return labels[decision];
}
function ReviewFooter({ copy, proposal, pending, onClose, onApplyAll, onRejectAll }: { copy: GoalCopy; proposal: Proposal; pending: boolean; onClose: () => void; onApplyAll: () => void; onRejectAll: () => void }) {
  const canAct = proposal?.status === "Ready" || proposal?.status === "PartiallyApplied";
  const pendingItems = proposal?.items.filter((item) => item.decision === "Pending") ?? [];
  const canApplyAll = pendingItems.length > 0 && pendingItems.every(canApplyReviewItem);
  return <DialogFooter className="border-t pt-4"><Button variant="outline" onClick={onClose}>{copy.cancel}</Button>{canAct && pendingItems.length > 0 ? <><Button variant="outline" disabled={pending} onClick={onRejectAll}>{copy.rejectAllReview}</Button><Button disabled={pending || !canApplyAll} onClick={onApplyAll}>{pending ? copy.saving : copy.applyAllReview}</Button></> : null}</DialogFooter>;
}
