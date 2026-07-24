"use client";
/* eslint-disable max-lines */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRevalidator, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clipboard,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  History,
  ListChecks,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
  Target,
  UserRound,
} from "lucide-react";
import { localizeHref, useLocale } from "@chrona/i18n";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Label,
  PageFrame,
  PageHeader,
  MarkdownContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@shared/ui";
import {
  applyGoalReviewProposal,
  confirmGoalCriterion,
  createGoalTask,
  generateGoalReview,
  rejectGoalReviewProposal,
  reviewGoalCriterion,
  runGoalAction,
  updateGoal,
  updateGoalBrief,
} from "../browser-api";
import type {
  GoalArtifactData,
  GoalCopy,
  GoalData,
  GoalTaskData,
  GoalTaskGroup,
} from "../model/goal-types";
import { LocalizedLink } from "./localized-link";

function format(copy: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    copy,
  );
}

function formatDate(value: string | null, locale: "en" | "zh") {
  if (!value) return null;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function artifactTypeLabel(type: string) {
  return type.replaceAll("_", " ");
}

// Rendering operation availability together keeps each Artifact action aligned with the server read model.
// eslint-disable-next-line complexity
function ArtifactActions({
  artifact,
  goalId,
  goalAssetId,
  copy,
  showPreview = true,
  copyLabel,
}: {
  artifact: GoalArtifactData;
  goalId: string;
  goalAssetId?: string;
  copy: GoalCopy;
  showPreview?: boolean;
  copyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = artifact.contentPreview?.trim() ?? "";

  return (
    <div className="space-y-3" data-artifact-id={artifact.id}>
      {showPreview ? (
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{artifact.title}</p>
            <Badge variant="outline" className="capitalize">
              {artifactTypeLabel(artifact.type)}
            </Badge>
          </div>
          {preview ? (
            previewOpen ? (
              <MarkdownContent>{preview}</MarkdownContent>
            ) : (
              <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {preview}
              </p>
            )
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {showPreview && preview && artifact.operations.canOpen ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPreviewOpen((value) => !value)}
          >
            {previewOpen ? (
              <ChevronUp className="size-4" />
            ) : (
              <SquareArrowOutUpRight className="size-4" />
            )}
            {previewOpen ? copy.hideDetails : copy.open}
          </Button>
        ) : null}
        {artifact.operations.canCopy ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              const text = preview || artifact.uri;
              void navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              });
            }}
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Clipboard className="size-4" />
            )}
            {copied ? copy.copied : (copyLabel ?? copy.copy)}
          </Button>
        ) : null}
        {artifact.operations.canDownload && artifact.operations.downloadHref ? (
          <Button asChild type="button" size="sm" variant="ghost">
            <a href={artifact.operations.downloadHref} download>
              <Download className="size-4" />
              {copy.download}
            </a>
          </Button>
        ) : null}
        <Button asChild type="button" size="sm" variant="ghost">
          <LocalizedLink
            href={`/goals/${goalId}?section=workbench${goalAssetId ? `&asset=${encodeURIComponent(goalAssetId)}` : ""}`}
          >
            <ExternalLink className="size-4" />
            {copy.showDetails}
          </LocalizedLink>
        </Button>
      </div>
    </div>
  );
}

function confirmationActorLabel(
  actorType: string,
  actorId: string | null,
  copy: GoalCopy,
) {
  if (actorType === "user" && (!actorId || actorId === "server-action"))
    return copy.currentUser;
  return actorId ?? actorType;
}

function findPrimaryResultContext(
  goal: GoalData,
  primary: GoalArtifactData | null,
) {
  if (!primary) return null;
  const result = goal.acceptedResults.find(
    (candidate) =>
      candidate.runId === primary.runId ||
      candidate.artifacts.some((artifact) => artifact.id === primary.id),
  );
  const asset = goal.assets.find(
    (candidate) =>
      candidate.currentArtifact.id === primary.id ||
      candidate.sourceArtifact.id === primary.id,
  );
  return { result, asset };
}

function PrimaryOutcome({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const locale = useLocale();
  const primary = goal.outcome.primaryResult;
  const confirmation = goal.outcome.confirmation;
  const context = findPrimaryResultContext(goal, primary);
  const sourceTask = primary
    ? goal.tasks.find((task) => task.id === primary.taskId)
    : null;
  const summary =
    sourceTask?.description?.trim() ||
    context?.result?.summary
      ?.split("\n")
      .find((line) => line.trim())
      ?.trim();
  const versionLabel = context?.asset?.currentVersion
    ? `v${context.asset.currentVersion}`
    : copy.immutableResult;
  const evidence =
    confirmation?.evidenceArtifactIds
      .map((id) => {
        const asset = goal.assets.find(
          (candidate) =>
            candidate.currentArtifact.id === id ||
            candidate.sourceArtifact.id === id,
        );
        const acceptedArtifact = goal.acceptedResults
          .flatMap((result) => result.artifacts)
          .find((artifact) => artifact.id === id);
        const artifact = asset?.currentArtifact ?? acceptedArtifact;
        return artifact
          ? {
              id,
              title: asset?.label ?? artifact.title,
              type: artifact.type,
              taskTitle: goal.tasks.find((task) => task.id === artifact.taskId)
                ?.title,
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null) ?? [];

  return (
    <article
      className="mx-auto w-full max-w-5xl"
      aria-labelledby="goal-final-outcome"
    >
      <header className="border-b-2 border-success/35 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {copy.verifiedOutcome}
            </p>
            <h2
              id="goal-final-outcome"
              className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              {primary?.title ?? goal.title}
            </h2>
            {summary ? (
              <p className="max-w-3xl text-sm leading-6 text-foreground/75 sm:text-base">
                {summary}
              </p>
            ) : null}
          </div>
          {goal.achievedAt ? (
            <div className="flex shrink-0 items-center gap-2 rounded-full bg-success/[0.08] px-3 py-1.5 text-xs font-medium text-success sm:mt-1">
              <Clock3 className="size-4" aria-hidden />
              <span>
                {copy.achievedAt}: {formatDate(goal.achievedAt, locale)}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid gap-8 py-7 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="min-w-0 space-y-8">
          {confirmation ? (
            <section
              className="border-l-[3px] border-success bg-success/[0.045] px-5 py-4"
              aria-labelledby="goal-achievement-confirmation"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
                  <UserRound className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-success">
                    {copy.confirmedOutcome}
                  </p>
                  <h3
                    id="goal-achievement-confirmation"
                    className="mt-1 font-semibold"
                  >
                    {copy.confirmationNote}
                  </h3>
                  <blockquote className="mt-2 text-sm leading-6 text-foreground/80">
                    {confirmation.note}
                  </blockquote>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {copy.confirmedBy}:{" "}
                    {confirmationActorLabel(
                      confirmation.actorType,
                      confirmation.actorId,
                      copy,
                    )}{" "}
                    · {formatDate(confirmation.confirmedAt, locale)}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="goal-outcome-document">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {copy.retainedDeliverable}
                </p>
                <h3
                  id="goal-outcome-document"
                  className="mt-1 flex items-center gap-2 text-lg font-semibold"
                >
                  <FileText className="size-4 text-success" aria-hidden />
                  {copy.outcomeDocument}
                </h3>
              </div>
              <Badge variant="outline" className="font-mono text-[11px]">
                {versionLabel}
              </Badge>
            </div>
            {primary?.contentPreview ? (
              <MarkdownContent className="max-w-none py-0 text-sm sm:text-base [&_h1:first-child]:sr-only">
                {primary.contentPreview}
              </MarkdownContent>
            ) : (
              <p className="text-sm text-muted-foreground">
                {copy.noPrimaryResult}
              </p>
            )}
          </section>
        </div>

        <aside
          className="space-y-6 lg:sticky lg:top-16"
          aria-label={copy.supportingEvidence}
        >
          <section aria-labelledby="goal-supporting-evidence">
            <div className="flex items-center justify-between border-b pb-2">
              <h3
                id="goal-supporting-evidence"
                className="text-sm font-semibold"
              >
                {copy.supportingEvidence}
              </h3>
              <span className="text-sm font-semibold tabular-nums text-success">
                {confirmation?.evidenceArtifactIds.length ?? 0}
              </span>
            </div>
            {evidence.length ? (
              <ul className="divide-y">
                {evidence.map((item) => (
                  <li key={item.id} className="py-3">
                    <div className="flex items-start gap-2">
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-success"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-5">
                          {item.title}
                        </p>
                        <p className="mt-1 text-xs capitalize text-muted-foreground">
                          {artifactTypeLabel(item.type)}
                          {item.taskTitle ? ` · ${item.taskTitle}` : ""}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-sm leading-6 text-muted-foreground">
                {copy.evidenceCount.replace(
                  "{count}",
                  String(confirmation?.evidenceArtifactIds.length ?? 0),
                )}
              </p>
            )}
          </section>

          {primary ? (
            <section
              className="border-t pt-4"
              aria-labelledby="goal-result-actions"
            >
              <h3 id="goal-result-actions" className="text-sm font-semibold">
                {copy.resultActions}
              </h3>
              <div className="mt-3">
                <ArtifactActions
                  artifact={primary}
                  goalId={goal.id}
                  goalAssetId={context?.asset?.id}
                  copy={copy}
                  showPreview={false}
                  copyLabel={copy.copyDocument}
                />
              </div>
            </section>
          ) : null}

          {primary ? (
            <details className="group border-t pt-4">
              <summary className="cursor-pointer list-none text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-3">
                  {copy.technicalDetails}
                  <ChevronDown
                    className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </span>
              </summary>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {copy.sourceTask}
                  </dt>
                  <dd className="mt-1 font-medium">
                    {sourceTask?.title ?? primary.taskId}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {copy.sourceRun}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs">
                    {primary.runId}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {copy.currentVersion}
                  </dt>
                  <dd className="mt-1 font-medium">{versionLabel}</dd>
                </div>
              </dl>
            </details>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

function ActiveSummary({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const locale = useLocale();
  const stats = [
    {
      label: copy.tasksSection,
      value: `${goal.projection.completedTaskCount}/${goal.projection.totalTaskCount}`,
      detail: copy.completedShort,
    },
    {
      label: copy.successCriteria,
      value: `${goal.projection.criteriaSatisfiedCount}/${goal.projection.criteriaTotalCount}`,
      detail: copy.confirmedShort,
    },
    {
      label: copy.nextReview,
      value: goal.nextReviewAt ? formatDate(goal.nextReviewAt, locale) : "—",
      detail: goal.nextReviewAt ? copy.scheduledShort : copy.noReview,
    },
  ];
  return (
    <div className="grid border-y border-border/80 sm:grid-cols-3">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={`py-4 sm:px-5 ${index > 0 ? "border-t sm:border-l sm:border-t-0" : ""}`}
        >
          <p className="text-xs font-medium text-muted-foreground">
            {stat.label}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {stat.value}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{stat.detail}</p>
        </div>
      ))}
    </div>
  );
}

// The edit/read modes stay together so one card owns its complete product interaction.
// eslint-disable-next-line complexity
function OperationalBriefCard({
  goal,
  copy,
}: {
  goal: GoalData;
  copy: GoalCopy;
}) {
  const revalidator = useRevalidator();
  const brief = goal.workbench.brief;
  const [editing, setEditing] = useState(!brief);
  const [outcome, setOutcome] = useState(
    brief?.outcome ?? goal.description ?? "",
  );
  const [currentFocus, setCurrentFocus] = useState(brief?.currentFocus ?? "");
  const [strategy, setStrategy] = useState(brief?.strategy ?? "");
  const [constraints, setConstraints] = useState(
    brief?.constraints.join("\n") ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!outcome.trim() || !currentFocus.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateGoalBrief(goal.id, {
        outcome: outcome.trim(),
        currentFocus: currentFocus.trim(),
        strategy: strategy.trim(),
        constraints: constraints
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      await revalidator.revalidate();
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="border-l-2 border-info/50 pl-4 sm:pl-5"
      aria-labelledby="goal-operational-brief"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 id="goal-operational-brief" className="font-semibold">
            {copy.operationalBrief}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {copy.briefDescription}
          </p>
        </div>
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {copy.editBrief}
          </Button>
        ) : null}
      </div>
      <div className="space-y-4">
        {editing ? (
          <>
            <Field>
              <FieldLabel htmlFor="goal-brief-outcome">
                {copy.outcomeLabel}
              </FieldLabel>
              <Textarea
                id="goal-brief-outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                rows={2}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="goal-brief-focus">
                {copy.currentFocus}
              </FieldLabel>
              <Input
                id="goal-brief-focus"
                value={currentFocus}
                onChange={(event) => setCurrentFocus(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="goal-brief-strategy">
                {copy.strategy}
              </FieldLabel>
              <Textarea
                id="goal-brief-strategy"
                value={strategy}
                onChange={(event) => setStrategy(event.target.value)}
                rows={3}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="goal-brief-constraints">
                {copy.constraints}
              </FieldLabel>
              <Textarea
                id="goal-brief-constraints"
                value={constraints}
                onChange={(event) => setConstraints(event.target.value)}
                rows={3}
              />
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              {brief ? (
                <Button variant="outline" onClick={() => setEditing(false)}>
                  {copy.cancel}
                </Button>
              ) : null}
              <Button
                disabled={!outcome.trim() || !currentFocus.trim() || saving}
                onClick={() => void save()}
              >
                {saving ? copy.saving : copy.saveBrief}
              </Button>
            </div>
          </>
        ) : brief ? (
          <dl className="space-y-5">
            <div className="rounded-lg bg-info/[0.07] px-4 py-3">
              <dt className="text-xs font-medium text-info">
                {copy.currentFocus}
              </dt>
              <dd className="mt-1.5 font-semibold leading-6">
                {brief.currentFocus}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                {copy.outcomeLabel}
              </dt>
              <dd className="mt-1 text-sm leading-6">{brief.outcome}</dd>
            </div>
            {brief.strategy ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  {copy.strategy}
                </dt>
                <dd className="mt-1 text-sm leading-6">{brief.strategy}</dd>
              </div>
            ) : null}
            {brief.constraints.length ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  {copy.constraints}
                </dt>
                <dd>
                  <ul className="mt-2 space-y-1 text-sm">
                    {brief.constraints.map((constraint) => (
                      <li key={constraint}>• {constraint}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </section>
  );
}


function FocusQueue({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const groups = [
    {
      key: "needsYou",
      title: copy.needsYou,
      tasks: goal.workbench.focus.needsYou,
      tone: "border-warning bg-warning/[0.045]",
      countTone: "text-warning",
    },
    {
      key: "inProgress",
      title: copy.inProgress,
      tasks: goal.workbench.focus.inProgress,
      tone: "border-info/60 bg-info/[0.04]",
      countTone: "text-info",
    },
    {
      key: "newResults",
      title: copy.newResults,
      tasks: goal.workbench.focus.newResults,
      tone: "border-success/60 bg-success/[0.04]",
      countTone: "text-success",
    },
    {
      key: "upNext",
      title: copy.upNext,
      tasks: goal.workbench.focus.upNext,
      tone: "border-border bg-card",
      countTone: "text-foreground",
    },
  ].filter((group) => group.tasks.length > 0);
  if (groups.length === 0)
    return (
      <div className="rounded-xl border border-dashed px-5 py-8 text-center">
        <CheckCircle2 className="mx-auto size-7 text-success" aria-hidden />
        <p className="mt-3 font-medium">{copy.focusClear}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {copy.focusClearDescription}
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section
          key={group.key}
          className={`rounded-xl border-l-[3px] p-4 ${group.tone}`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <span
              className={`text-sm font-semibold tabular-nums ${group.countTone}`}
            >
              {group.tasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {group.tasks.slice(0, 3).map((task) => (
              <TaskRow key={task.id} task={task} copy={copy} goalId={goal.id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CriteriaCard({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const locale = useLocale();
  const revalidator = useRevalidator();
  const [criterionId, setCriterionId] = useState<string | null>(null);
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalDraft, setProposalDraft] = useState<Record<string, string>>(
    {},
  );
  const availableArtifacts = goal.assets.map((asset) => asset.currentArtifact);

  async function submit() {
    if (!criterionId || artifactIds.length === 0 || !note.trim() || pending)
      return;
    setPending(true);
    setError(null);
    try {
      await confirmGoalCriterion(goal.id, criterionId, {
        artifactIds,
        note: note.trim(),
      });
      await revalidator.revalidate();
      setCriterionId(null);
      setArtifactIds([]);
      setNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  async function reviewProposal(criterionId: string, description: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await reviewGoalCriterion(goal.id, criterionId, {
        description: proposalDraft[criterionId]?.trim() || description,
      });
      await revalidator.revalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  const confirmedCount = goal.outcome.criteria.filter(
    (criterion) => criterion.satisfied,
  ).length;
  const totalCount = goal.outcome.criteria.length;
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {copy.successCriteria}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {format(copy.criteriaProgress, {
              completed: confirmedCount,
              total: totalCount,
            })}
          </h2>
        </div>
        {totalCount > 0 ? (
          <div className="w-full sm:w-56">
            <div className="mb-2 flex justify-between text-xs text-muted-foreground">
              <span>{copy.verifiedOutcome}</span>
              <span className="tabular-nums">
                {Math.round((confirmedCount / totalCount) * 100)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-success"
                style={{ width: `${(confirmedCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
      <div className="divide-y rounded-xl border bg-card">
        {goal.outcome.criteria.map((criterion) => (
          <div
            key={criterion.id}
            className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start ${criterion.satisfied ? "border-l-4 border-l-success bg-success/[0.025]" : criterion.proposalStatus === "proposed" ? "border-l-4 border-l-warning bg-warning/[0.025]" : "border-l-4 border-l-muted"}`}
          >
            {criterion.satisfied ? (
              <CheckCircle2
                className="mt-0.5 size-5 shrink-0 text-success"
                aria-hidden
              />
            ) : (
              <CircleDot
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {criterion.proposalStatus === "proposed" ? (
                  <Badge
                    variant="outline"
                    className="border-warning/30 bg-warning/[0.08] text-warning"
                  >
                    {copy.suggestedCriterion}
                  </Badge>
                ) : null}
                {criterion.proposalStatus === "proposed" ? (
                  <Input
                    aria-label={`Review ${criterion.description}`}
                    value={proposalDraft[criterion.id] ?? criterion.description}
                    onChange={(event) =>
                      setProposalDraft((current) => ({
                        ...current,
                        [criterion.id]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <p className="text-sm font-medium leading-5">
                    {criterion.description}
                  </p>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {criterion.confirmedAt ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-success" />
                    {formatDate(criterion.confirmedAt, locale)}
                  </span>
                ) : null}
                {(criterion.evidenceArtifactIds?.length ?? 0) > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="size-3.5" />
                    {copy.evidenceCount.replace(
                      "{count}",
                      String(criterion.evidenceArtifactIds?.length ?? 0),
                    )}
                  </span>
                ) : null}
              </div>
            </div>
            {criterion.proposalStatus === "proposed" &&
            goal.status === "Active" ? (
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  void reviewProposal(criterion.id, criterion.description)
                }
              >
                Confirm criterion
              </Button>
            ) : null}
            {criterion.proposalStatus !== "proposed" &&
            !criterion.satisfied &&
            goal.status === "Active" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={availableArtifacts.length === 0}
                onClick={() => {
                  setCriterionId(criterion.id);
                  setArtifactIds([]);
                }}
              >
                {copy.confirmCriterion}
              </Button>
            ) : null}
          </div>
        ))}
        <Dialog
          open={criterionId !== null}
          onOpenChange={(open) => {
            if (!open) setCriterionId(null);
          }}
        >
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{copy.confirmCriterion}</DialogTitle>
              <DialogDescription>
                {copy.confirmCriterionDescription}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                {availableArtifacts.map((artifact) => (
                  <Label
                    key={artifact.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      checked={artifactIds.includes(artifact.id)}
                      onCheckedChange={(checked) =>
                        setArtifactIds((current) =>
                          checked
                            ? [...current, artifact.id]
                            : current.filter((id) => id !== artifact.id),
                        )
                      }
                    />
                    <span>{artifact.title}</span>
                  </Label>
                ))}
              </div>
              <Field>
                <FieldLabel htmlFor="criterion-evidence-note">
                  {copy.criterionEvidenceNote}
                </FieldLabel>
                <Textarea
                  id="criterion-evidence-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCriterionId(null)}>
                {copy.cancel}
              </Button>
              <Button
                disabled={artifactIds.length === 0 || !note.trim() || pending}
                onClick={() => void submit()}
              >
                {pending ? copy.saving : copy.confirmCriterion}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}

function TaskRow({
  task,
  copy,
  goalId,
}: {
  task: GoalTaskData;
  copy: GoalCopy;
  goalId: string;
}) {
  const locale = useLocale();
  const tone =
    task.group === "attention"
      ? "border-l-warning bg-warning/[0.025]"
      : task.group === "active"
        ? "border-l-info bg-info/[0.025]"
        : task.group === "completed"
          ? "border-l-success bg-success/[0.025]"
          : "border-l-muted";
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 border-l-4 py-3 pl-4 pr-2 sm:flex-row sm:items-center sm:justify-between ${tone}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{task.title}</p>
          <Badge
            variant={
              task.group === "attention"
                ? "destructive"
                : task.group === "completed"
                  ? "secondary"
                  : "outline"
            }
          >
            {copy.taskStatus[task.status] ?? task.status}
          </Badge>
          {task.attention ? (
            <Badge variant="destructive">{task.attention}</Badge>
          ) : null}
        </div>
        {task.description ? (
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {task.description}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {formatDate(task.updatedAt, locale)}
        </p>
      </div>
      <Button
        asChild
        size="sm"
        variant={task.group === "attention" ? "default" : "outline"}
      >
        <LocalizedLink href={`/goals/${goalId}/workbench/tasks/${task.id}`}>
          {copy.openTask}
          <ExternalLink className="size-4" />
        </LocalizedLink>
      </Button>
    </div>
  );
}
function TaskGroupSection({
  group,
  tasks,
  copy,
  defaultOpen,
  goalId,
}: {
  group: GoalTaskGroup;
  tasks: GoalTaskData[];
  copy: GoalCopy;
  defaultOpen: boolean;
  goalId: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (tasks.length === 0) return null;
  return (
    <section className="space-y-3">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg py-1 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-semibold">
          {copy.taskGroups[group]}
          <Badge variant="secondary">{tasks.length}</Badge>
        </span>
        {open ? (
          <ChevronUp className="size-4" />
        ) : (
          <ChevronDown className="size-4" />
        )}
      </button>
      {open ? (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} copy={copy} goalId={goalId} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CreateTaskDialog({
  goal,
  copy,
  kind,
  open,
  onOpenChange,
}: {
  goal: GoalData;
  copy: GoalCopy;
  kind: "task" | "review";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const locale = useLocale();
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [title, setTitle] = useState(
    kind === "review" ? copy.reviewTaskTitle : "",
  );
  const [description, setDescription] = useState(
    kind === "review" ? copy.reviewTaskDescription : "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await createGoalTask(goal.id, {
        kind,
        title: title.trim(),
        description: description.trim() || null,
        priority: "High",
        expectedOutcome: expectedOutcome.trim() || undefined,
        autoPlanGeneration: false,
      });
      await revalidator.revalidate();
      onOpenChange(false);
      void navigate(
        localizeHref(
          locale,
          `/goals/${goal.id}/workbench/tasks/${result.taskId}`,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === "review" ? copy.startReview : copy.addTaskTitle}
          </DialogTitle>
          <DialogDescription>
            {kind === "review"
              ? copy.reviewTaskDescription
              : copy.workspaceDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor={`goal-${kind}-title`}>
              {copy.taskTitleLabel}
            </FieldLabel>
            <Input
              id={`goal-${kind}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy.taskTitlePlaceholder}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`goal-${kind}-description`}>
              {copy.taskDescriptionLabel}
            </FieldLabel>
            <Textarea
              id={`goal-${kind}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={copy.taskDescriptionPlaceholder}
              rows={5}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`goal-${kind}-outcome`}>
              {copy.expectedOutcome}
            </FieldLabel>
            <Input
              id={`goal-${kind}-outcome`}
              value={expectedOutcome}
              onChange={(event) => setExpectedOutcome(event.target.value)}
              placeholder={copy.expectedOutcomePlaceholder}
            />
          </Field>
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {copy.actionPreview}
            </p>
            <p className="mt-2 text-sm leading-6">
              {copy.createBoundedTaskPreview}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {copy.cancel}
          </Button>
          <Button
            type="button"
            disabled={!title.trim() || pending}
            onClick={() => void submit()}
          >
            {pending ? copy.creatingTask : copy.createTask}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoalHistory({
  goal,
  copy,
  isArchive,
}: {
  goal: GoalData;
  copy: GoalCopy;
  isArchive: boolean;
}) {
  const locale = useLocale();
  return (
    <section className="space-y-5">
      <div className="border-b pb-5">
        <p className="text-sm font-medium text-muted-foreground">
          {copy.history}
        </p>
        <h2 className="mt-1 max-w-3xl text-2xl font-semibold tracking-tight">
          {isArchive ? copy.archiveDescription : copy.workspaceDescription}
        </h2>
      </div>
      <ol className="relative ml-1 max-w-4xl space-y-0 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">
        {goal.activity.map((item) => {
          const isAchievement = item.type === "goal_achieved";
          const isResult = item.type === "result_accepted";
          return (
            <li key={item.id} className="relative flex gap-4 pb-7 last:pb-0">
              <span
                className={`relative z-10 mt-1.5 size-[15px] shrink-0 rounded-full border-[3px] border-background ${isAchievement ? "bg-success" : isResult ? "bg-info" : "bg-muted-foreground/50"}`}
              />
              <article
                className={`min-w-0 flex-1 ${isAchievement ? "-mt-2 rounded-xl border border-success/20 bg-success/[0.035] p-4" : "pb-1"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <Badge
                      variant="outline"
                      className={`mt-1.5 text-[10px] uppercase tracking-wide ${isAchievement ? "border-success/25 text-success" : isResult ? "border-info/25 text-info" : "text-muted-foreground"}`}
                    >
                      {item.type.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {formatDate(item.occurredAt, locale)}
                  </time>
                </div>
                {item.detail ? (
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.detail}
                  </p>
                ) : null}
                {item.taskId ? (
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="mt-1 h-auto px-0"
                  >
                    <LocalizedLink
                      href={`/goals/${goal.id}/workbench/tasks/${item.taskId}`}
                    >
                      {copy.openTask}
                    </LocalizedLink>
                  </Button>
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ReviewApplyDialog({
  goal,
  copy,
  open,
  onOpenChange,
}: {
  goal: GoalData;
  copy: GoalCopy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revalidator = useRevalidator();
  const proposal = goal.reviewProposals.find((candidate) =>
    candidate.status === "Generating" || candidate.status === "Ready" || candidate.status === "PartiallyApplied"
  ) ?? goal.reviewProposals[0] ?? null;
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!proposal || proposal.status !== "Ready") return;
    setSelected(Object.fromEntries(proposal.items.filter((item) => item.decision === "Pending").map((item) => [item.itemId, true])));
  }, [proposal?.id, proposal?.status]);

  useEffect(() => {
    if (!open || proposal?.status !== "Generating") return;
    const timer = window.setInterval(() => void revalidator.revalidate(), 2_000);
    return () => window.clearInterval(timer);
  }, [open, proposal?.status, revalidator]);

  async function generate() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await generateGoalReview(goal.id, { idempotencyKey: crypto.randomUUID() });
      await revalidator.revalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  async function apply() {
    if (!proposal || pending) return;
    const decisions = proposal.items
      .filter((item) => item.decision === "Pending")
      .map((item) => ({
        itemId: item.itemId,
        action: selected[item.itemId]
          ? item.kind === "evidence_gap" ? "convert_to_task" as const : "accept" as const
          : item.kind === "evidence_gap" ? "ignore" as const : "reject" as const,
      }));
    if (decisions.length === 0) return;
    setPending(true);
    setError(null);
    try {
      await applyGoalReviewProposal(goal.id, proposal.id, { idempotencyKey: crypto.randomUUID(), decisions });
      await revalidator.revalidate();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
      await revalidator.revalidate();
    } finally {
      setPending(false);
    }
  }

  async function reject() {
    if (!proposal || pending) return;
    setPending(true);
    setError(null);
    try {
      await rejectGoalReviewProposal(goal.id, proposal.id, { idempotencyKey: crypto.randomUUID() });
      await revalidator.revalidate();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  const itemLabel = (item: NonNullable<typeof proposal>["items"][number]) => {
    const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
      ? item.payload as Record<string, unknown>
      : {};
    if (item.kind === "brief_field") return `${copy.operationalBrief}: ${String(payload.field ?? "")}`;
    if (item.kind === "next_review_at") return copy.nextReview;
    if (item.kind === "task_candidate") return String(payload.title ?? copy.reviewTaskSuggestion);
    return String(payload.title ?? copy.successCriteria);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{copy.applyReview}</DialogTitle>
          <DialogDescription>{copy.applyReviewDescription}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-2 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-3">
            <span>{goal.outcome.criteria.filter((criterion) => criterion.satisfied).length}/{goal.outcome.criteria.length} {copy.successCriteria}</span>
            <span>{goal.workbench.focus.newResults.length} {copy.newResults}</span>
            <span>{goal.acceptedResults.length} {copy.acceptedResults}</span>
          </div>
          {!proposal ? (
            <Card>
              <CardContent className="space-y-3 p-5">
                <p className="font-medium">{copy.reviewSummary}</p>
                <p className="text-sm text-muted-foreground">{copy.applyReviewDescription}</p>
                <Button disabled={pending} onClick={() => void generate()}>
                  <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
                  {pending ? copy.generatingReview : copy.generateReview}
                </Button>
              </CardContent>
            </Card>
          ) : proposal.status === "Generating" ? (
            <Card>
              <CardContent className="flex items-center gap-3 p-5 text-sm">
                <RefreshCw className="size-4 animate-spin" />
                <div>
                  <p className="font-medium">{copy.generatingReview}</p>
                  <p className="text-muted-foreground">{copy.proposalSource} · {proposal.sourceTask.title}</p>
                </div>
              </CardContent>
            </Card>
          ) : proposal.status === "Failed" ? (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">{copy.proposalFailed}</p>
              <p className="mt-1 text-muted-foreground">{proposal.generationError}</p>
              <Button className="mt-3" variant="outline" disabled={pending} onClick={() => void generate()}>
                {copy.generateReview}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {proposal.summary ? <p className="text-sm text-muted-foreground">{proposal.summary}</p> : null}
              {proposal.items.map((item) => {
                const pendingItem = item.decision === "Pending";
                const checked = Boolean(selected[item.itemId]);
                return (
                  <label key={item.id} className="flex gap-3 rounded-xl border p-4">
                    <Checkbox
                      checked={checked}
                      disabled={!pendingItem}
                      onCheckedChange={(value) => setSelected((current) => ({ ...current, [item.itemId]: value === true }))}
                      aria-label={itemLabel(item)}
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {itemLabel(item)}
                        <Badge variant="outline">{item.decision}</Badge>
                      </span>
                      <span className="block text-sm text-muted-foreground">{item.rationale}</span>
                      {item.decisionReason ? <span className="block text-sm text-destructive">{item.decisionReason}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          {proposal?.status === "Ready" || proposal?.status === "PartiallyApplied" ? (
            <>
              <Button variant="outline" disabled={pending} onClick={() => void reject()}>{copy.rejectProposal}</Button>
              <Button disabled={pending || proposal.items.every((item) => item.decision !== "Pending")} onClick={() => void apply()}>
                {pending ? copy.saving : copy.applyReview}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Achievement intentionally presents criteria, evidence, and confirmation in one auditable interaction.
// eslint-disable-next-line max-lines-per-function
function AchievementDialog({
  goal,
  copy,
  open,
  onOpenChange,
}: {
  goal: GoalData;
  copy: GoalCopy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revalidator = useRevalidator();
  const [confirmation, setConfirmation] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const artifacts = useMemo(() => {
    const seen = new Set<string>();
    return goal.assets
      .flatMap((asset) => [asset.currentArtifact])
      .filter((artifact) => {
        if (seen.has(artifact.id)) return false;
        seen.add(artifact.id);
        return true;
      });
  }, [goal.assets]);

  async function submit() {
    if (!confirmation.trim() || evidenceIds.length === 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      await runGoalAction(goal.id, {
        action: "achieve",
        confirmation: confirmation.trim(),
        evidenceArtifactIds: evidenceIds,
      });
      await revalidator.revalidate();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.confirmAchievement}</DialogTitle>
          <DialogDescription>
            {copy.confirmAchievementDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">{copy.successCriteria}</p>
            {goal.outcome.criteria.map((criterion) => (
              <div
                key={criterion.id}
                className="flex gap-2 rounded-lg border p-3 text-sm"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                {criterion.description}
              </div>
            ))}
          </div>
          <Field>
            <FieldLabel>{copy.evidenceLabel}</FieldLabel>
            <FieldDescription>{copy.evidenceDescription}</FieldDescription>
            <div className="space-y-2">
              {artifacts.map((artifact) => (
                <Label
                  key={artifact.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                >
                  <Checkbox
                    checked={evidenceIds.includes(artifact.id)}
                    onCheckedChange={(checked) => {
                      setEvidenceIds((current) =>
                        checked
                          ? [...current, artifact.id]
                          : current.filter((id) => id !== artifact.id),
                      );
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {artifact.title}
                    </span>
                    {artifact.contentPreview ? (
                      <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                        {artifact.contentPreview}
                      </span>
                    ) : null}
                  </span>
                </Label>
              ))}
            </div>
            {evidenceIds.length === 0 ? (
              <FieldDescription className="text-destructive">
                {copy.evidenceRequired}
              </FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="goal-achievement-confirmation">
              {copy.confirmationLabel}
            </FieldLabel>
            <Textarea
              id="goal-achievement-confirmation"
              aria-label={copy.confirmationLabel}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={copy.confirmationPlaceholder}
              rows={5}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {copy.cancel}
          </Button>
          <Button
            type="button"
            disabled={
              !confirmation.trim() || evidenceIds.length === 0 || pending
            }
            onClick={() => void submit()}
          >
            {pending ? copy.confirming : copy.achieve}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrimaryAction({
  goal,
  copy,
  onStartReview,
  onAddTask,
  onAchieve,
}: {
  goal: GoalData;
  copy: GoalCopy;
  onStartReview: () => void;
  onAddTask: () => void;
  onAchieve: () => void;
}) {
  const revalidator = useRevalidator();
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const locale = useLocale();

  async function runLifecycle(action: "pause" | "resume" | "stop") {
    setPending(true);
    try {
      await runGoalAction(goal.id, { action });
      await revalidator.revalidate();
    } finally {
      setPending(false);
    }
  }

  const action = goal.primaryAction.kind;
  const button = (() => {
    if (action === "resolve_attention" && goal.primaryAction.taskId) {
      return (
        <Button
          onClick={() =>
            void navigate(
              localizeHref(
                locale,
                `/goals/${goal.id}/workbench/tasks/${goal.primaryAction.taskId}`,
              ),
            )
          }
        >
          <AlertTriangle className="size-4" />
          {copy.nextAction.resolve_attention}
        </Button>
      );
    }
    if (action === "continue_work" && goal.primaryAction.taskId) {
      return (
        <Button
          onClick={() =>
            void navigate(
              localizeHref(
                locale,
                `/goals/${goal.id}/workbench/tasks/${goal.primaryAction.taskId}`,
              ),
            )
          }
        >
          <Play className="size-4" />
          {copy.nextAction.continue_work}
        </Button>
      );
    }
    if (action === "resume") {
      return (
        <Button disabled={pending} onClick={() => void runLifecycle("resume")}>
          <Play className="size-4" />
          {copy.resume}
        </Button>
      );
    }
    if (action === "review_criteria") {
      return (
        <Button
          onClick={() =>
            void navigate(
              `${localizeHref(locale, `/goals/${goal.id}`)}?section=criteria`,
            )
          }
        >
          <CheckCircle2 className="size-4" />
          {copy.nextAction.review_criteria}
        </Button>
      );
    }
    if (action === "review") {
      return (
        <Button onClick={onStartReview}>
          <RefreshCw className="size-4" />
          {copy.startReview}
        </Button>
      );
    }
    if (
      action === "confirm_outcome" &&
      goal.outcome.criteria.length > 0 &&
      goal.outcome.criteria.every((criterion) => criterion.satisfied)
    ) {
      return (
        <Button onClick={onAchieve}>
          <CheckCircle2 className="size-4" />
          {copy.achieve}
        </Button>
      );
    }
    return (
      <Button onClick={onAddTask}>
        <Plus className="size-4" />
        {copy.addTask}
      </Button>
    );
  })();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {goal.status !== "Achieved" && goal.status !== "Stopped" ? button : null}
      {goal.status === "Active" ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Goal actions"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onStartReview}>
              <RefreshCw className="size-4" />
              {copy.startReview}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAddTask}>
              <Plus className="size-4" />
              {copy.addTask}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void runLifecycle("pause")}>
              <Pause className="size-4" />
              {copy.pause}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void runLifecycle("stop")}
            >
              {copy.stop}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
type GoalWorkspaceSection =
  "overview" | "work" | "workbench" | "criteria" | "history";

function GoalSectionNavigation({
  section,
  copy,
}: {
  section: GoalWorkspaceSection;
  copy: GoalCopy;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ start: false, end: false });
  const updateScrollEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {
      start: scroller.scrollLeft > 1,
      end:
        scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
    };
    setScrollEdges((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const activeTab = scroller.querySelector<HTMLElement>(
      '[role="tab"][data-state="active"]',
    );
    activeTab?.scrollIntoView?.({ block: "nearest", inline: "center" });
    updateScrollEdges();
    window.addEventListener("resize", updateScrollEdges);
    return () => window.removeEventListener("resize", updateScrollEdges);
  }, [section, updateScrollEdges]);

  const sections = [
    { value: "overview", label: copy.overview, Icon: Target },
    { value: "work", label: copy.tasksSection, Icon: ListChecks },
    { value: "workbench", label: copy.workbench, Icon: FileCheck2 },
    { value: "criteria", label: copy.successCriteria, Icon: CheckCircle2 },
    { value: "history", label: copy.history, Icon: History },
  ] as const;

  return (
    <nav
      aria-label={copy.controlPlane}
      className="shrink-0 border-b border-border/60 bg-background pb-3"
    >
      <div className="relative">
        {scrollEdges.start ? (
          <span
            className="pointer-events-none absolute inset-y-px left-px z-10 w-8 rounded-l-xl bg-gradient-to-r from-muted via-muted/85 to-transparent sm:hidden"
            aria-hidden
          />
        ) : null}
        {scrollEdges.end ? (
          <span
            className="pointer-events-none absolute inset-y-px right-px z-10 w-8 rounded-r-xl bg-gradient-to-l from-muted via-muted/85 to-transparent sm:hidden"
            aria-hidden
          />
        ) : null}
        <div
          ref={scrollerRef}
          className="no-scrollbar overflow-x-auto rounded-xl border border-border/70 bg-muted/45 p-1 shadow-xs"
          onScroll={updateScrollEdges}
        >
          <TabsList className="h-auto min-w-max justify-start gap-1 rounded-none bg-transparent p-0">
            {sections.map(({ value, label, Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-10 flex-none rounded-lg border-transparent px-3 text-sm text-muted-foreground shadow-none hover:bg-background/70 hover:text-foreground data-[state=active]:border-border/70 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs data-[state=active]:[&_svg]:text-primary sm:px-4"
              >
                <Icon className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>
    </nav>
  );
}

// The workspace composes the four lifecycle sections at the route boundary.
// eslint-disable-next-line max-lines-per-function, complexity
export function GoalWorkspacePage({
  goal,
  copy,
  assetWorkbench,
}: {
  goal: GoalData;
  copy: GoalCopy;
  assetWorkbench?: React.ReactNode;
}) {
  const [taskDialog, setTaskDialog] = useState<"task" | null>(null);
  const [renameTitle, setRenameTitle] = useState(goal.title);
  const [renamePending, setRenamePending] = useState(false);
  const revalidator = useRevalidator();
  async function renameGoal() {
    if (!renameTitle.trim() || renamePending) return;
    setRenamePending(true);
    try {
      await updateGoal(goal.id, { title: renameTitle.trim() });
      await revalidator.revalidate();
    } finally {
      setRenamePending(false);
    }
  }
  const [reviewOpen, setReviewOpen] = useState(false);
  const [achievementOpen, setAchievementOpen] = useState(false);
  const isArchive = goal.mode === "archive";
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const defaultSection =
    requestedSection === "work" ||
    requestedSection === "workbench" ||
    requestedSection === "criteria" ||
    requestedSection === "history"
      ? requestedSection
      : "overview";
  const contentScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
  }, [defaultSection]);
  return (
    <PageFrame mode="focused" data-domain={defaultSection === "workbench" ? "workbench" : "goals"} className="overflow-y-hidden p-1 sm:p-2">
      <div
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-hidden"
        data-ui-surface-kind="product-authored"
      >
        <PageHeader
          eyebrow={
            <Button asChild variant="ghost" size="sm" className="w-fit -ml-2">
              <LocalizedLink href="/goals">
                <ArrowLeft className="size-4" />
                {copy.backToGoals}
              </LocalizedLink>
            </Button>
          }
          title={goal.title}
          description={
            goal.description?.trim() && goal.description.trim() !== goal.title.trim()
              ? goal.description
              : undefined
          }
          meta={
            <>
              <span
                className={`inline-flex items-center gap-1.5 text-sm font-medium ${isArchive ? "text-success" : "text-info"}`}
              >
                {isArchive ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <Target className="size-4" />
                )}
                {copy.status[goal.status]}
              </span>
              <span className="text-sm text-muted-foreground">
                {isArchive ? copy.outcomeArchive : copy.ongoingWorkspace}
              </span>
              {goal.projection.attention !== "none" ? (
                <Badge variant="destructive">
                  {copy.attention[goal.projection.attention]}
                </Badge>
              ) : null}
              {goal.workbench.pendingInboxCount > 0 ? (
                <Button asChild size="sm" variant="outline">
                  <LocalizedLink
                    href={`/goals/${goal.id}?section=workbench&assetView=inbox`}
                  >
                    {copy.pendingInbox.replace(
                      "{count}",
                      String(goal.workbench.pendingInboxCount),
                    )}
                  </LocalizedLink>
                </Button>
              ) : null}
            </>
          }
          actions={
            <PrimaryAction
              goal={goal}
              copy={copy}
              onStartReview={() => setReviewOpen(true)}
              onAddTask={() => setTaskDialog("task")}
              onAchieve={() => setAchievementOpen(true)}
            />
          }
        />
        {(goal.titleSource === "system" || goal.titleSource === "ai") &&
        !goal.titleRenameNoticeSeenAt ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{copy.suggestedGoalName}</p>
                <p className="text-sm text-muted-foreground">
                  {copy.suggestedGoalNameDescription}
                </p>
              </div>
              <Input
                aria-label={copy.renameSuggestedGoal}
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                className="sm:max-w-sm"
              />
              <Button
                disabled={!renameTitle.trim() || renamePending}
                onClick={() => void renameGoal()}
              >
                {copy.renameGoal}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Tabs
          value={defaultSection}
          onValueChange={(section) => {
            const next = new URLSearchParams(searchParams);
            if (section === "overview") next.delete("section");
            else next.set("section", section);
            setSearchParams(next, { replace: true });
          }}
          className="min-h-0 min-w-0 flex-1 gap-0"
        >
          <GoalSectionNavigation section={defaultSection} copy={copy} />

          <div
            ref={contentScrollRef}
            data-goal-section-scroll
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-8"
          >
            <TabsContent value="overview" className="mt-5">
              {isArchive ? (
                <PrimaryOutcome goal={goal} copy={copy} />
              ) : (
                <div className="space-y-8">
                  <section
                    aria-labelledby="goal-control-plane"
                    className="space-y-4"
                  >
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold text-info">
                          {copy.ongoingWorkspace}
                        </p>
                        <h2
                          id="goal-control-plane"
                          className="mt-1 text-2xl font-semibold tracking-tight"
                        >
                          {copy.currentFocus}
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                          {copy.currentFocusDescription}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
                      <FocusQueue goal={goal} copy={copy} />
                      <OperationalBriefCard goal={goal} copy={copy} />
                    </div>
                  </section>
                  <ActiveSummary goal={goal} copy={copy} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="work" className="mt-5">
              <section className="space-y-6">
                <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {copy.boundedTasks}
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                      {format(copy.taskProgress, {
                        completed: goal.projection.completedTaskCount,
                        total: goal.projection.totalTaskCount,
                      })}
                    </h2>
                  </div>
                  {goal.status === "Active" ? (
                    <Button size="sm" onClick={() => setTaskDialog("task")}>
                      <Plus className="size-4" />
                      {copy.addTask}
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-7">
                  {goal.tasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {copy.noTasks}
                    </div>
                  ) : null}
                  <TaskGroupSection
                    group="attention"
                    tasks={goal.taskGroups.attention}
                    copy={copy}
                    defaultOpen
                    goalId={goal.id}
                  />
                  <TaskGroupSection
                    group="active"
                    tasks={goal.taskGroups.active}
                    copy={copy}
                    defaultOpen
                    goalId={goal.id}
                  />
                  <TaskGroupSection
                    group="planned"
                    tasks={goal.taskGroups.planned}
                    copy={copy}
                    defaultOpen
                    goalId={goal.id}
                  />
                  <TaskGroupSection
                    group="completed"
                    tasks={goal.taskGroups.completed}
                    copy={copy}
                    defaultOpen={!isArchive}
                    goalId={goal.id}
                  />
                </div>
              </section>
            </TabsContent>
            <TabsContent value="workbench" className="mt-5">
              {assetWorkbench ?? (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {copy.noAssets}
                </div>
              )}
            </TabsContent>
            <TabsContent value="criteria" className="mt-5">
              <CriteriaCard goal={goal} copy={copy} />
            </TabsContent>
            <TabsContent value="history" className="mt-5">
              <GoalHistory goal={goal} copy={copy} isArchive={isArchive} />
            </TabsContent>
          </div>
        </Tabs>
        <CreateTaskDialog
          goal={goal}
          copy={copy}
          kind="task"
          open={taskDialog !== null}
          onOpenChange={(open) => {
            if (!open) setTaskDialog(null);
          }}
        />
        <ReviewApplyDialog
          goal={goal}
          copy={copy}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
        />
        <AchievementDialog
          goal={goal}
          copy={copy}
          open={achievementOpen}
          onOpenChange={setAchievementOpen}
        />
      </div>
    </PageFrame>
  );
}
