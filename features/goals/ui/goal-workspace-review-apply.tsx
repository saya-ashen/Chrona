"use client";

import { useEffect, useState } from "react";
import { useRevalidator } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardContent, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@shared/ui";
import { applyGoalReviewProposal, generateGoalReview, rejectGoalReviewProposal } from "../browser-api";
import type { GoalCopy, GoalData, GoalReviewProposalData } from "../model/goal-types";

type DialogProps = { goal: GoalData; copy: GoalCopy; open: boolean; onOpenChange: (open: boolean) => void };
type Proposal = GoalReviewProposalData | null;

function activeProposal(goal: GoalData): Proposal {
  return goal.reviewProposals.find((candidate) => candidate.status === "Generating" || candidate.status === "Ready" || candidate.status === "PartiallyApplied") ?? goal.reviewProposals[0] ?? null;
}

function reviewItemLabel(item: NonNullable<Proposal>["items"][number], copy: GoalCopy) {
  const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) ? item.payload as Record<string, unknown> : {};
  if (item.kind === "brief_field") return `${copy.operationalBrief}: ${String(payload.field ?? "")}`;
  if (item.kind === "next_review_at") return copy.nextReview;
  if (item.kind === "task_candidate") return String(payload.title ?? copy.reviewTaskSuggestion);
  return String(payload.title ?? copy.successCriteria);
}

function reviewDecisions(proposal: NonNullable<Proposal>, selected: Record<string, boolean>) {
  return proposal.items.filter((item) => item.decision === "Pending").map((item) => ({
    itemId: item.itemId,
    action: selected[item.itemId] ? item.kind === "evidence_gap" ? "convert_to_task" as const : "accept" as const : item.kind === "evidence_gap" ? "ignore" as const : "reject" as const,
  }));
}

function useReviewActions({ goal, copy, proposal, onOpenChange }: DialogProps & { proposal: Proposal }) {
  const revalidator = useRevalidator();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (operation: () => Promise<unknown>, close = false) => {
    if (pending) return;
    setPending(true); setError(null);
    try { await operation(); await revalidator.revalidate(); if (close) onOpenChange(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : copy.actionError); await revalidator.revalidate(); }
    finally { setPending(false); }
  };
  return {
    pending, error,
    generate: () => run(() => generateGoalReview(goal.id, { idempotencyKey: crypto.randomUUID() })),
    apply: (selected: Record<string, boolean>) => proposal ? run(() => applyGoalReviewProposal(goal.id, proposal.id, { idempotencyKey: crypto.randomUUID(), decisions: reviewDecisions(proposal, selected) }), true) : undefined,
    reject: () => proposal ? run(() => rejectGoalReviewProposal(goal.id, proposal.id, { idempotencyKey: crypto.randomUUID() }), true) : undefined,
  };
}

export function ReviewApplyDialogContent({ goal, copy, open, onOpenChange }: DialogProps) {
  const proposal = activeProposal(goal);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const { pending, error, generate, apply, reject } = useReviewActions({ goal, copy, proposal, open, onOpenChange });
  const revalidator = useRevalidator();
  useEffect(() => { if (proposal?.status === "Ready") setSelected(Object.fromEntries(proposal.items.filter((item) => item.decision === "Pending").map((item) => [item.itemId, true]))); }, [proposal?.id, proposal?.status]);
  useEffect(() => { if (!open || proposal?.status !== "Generating") return; const timer = window.setInterval(() => void revalidator.revalidate(), 2_000); return () => window.clearInterval(timer); }, [open, proposal?.status, revalidator]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[88dvh] flex-col sm:max-w-3xl"><DialogHeader><DialogTitle>{copy.applyReview}</DialogTitle><DialogDescription>{copy.applyReviewDescription}</DialogDescription></DialogHeader><div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"><ReviewStats goal={goal} copy={copy} /><ReviewBody proposal={proposal} copy={copy} pending={pending} selected={selected} setSelected={setSelected} generate={generate} />{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}</div><ReviewFooter copy={copy} proposal={proposal} pending={pending} onClose={() => onOpenChange(false)} onApply={() => void apply(selected)} onReject={() => void reject()} /></DialogContent></Dialog>;
}

function ReviewStats({ goal, copy }: Pick<DialogProps, "goal" | "copy">) { return <div className="grid gap-2 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-3"><span>{goal.outcome.criteria.filter((criterion) => criterion.satisfied).length}/{goal.outcome.criteria.length} {copy.successCriteria}</span><span>{goal.workbench.focus.newResults.length} {copy.newResults}</span><span>{goal.acceptedResults.length} {copy.acceptedResults}</span></div>; }
function ReviewBody({ proposal, copy, pending, selected, setSelected, generate }: { proposal: Proposal; copy: GoalCopy; pending: boolean; selected: Record<string, boolean>; setSelected: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; generate: () => void }) {
  if (!proposal) return <ReviewGenerateCard copy={copy} pending={pending} generate={generate} />;
  if (proposal.status === "Generating") return <Card><CardContent className="flex items-center gap-3 p-5 text-sm"><RefreshCw className="size-4 animate-spin" /><div><p className="font-medium">{copy.generatingReview}</p><p className="text-muted-foreground">{copy.proposalSource} · {proposal.sourceTask.title}</p></div></CardContent></Card>;
  if (proposal.status === "Failed") return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p className="font-medium text-destructive">{copy.proposalFailed}</p><p className="mt-1 text-muted-foreground">{proposal.generationError}</p><Button className="mt-3" variant="outline" disabled={pending} onClick={generate}>{copy.generateReview}</Button></div>;
  return <ReviewItems proposal={proposal} copy={copy} selected={selected} setSelected={setSelected} />;
}
function ReviewGenerateCard({ copy, pending, generate }: { copy: GoalCopy; pending: boolean; generate: () => void }) { return <Card><CardContent className="space-y-3 p-5"><p className="font-medium">{copy.reviewSummary}</p><p className="text-sm text-muted-foreground">{copy.applyReviewDescription}</p><Button disabled={pending} onClick={generate}><RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />{pending ? copy.generatingReview : copy.generateReview}</Button></CardContent></Card>; }
function ReviewItems({ proposal, copy, selected, setSelected }: { proposal: NonNullable<Proposal>; copy: GoalCopy; selected: Record<string, boolean>; setSelected: React.Dispatch<React.SetStateAction<Record<string, boolean>>> }) { return <div className="space-y-3">{proposal.summary ? <p className="text-sm text-muted-foreground">{proposal.summary}</p> : null}{proposal.items.map((item) => { const pendingItem = item.decision === "Pending"; const checked = Boolean(selected[item.itemId]); return <label key={item.id} className="flex gap-3 rounded-xl border p-4"><Checkbox checked={checked} disabled={!pendingItem} onCheckedChange={(value) => setSelected((current) => ({ ...current, [item.itemId]: value === true }))} aria-label={reviewItemLabel(item, copy)} /><span className="min-w-0 space-y-1"><span className="flex flex-wrap items-center gap-2 font-medium">{reviewItemLabel(item, copy)}<Badge variant="outline">{item.decision}</Badge></span><span className="block text-sm text-muted-foreground">{item.rationale}</span>{item.decisionReason ? <span className="block text-sm text-destructive">{item.decisionReason}</span> : null}</span></label>; })}</div>; }
function ReviewFooter({ copy, proposal, pending, onClose, onApply, onReject }: { copy: GoalCopy; proposal: Proposal; pending: boolean; onClose: () => void; onApply: () => void; onReject: () => void }) { const canAct = proposal?.status === "Ready" || proposal?.status === "PartiallyApplied"; return <DialogFooter className="border-t pt-4"><Button variant="outline" onClick={onClose}>{copy.cancel}</Button>{canAct ? <><Button variant="outline" disabled={pending} onClick={onReject}>{copy.rejectProposal}</Button><Button disabled={pending || proposal.items.every((item) => item.decision !== "Pending")} onClick={onApply}>{pending ? copy.saving : copy.applyReview}</Button></> : null}</DialogFooter>; }
