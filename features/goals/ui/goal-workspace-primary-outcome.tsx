"use client";

import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  UserRound,
} from "lucide-react";
import { useLocale } from "@chrona/i18n";
import {
  Badge,
  MarkdownContent,
} from "@shared/ui";

import type {
  GoalAcceptedResultData,
  GoalAssetData,
  GoalCopy,
  GoalData,
} from "../model/goal-types";
import { ArtifactActions, artifactTypeLabel, confirmationActorLabel, findPrimaryResultContext, formatDate } from "./goal-workspace-shared";
type GoalLocale = "en" | "zh";
type PrimaryResultContext = {
  result: GoalAcceptedResultData | undefined;
  asset: GoalAssetData | undefined;
};
type OutcomeEvidence = {
  id: string;
  title: string;
  type: string;
  taskTitle: string | undefined;
};

type PrimaryOutcomeView = {
  primary: GoalData["outcome"]["primaryResult"];
  confirmation: GoalData["outcome"]["confirmation"];
  context: PrimaryResultContext | null;
  sourceTask: GoalData["tasks"][number] | undefined;
  summary: string | undefined;
  versionLabel: string;
  evidence: OutcomeEvidence[];
};

function outcomeEvidence(goal: GoalData, confirmation: GoalData["outcome"]["confirmation"]): OutcomeEvidence[] {
  if (!confirmation) return [];
  return confirmation.evidenceArtifactIds.map((id) => {
    const asset = goal.assets.find((candidate) => candidate.currentArtifact.id === id || candidate.sourceArtifact.id === id);
    const acceptedArtifact = goal.acceptedResults.flatMap((result) => result.artifacts).find((artifact) => artifact.id === id);
    const artifact = asset?.currentArtifact ?? acceptedArtifact;
    return artifact ? {
      id,
      title: asset?.label ?? artifact.title,
      type: artifact.type,
      taskTitle: goal.tasks.find((task) => task.id === artifact.taskId)?.title,
    } : null;
  }).filter((item): item is OutcomeEvidence => item !== null);
}

function primaryOutcomeView(goal: GoalData, copy: GoalCopy): PrimaryOutcomeView {
  const primary = goal.outcome.primaryResult;
  const confirmation = goal.outcome.confirmation;
  const context = findPrimaryResultContext(goal, primary);
  const sourceTask = primary ? goal.tasks.find((task) => task.id === primary.taskId) : undefined;
  const summary = sourceTask?.description?.trim() || context?.result?.summary?.split("\n").find((line) => line.trim())?.trim();
  return {
    primary,
    confirmation,
    context,
    sourceTask,
    summary,
    versionLabel: context?.asset?.currentVersion ? `v${context.asset.currentVersion}` : copy.immutableResult,
    evidence: outcomeEvidence(goal, confirmation),
  };
}

export function PrimaryOutcome({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const locale = useLocale();
  const view = primaryOutcomeView(goal, copy);
  return <article className="w-full" aria-labelledby="goal-final-outcome">
    <OutcomeHeader goal={goal} copy={copy} locale={locale} view={view} />
    <div className="grid gap-8 py-7 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
      <div className="min-w-0 space-y-8">
        {view.confirmation ? <OutcomeConfirmation confirmation={view.confirmation} copy={copy} locale={locale} /> : null}
        <OutcomeDocument primary={view.primary} copy={copy} versionLabel={view.versionLabel} />
      </div>
      <OutcomeSidebar goal={goal} copy={copy} view={view} />
    </div>
  </article>;
}

function OutcomeHeader({ goal, copy, locale, view }: { goal: GoalData; copy: GoalCopy; locale: GoalLocale; view: PrimaryOutcomeView }) {
  return <header className="border-b-2 border-success/35 pb-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-success"><CheckCircle2 className="size-4" aria-hidden />{copy.verifiedOutcome}</p>
        <h2 id="goal-final-outcome" className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{view.primary?.title ?? goal.title}</h2>
        {view.summary ? <p className="max-w-3xl text-sm leading-6 text-foreground/75 sm:text-base">{view.summary}</p> : null}
      </div>
      {goal.achievedAt ? <div className="flex shrink-0 items-center gap-2 rounded-full bg-success/[0.08] px-3 py-1.5 text-xs font-medium text-success sm:mt-1"><Clock3 className="size-4" aria-hidden /><span>{copy.achievedAt}: {formatDate(goal.achievedAt, locale)}</span></div> : null}
    </div>
  </header>;
}

function OutcomeConfirmation({ confirmation, copy, locale }: { confirmation: NonNullable<GoalData["outcome"]["confirmation"]>; copy: GoalCopy; locale: GoalLocale }) {
  return <section className="border-l-[3px] border-success bg-success/[0.045] px-5 py-4" aria-labelledby="goal-achievement-confirmation">
    <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"><UserRound className="size-4" aria-hidden /></span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-success">{copy.confirmedOutcome}</p><h3 id="goal-achievement-confirmation" className="mt-1 font-semibold">{copy.confirmationNote}</h3><blockquote className="mt-2 text-sm leading-6 text-foreground/80">{confirmation.note}</blockquote><p className="mt-3 text-xs text-muted-foreground">{copy.confirmedBy}: {confirmationActorLabel(confirmation.actorType, confirmation.actorId, copy)} · {formatDate(confirmation.confirmedAt, locale)}</p></div></div>
  </section>;
}

function OutcomeDocument({ primary, copy, versionLabel }: { primary: GoalData["outcome"]["primaryResult"]; copy: GoalCopy; versionLabel: string }) {
  return <section aria-labelledby="goal-outcome-document"><div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b pb-3"><div><p className="text-xs font-medium text-muted-foreground">{copy.retainedDeliverable}</p><h3 id="goal-outcome-document" className="mt-1 flex items-center gap-2 text-lg font-semibold"><FileText className="size-4 text-success" aria-hidden />{copy.outcomeDocument}</h3></div><Badge variant="outline" className="font-mono text-[11px]">{versionLabel}</Badge></div>{primary?.contentPreview ? <MarkdownContent className="max-w-none py-0 text-sm sm:text-base [&_h1:first-child]:sr-only">{primary.contentPreview}</MarkdownContent> : <p className="text-sm text-muted-foreground">{copy.noPrimaryResult}</p>}</section>;
}

function OutcomeSidebar({ goal, copy, view }: { goal: GoalData; copy: GoalCopy; view: PrimaryOutcomeView }) {
  const { primary, confirmation, context, sourceTask, evidence, versionLabel } = view;
  return <aside className="space-y-6 lg:sticky lg:top-16" aria-label={copy.supportingEvidence}>
    <EvidenceList copy={copy} evidence={evidence} evidenceCount={confirmation?.evidenceArtifactIds.length ?? 0} />
    {primary ? <section className="border-t pt-4" aria-labelledby="goal-result-actions"><h3 id="goal-result-actions" className="text-sm font-semibold">{copy.resultActions}</h3><div className="mt-3"><ArtifactActions artifact={primary} goalId={goal.id} goalAssetId={context?.asset?.id} copy={copy} showPreview={false} copyLabel={copy.copyDocument} /></div></section> : null}
    {primary ? <OutcomeTechnicalDetails copy={copy} primary={primary} sourceTask={sourceTask} versionLabel={versionLabel} /> : null}
  </aside>;
}

function EvidenceList({ copy, evidence, evidenceCount }: { copy: GoalCopy; evidence: OutcomeEvidence[]; evidenceCount: number }) {
  return <section aria-labelledby="goal-supporting-evidence"><div className="flex items-center justify-between border-b pb-2"><h3 id="goal-supporting-evidence" className="text-sm font-semibold">{copy.supportingEvidence}</h3><span className="text-sm font-semibold tabular-nums text-success">{evidenceCount}</span></div>{evidence.length ? <ul className="divide-y">{evidence.map((item) => <li key={item.id} className="py-3"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /><div className="min-w-0"><p className="text-sm font-medium leading-5">{item.title}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{artifactTypeLabel(item.type)}{item.taskTitle ? ` · ${item.taskTitle}` : ""}</p></div></div></li>)}</ul> : <p className="py-3 text-sm leading-6 text-muted-foreground">{copy.evidenceCount.replace("{count}", String(evidenceCount))}</p>}</section>;
}

function OutcomeTechnicalDetails({ copy, primary, sourceTask, versionLabel }: { copy: GoalCopy; primary: NonNullable<GoalData["outcome"]["primaryResult"]>; sourceTask: GoalData["tasks"][number] | undefined; versionLabel: string }) {
  return <details className="group border-t pt-4"><summary className="cursor-pointer list-none text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><span className="flex items-center justify-between gap-3">{copy.technicalDetails}<ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden /></span></summary><dl className="mt-4 space-y-3 text-sm"><OutcomeTechnicalDetail label={copy.sourceTask} value={sourceTask?.title ?? primary.taskId} /><OutcomeTechnicalDetail label={copy.sourceRun} value={primary.runId} mono /><OutcomeTechnicalDetail label={copy.currentVersion} value={versionLabel} /></dl></details>;
}

function OutcomeTechnicalDetail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 font-medium ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</dd></div>;
}

