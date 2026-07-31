"use client";

import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  FileSearch,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Badge } from "@shared/ui";
import { Button } from "@shared/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shared/ui";


import { Label } from "@shared/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/ui";


import {
  applyGoalAssetOwnership,
  generateGoalAssetOwnership,
  resolveGoalInboxCandidate,
  type GoalAssetWorkbenchData,
  type GoalInboxCandidateData,
  type GoalAssetOwnershipProposalData,
} from "../workbench-api";
import {
  contentText,
  formatCopy,
  kindLabel,
  type AssetWorkbenchCopy,
} from "./goal-asset-workbench-shared";
function inboxReasonLabel(reason: string, copy: AssetWorkbenchCopy) {
  if (
    reason === "rule_based_name_match" ||
    reason === "Same asset type and a similar user-confirmed name"
  ) {
    return copy.ruleBasedMatchDescription;
  }
  if (
    reason === "no_rule_based_name_match" ||
    reason === "No confident existing asset identity match"
  ) {
    return copy.noRuleBasedMatchDescription;
  }
  return reason;
}

function inboxChangeSummaryLabel(
  summary: string,
  candidateLabel: string,
  copy: AssetWorkbenchCopy,
) {
  return summary ===
    `Candidate derived from accepted result “${candidateLabel}”`
    ? formatCopy(copy.candidateFromAcceptedResult, { result: candidateLabel })
    : summary;
}

function normalizedPreviewText(content: GoalInboxCandidateData["content"]) {
  if (typeof content === "string") {
    return content
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const summary = (content as Record<string, unknown>).summary;
    if (typeof summary === "string" && summary.trim()) return summary.replace(/\s+/g, " ").trim();
  }
  return contentText(content).replace(/\s+/g, " ").trim();
}

function CandidatePreview({ candidate, copy }: { candidate: GoalInboxCandidateData; copy: AssetWorkbenchCopy }) {
  const preview = useMemo(() => normalizedPreviewText(candidate.content), [candidate.content]);
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start gap-2">
        <FileSearch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="line-clamp-3 text-sm leading-6">{preview || copy.genericFileDescription}</p>
      </div>
      <details className="group mt-2">
        <summary className="cursor-pointer list-none text-sm font-medium text-primary underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">{copy.previewMode}</span>
          <span className="hidden group-open:inline">{copy.hideDetails}</span>
        </summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 text-xs leading-5">{contentText(candidate.content)}</pre>
      </details>
    </div>
  );
}

type OwnershipResult = NonNullable<GoalAssetOwnershipProposalData["result"]>;

function ReadyOwnershipRecommendation({ proposal, result, copy, pending, onApply }: {
  proposal: GoalAssetOwnershipProposalData;
  result: OwnershipResult;
  copy: AssetWorkbenchCopy;
  pending: boolean;
  onApply: () => void;
}) {
  const targetLabel = proposal.targetAsset?.label ?? result.proposedLabel ?? "";
  const decision = result.decision === "append_version"
    ? formatCopy(copy.aiDecisionAppend, { asset: targetLabel })
    : result.decision === "separate_asset" ? copy.aiDecisionSeparate : copy.aiDecisionCreate;
  const certainty = { low: copy.certaintyLow, medium: copy.certaintyMedium, high: copy.certaintyHigh }[result.certainty];
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{decision}</Badge><span className="text-xs text-muted-foreground">{formatCopy(copy.certainty, { certainty })}</span></div>
      <dl className="grid gap-2 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">{copy.rationale}</dt><dd>{result.rationale}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.differenceSummaryLabel}</dt><dd>{result.differenceSummary}</dd></div></dl>
      <div className="grid gap-2 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">{copy.evidence}</p><ul className="list-disc pl-4 text-xs">{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>{result.counterEvidence.length > 0 ? <div><p className="text-xs text-muted-foreground">{copy.counterEvidence}</p><ul className="list-disc pl-4 text-xs">{result.counterEvidence.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}</div>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{formatCopy(copy.aiSource, { provider: proposal.providerType ?? "AI provider", model: proposal.model ? ` · ${proposal.model}` : "" })}</p><Button size="sm" disabled={pending} onClick={onApply}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}{copy.applyAiRecommendation}</Button></div>
    </div>
  );
}

function OwnershipRecommendationStatus({ proposal, result, copy, pending, onApply }: {
  proposal: GoalAssetOwnershipProposalData | null;
  result: OwnershipResult | undefined;
  copy: AssetWorkbenchCopy;
  pending: boolean;
  onApply: () => void;
}) {
  if (proposal?.status === "Generating") return <p className="text-sm text-muted-foreground">{copy.generatingAiRecommendation}</p>;
  if (proposal?.status === "Failed") return <p role="alert" className="text-sm text-destructive">{proposal.generationError ?? copy.aiRecommendationFailed}</p>;
  if (proposal?.status === "Stale") return <p role="alert" className="text-sm text-warning-foreground">{copy.proposalStale}</p>;
  return proposal?.status === "Ready" && result ? <ReadyOwnershipRecommendation proposal={proposal} result={result} copy={copy} pending={pending} onApply={onApply} /> : null;
}

function AssetOwnershipRecommendation({
  proposal,
  copy,
  pending,
  onGenerate,
  onApply,
}: {
  proposal: GoalAssetOwnershipProposalData | null;
  copy: AssetWorkbenchCopy;
  pending: boolean;
  onGenerate: () => void;
  onApply: () => void;
}) {
  const result = proposal?.result;
  return (
    <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-medium">{copy.aiRecommendation}</span>
          {proposal ? <Badge variant="outline">{proposal.status}</Badge> : null}
        </div>
        {!proposal || proposal.status === "Failed" || proposal.status === "Stale" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={onGenerate}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {copy.generateAiRecommendation}
          </Button>
        ) : null}
      </div>
      <OwnershipRecommendationStatus proposal={proposal} result={result ?? undefined} copy={copy} pending={pending} onApply={onApply} />
    </div>
  );
}

type CandidateAction = "create_asset" | "append_version" | "reject";

function candidateActionRequest(
  action: CandidateAction,
  candidate: GoalInboxCandidateData,
  targetAssetId: string,
  selectedTarget: GoalAssetWorkbenchData | undefined,
) {
  if (action === "create_asset") return { action, label: candidate.label };
  if (action === "reject") return { action };
  if (targetAssetId === "new" || !selectedTarget?.versions[0]) return null;
  return { action, targetAssetId, baseVersionId: selectedTarget.versions[0].id, changeSummary: candidate.changeSummary };
}

function CandidateCardContent({ candidate, position, total, assets, copy, proposal, pending, error, targetAssetId, setTargetAssetId, onGenerate, onApply, onResolve }: {
  candidate: GoalInboxCandidateData;
  position: number;
  total: number;
  assets: GoalAssetWorkbenchData[];
  copy: AssetWorkbenchCopy;
  proposal: GoalAssetOwnershipProposalData | null;
  pending: boolean;
  error: string | null;
  targetAssetId: string;
  setTargetAssetId: (id: string) => void;
  onGenerate: () => void;
  onApply: () => void;
  onResolve: (action: CandidateAction) => void;
}) {
  const mainAction = targetAssetId === "new" ? "create_asset" : "append_version";
  const selectedTarget = assets.find((asset) => asset.id === targetAssetId);
  return <CardContent className="space-y-4">
    <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">{copy.sourceTask}</dt><dd className="font-medium">{candidate.sourceTask.title}</dd></div><div><dt className="text-muted-foreground">{copy.changeSummary}</dt><dd className="line-clamp-2">{inboxChangeSummaryLabel(candidate.changeSummary, candidate.label, copy)}</dd></div></dl>
    <CandidatePreview candidate={candidate} copy={copy} />
    <AssetOwnershipRecommendation proposal={proposal} copy={copy} pending={pending} onGenerate={onGenerate} onApply={onApply} />
    <div className="space-y-2 rounded-lg border p-3"><Label htmlFor={`candidate-target-${candidate.id}`}>{copy.assetDestination}</Label><Select value={targetAssetId} onValueChange={setTargetAssetId}><SelectTrigger id={`candidate-target-${candidate.id}`} className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">{copy.createNewAsset}</SelectItem>{assets.filter((asset) => !asset.archivedAt && asset.kind === candidate.kind).map((asset) => <SelectItem key={asset.id} value={asset.id}>{formatCopy(copy.appendToAsset, { asset: asset.label })}</SelectItem>)}</SelectContent></Select>{selectedTarget ? <p className="text-xs leading-5 text-muted-foreground">{formatCopy(copy.updateVersionDescription, { asset: selectedTarget.label, version: selectedTarget.versions[0]?.version ?? 0 })}</p> : <p className="text-xs leading-5 text-muted-foreground">{copy.createAssetDescription}</p>}</div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="sticky bottom-0 z-10 -mx-6 border-t bg-card/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0"><div className="mb-2 flex min-w-0 items-center justify-between gap-2 sm:hidden"><p className="truncate text-sm font-medium">{candidate.label}</p><span className="shrink-0 text-xs text-muted-foreground">{formatCopy(copy.candidateProgress, { current: position, total })}</span></div><div className="flex gap-2"><Button className="min-h-11 flex-1 sm:flex-none" disabled={pending} onClick={() => onResolve(mainAction)}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}{targetAssetId === "new" ? copy.createAsset : copy.appendVersion}</Button><Button className="min-h-11" variant="outline" disabled={pending} onClick={() => onResolve("reject")}>{copy.rejectCandidate}</Button></div></div>
  </CardContent>;
}

function CandidateHeader({ candidate, copy }: { candidate: GoalInboxCandidateData; copy: AssetWorkbenchCopy }) {
  return <CardHeader className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Badge>{kindLabel(candidate.kind, copy)}</Badge><Badge variant="outline">{candidate.proposedTargetAssetId ? copy.ruleBasedMatch : copy.noRuleBasedMatch}</Badge></div><div><CardTitle className="text-base sm:text-lg">{candidate.label}</CardTitle><CardDescription className="mt-1 line-clamp-2">{inboxReasonLabel(candidate.reason, copy)}</CardDescription></div></CardHeader>;
}

// Candidate actions share pending/error/ownership state; splitting this component would obscure the atomic transition.
// eslint-disable-next-line max-lines-per-function
export function InboxCandidate({
  goalId,
  candidate,
  position,
  total,
  workspaceId,
  assets,
  copy,
  onResolved,
}: {
  goalId: string;
  candidate: GoalInboxCandidateData;
  position: number;
  total: number;
  workspaceId: string;
  assets: GoalAssetWorkbenchData[];
  copy: AssetWorkbenchCopy;
  onResolved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proposal = candidate.ownershipProposals?.[0] ?? null;
  useEffect(() => {
    if (proposal?.status !== "Generating") return;
    const timeout = window.setTimeout(onResolved, 1_000);
    return () => window.clearTimeout(timeout);
  }, [onResolved, proposal?.status]);
  const [targetAssetId, setTargetAssetId] = useState(
    candidate.proposedTargetAssetId ?? "new",
  );
  const selectedTarget = assets.find((asset) => asset.id === targetAssetId);
  async function generateOwnership() {
    setPending(true);
    setError(null);
    try {
      await generateGoalAssetOwnership(goalId, candidate.id, {
        workspaceId,
        idempotencyKey: uuidv4(),
      });
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.aiRecommendationFailed);
    } finally {
      setPending(false);
    }
  }

  async function applyOwnership(current: GoalAssetOwnershipProposalData) {
    setPending(true);
    setError(null);
    try {
      await applyGoalAssetOwnership(goalId, candidate.id, current.id, {
        workspaceId,
        idempotencyKey: uuidv4(),
        action: "apply_suggestion",
      });
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.candidateUpdateFailed);
    } finally {
      setPending(false);
    }
  }

  async function resolve(action: CandidateAction) {
    setPending(true);
    setError(null);
    try {
      const request = candidateActionRequest(action, candidate, targetAssetId, selectedTarget);
      if (!request) return;
      if (proposal?.status === "Ready") {
        await applyGoalAssetOwnership(goalId, candidate.id, proposal.id, {
          workspaceId,
          idempotencyKey: uuidv4(),
          ...request,
        });
      } else {
        await resolveGoalInboxCandidate(goalId, candidate.id, { workspaceId, ...request });
      }
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.candidateUpdateFailed);
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CandidateHeader candidate={candidate} copy={copy} />
      <CandidateCardContent
        candidate={candidate}
        position={position}
        total={total}
        assets={assets}
        copy={copy}
        proposal={proposal}
        pending={pending}
        error={error}
        targetAssetId={targetAssetId}
        setTargetAssetId={setTargetAssetId}
        onGenerate={() => void generateOwnership()}
        onApply={() => proposal && void applyOwnership(proposal)}
        onResolve={(action) => void resolve(action)}
      />
    </Card>
  );
}
