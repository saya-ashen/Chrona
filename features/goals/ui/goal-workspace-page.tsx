"use client";
/* eslint-disable max-lines */

import { useMemo, useState } from "react";
import { useNavigate, useRevalidator, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clipboard,
  Download,
  ExternalLink,
  FileCheck2,
  History,
  ListChecks,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
  Target,
} from "lucide-react";
import { localizeHref, useLocale } from "@chrona/i18n";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  MarkdownContent,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@shared/ui";
import { applyGoalReview, confirmGoalCriterion, createGoalTask, reviewGoalCriterion, runGoalAction, updateGoal, updateGoalBrief, updateGoalWorkingSet } from "../browser-api";
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
}: {
  artifact: GoalArtifactData;
  goalId: string;
  goalAssetId?: string;
  copy: GoalCopy;
  showPreview?: boolean;
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
            {previewOpen ? <ChevronUp className="size-4" /> : <SquareArrowOutUpRight className="size-4" />}
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
            {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
            {copied ? copy.copied : copy.copy}
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
          <LocalizedLink href={`/goals/${goalId}?section=workbench${goalAssetId ? `&asset=${encodeURIComponent(goalAssetId)}` : ""}`}>
            <ExternalLink className="size-4" />
            {copy.showDetails}
          </LocalizedLink>
        </Button>
      </div>
    </div>
  );
}

function confirmationActorLabel(actorType: string, actorId: string | null, copy: GoalCopy) {
  if (actorType === "user" && (!actorId || actorId === "server-action")) return copy.currentUser;
  return actorId ?? actorType;
}

function findPrimaryResultContext(goal: GoalData, primary: GoalArtifactData | null) {
  if (!primary) return null;
  const result = goal.acceptedResults.find((candidate) =>
    candidate.runId === primary.runId || candidate.artifacts.some((artifact) => artifact.id === primary.id),
  );
  const asset = goal.assets.find((candidate) =>
    candidate.currentArtifact.id === primary.id || candidate.sourceArtifact.id === primary.id,
  );
  return { result, asset };
}

function PrimaryOutcome({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const locale = useLocale();
  const primary = goal.outcome.primaryResult;
  const confirmation = goal.outcome.confirmation;
  const context = findPrimaryResultContext(goal, primary);
  const sourceTask = primary ? goal.tasks.find((task) => task.id === primary.taskId) : null;

  return (
    <Card className="overflow-hidden border-primary/25 shadow-sm">
      <CardHeader className="gap-3 border-b border-primary/10 bg-primary/[0.04] pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="w-fit">
              <FileCheck2 className="size-3.5" />
              {copy.primaryResult}
            </Badge>
            {context?.asset?.currentVersion ? <Badge variant="outline">v{context.asset.currentVersion}</Badge> : null}
          </div>
          {goal.achievedAt ? (
            <span className="text-xs text-muted-foreground">
              {copy.achievedAt}: {formatDate(goal.achievedAt, locale)}
            </span>
          ) : null}
        </div>
        <CardTitle className="text-xl sm:text-2xl">{primary?.title ?? goal.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-5">
        {primary?.contentPreview ? (
          <MarkdownContent className="text-sm sm:text-base">{primary.contentPreview}</MarkdownContent>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.noPrimaryResult}</p>
        )}
        {primary ? (
          <div className="space-y-3 border-t pt-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{copy.sourceTask}</dt>
                <dd className="mt-1 font-medium">{sourceTask?.title ?? primary.taskId}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{copy.sourceRun}</dt>
                <dd className="mt-1 font-mono text-xs">{primary.runId}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{copy.currentVersion}</dt>
                <dd className="mt-1 font-medium">{context?.asset?.currentVersion ? `v${context.asset.currentVersion}` : copy.immutableResult}</dd>
              </div>
            </dl>
            <ArtifactActions
              artifact={primary}
              goalId={goal.id}
              goalAssetId={context?.asset?.id}
              copy={copy}
              showPreview={false}
            />
          </div>
        ) : null}
        {confirmation ? (
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-xs font-semibold text-muted-foreground">{copy.confirmationNote}</p>
            <p className="mt-2 text-sm leading-6">{confirmation.note}</p>
            <Separator className="my-3" />
            <p className="text-xs text-muted-foreground">
              {copy.confirmedBy}: {confirmationActorLabel(confirmation.actorType, confirmation.actorId, copy)} · {formatDate(confirmation.confirmedAt, locale)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {copy.evidenceCount.replace("{count}", String(confirmation.evidenceArtifactIds.length))}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ActiveSummary({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  return (
    <Card className="border-primary/20 bg-primary/[0.04]">
      <CardHeader className="pb-3"><CardTitle className="text-base">{copy.progress}</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-background p-3"><p className="text-xs font-medium text-muted-foreground">{copy.tasksSection}</p><p className="mt-1 font-semibold">{format(copy.taskProgress, { completed: goal.projection.completedTaskCount, total: goal.projection.totalTaskCount })}</p></div>
        <div className="rounded-xl border bg-background p-3"><p className="text-xs font-medium text-muted-foreground">{copy.successCriteria}</p><p className="mt-1 font-semibold">{format(copy.criteriaProgress, { completed: goal.projection.criteriaSatisfiedCount, total: goal.projection.criteriaTotalCount })}</p></div>
        <div className="rounded-xl border bg-background p-3"><p className="text-xs font-medium text-muted-foreground">{copy.nextReview}</p><p className="mt-1 font-semibold">{goal.nextReviewAt ? formatDate(goal.nextReviewAt, useLocale()) : copy.noReview}</p></div>
      </CardContent>
    </Card>
  );
}

// The edit/read modes stay together so one card owns its complete product interaction.
// eslint-disable-next-line complexity
function OperationalBriefCard({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const revalidator = useRevalidator();
  const brief = goal.workbench.brief;
  const [editing, setEditing] = useState(!brief);
  const [outcome, setOutcome] = useState(brief?.outcome ?? goal.description ?? "");
  const [currentFocus, setCurrentFocus] = useState(brief?.currentFocus ?? "");
  const [strategy, setStrategy] = useState(brief?.strategy ?? "");
  const [constraints, setConstraints] = useState(brief?.constraints.join("\n") ?? "");
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
        constraints: constraints.split("\n").map((item) => item.trim()).filter(Boolean),
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
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{copy.operationalBrief}</CardTitle>
          <CardDescription>{copy.workspaceDescription}</CardDescription>
        </div>
        {!editing ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{copy.editBrief}</Button> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <>
            <Field><FieldLabel htmlFor="goal-brief-outcome">{copy.outcomeLabel}</FieldLabel><Textarea id="goal-brief-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} rows={2} /></Field>
            <Field><FieldLabel htmlFor="goal-brief-focus">{copy.currentFocus}</FieldLabel><Input id="goal-brief-focus" value={currentFocus} onChange={(event) => setCurrentFocus(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="goal-brief-strategy">{copy.strategy}</FieldLabel><Textarea id="goal-brief-strategy" value={strategy} onChange={(event) => setStrategy(event.target.value)} rows={3} /></Field>
            <Field><FieldLabel htmlFor="goal-brief-constraints">{copy.constraints}</FieldLabel><Textarea id="goal-brief-constraints" value={constraints} onChange={(event) => setConstraints(event.target.value)} rows={3} /></Field>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              {brief ? <Button variant="outline" onClick={() => setEditing(false)}>{copy.cancel}</Button> : null}
              <Button disabled={!outcome.trim() || !currentFocus.trim() || saving} onClick={() => void save()}>{saving ? copy.saving : copy.saveBrief}</Button>
            </div>
          </>
        ) : brief ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/20 p-4 sm:col-span-2"><p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{copy.currentFocus}</p><p className="mt-2 font-semibold">{brief.currentFocus}</p></div>
            <div><p className="text-xs font-medium text-muted-foreground">{copy.outcomeLabel}</p><p className="mt-1 text-sm leading-6">{brief.outcome}</p></div>
            <div><p className="text-xs font-medium text-muted-foreground">{copy.strategy}</p><p className="mt-1 text-sm leading-6">{brief.strategy}</p></div>
            {brief.constraints.length ? <div className="sm:col-span-2"><p className="text-xs font-medium text-muted-foreground">{copy.constraints}</p><ul className="mt-2 space-y-1 text-sm">{brief.constraints.map((constraint) => <li key={constraint}>• {constraint}</li>)}</ul></div> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function workingSetCandidates(goal: GoalData) {
  return [
    ...goal.assets.map((asset) => ({ key: `goal_asset:${asset.id}`, subjectType: "goal_asset" as const, subjectId: asset.id, label: asset.label })),
    ...goal.acceptedResults.map((result) => ({ key: `accepted_result:${result.runId}`, subjectType: "accepted_result" as const, subjectId: result.runId, label: result.taskTitle })),
    ...goal.outcome.criteria.map((criterion) => ({ key: `criterion:${criterion.id}`, subjectType: "criterion" as const, subjectId: criterion.id, label: criterion.description })),
    ...goal.tasks.map((task) => ({ key: `task:${task.id}`, subjectType: "task" as const, subjectId: task.id, label: task.title })),
  ];
}

function WorkingSetCard({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const revalidator = useRevalidator();
  const candidates = workingSetCandidates(goal);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(() => new Set(goal.workbench.workingSet.map((item) => `${item.subjectType}:${item.subjectId}`)));
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await updateGoalWorkingSet(goal.id, candidates.filter((candidate) => selected.has(candidate.key)).map(({ subjectType, subjectId }) => ({ subjectType, subjectId })));
      await revalidator.revalidate();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div><CardTitle>{copy.workingSet}</CardTitle><CardDescription>{copy.workingSetDescription}</CardDescription></div>
        {!editing ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{copy.editWorkingSet}</Button> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? candidates.map((candidate) => (
          <label key={candidate.key} className="flex items-start gap-3 rounded-xl border p-3 text-sm">
            <Checkbox checked={selected.has(candidate.key)} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(candidate.key); else next.delete(candidate.key); return next; })} />
            <span>{candidate.label}</span>
          </label>
        )) : goal.workbench.workingSet.length ? goal.workbench.workingSet.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-xl border p-3"><Badge variant="outline">{item.subjectType.replaceAll("_", " ")}</Badge><span className="text-sm font-medium">{item.label}</span></div>
        )) : <p className="text-sm leading-6 text-muted-foreground">{copy.noWorkingSet}</p>}
        {editing ? <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(false)}>{copy.cancel}</Button><Button disabled={saving} onClick={() => void save()}>{saving ? copy.saving : copy.saveWorkingSet}</Button></div> : null}
      </CardContent>
    </Card>
  );
}

function FocusQueue({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const groups = [
    { key: "needsYou", title: copy.needsYou, tasks: goal.workbench.focus.needsYou },
    { key: "inProgress", title: copy.inProgress, tasks: goal.workbench.focus.inProgress },
    { key: "newResults", title: copy.newResults, tasks: goal.workbench.focus.newResults },
    { key: "upNext", title: copy.upNext, tasks: goal.workbench.focus.upNext },
  ];
  return <Card><CardHeader><CardTitle>{copy.focusQueue}</CardTitle><CardDescription>{copy.workspaceDescription}</CardDescription></CardHeader><CardContent className="space-y-4">{groups.map((group) => <section key={group.key}><div className="mb-2 flex items-center gap-2"><p className="text-sm font-semibold">{group.title}</p><Badge variant="secondary">{group.tasks.length}</Badge></div>{group.tasks.slice(0, 3).map((task) => <TaskRow key={task.id} task={task} copy={copy} goalId={goal.id} />)}</section>)}</CardContent></Card>;
}

function CriteriaCard({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const locale = useLocale();
  const revalidator = useRevalidator();
  const [criterionId, setCriterionId] = useState<string | null>(null);
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalDraft, setProposalDraft] = useState<Record<string, string>>({});
  const availableArtifacts = goal.assets.map((asset) => asset.currentArtifact);

  async function submit() {
    if (!criterionId || artifactIds.length === 0 || !note.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await confirmGoalCriterion(goal.id, criterionId, { artifactIds, note: note.trim() });
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
      await reviewGoalCriterion(goal.id, criterionId, { description: proposalDraft[criterionId]?.trim() || description });
      await revalidator.revalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{copy.successCriteria}</CardTitle>
        <CardDescription>{format(copy.criteriaProgress, { completed: goal.projection.criteriaSatisfiedCount, total: goal.projection.criteriaTotalCount })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {goal.outcome.criteria.map((criterion) => (
          <div key={criterion.id} className="flex gap-3 rounded-xl border p-3">
            {criterion.satisfied ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden /> : <CircleDot className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {criterion.proposalStatus === "proposed" ? <Badge variant="outline">AI proposed</Badge> : null}
                {criterion.proposalStatus === "proposed" ? <Input aria-label={`Review ${criterion.description}`} value={proposalDraft[criterion.id] ?? criterion.description} onChange={(event) => setProposalDraft((current) => ({ ...current, [criterion.id]: event.target.value }))} /> : <p className="text-sm font-medium leading-5">{criterion.description}</p>}
              </div>
              {criterion.confirmedAt ? <p className="mt-1 text-xs text-muted-foreground">{formatDate(criterion.confirmedAt, locale)}</p> : null}
              {(criterion.evidenceArtifactIds?.length ?? 0) > 0 ? <p className="mt-1 text-xs text-muted-foreground">{copy.evidenceCount.replace("{count}", String(criterion.evidenceArtifactIds?.length ?? 0))}</p> : null}
            </div>
            {criterion.proposalStatus === "proposed" && goal.status === "Active" ? <Button size="sm" disabled={pending} onClick={() => void reviewProposal(criterion.id, criterion.description)}>Confirm criterion</Button> : null}
            {criterion.proposalStatus !== "proposed" && !criterion.satisfied && goal.status === "Active" ? <Button size="sm" variant="outline" disabled={availableArtifacts.length === 0} onClick={() => { setCriterionId(criterion.id); setArtifactIds([]); }}>{copy.confirmCriterion}</Button> : null}
          </div>
        ))}
        <Dialog open={criterionId !== null} onOpenChange={(open) => { if (!open) setCriterionId(null); }}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader><DialogTitle>{copy.confirmCriterion}</DialogTitle><DialogDescription>{copy.confirmCriterionDescription}</DialogDescription></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">{availableArtifacts.map((artifact) => <Label key={artifact.id} className="flex items-center gap-3 rounded-lg border p-3"><Checkbox checked={artifactIds.includes(artifact.id)} onCheckedChange={(checked) => setArtifactIds((current) => checked ? [...current, artifact.id] : current.filter((id) => id !== artifact.id))} /><span>{artifact.title}</span></Label>)}</div>
              <Field><FieldLabel htmlFor="criterion-evidence-note">{copy.criterionEvidenceNote}</FieldLabel><Textarea id="criterion-evidence-note" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setCriterionId(null)}>{copy.cancel}</Button><Button disabled={artifactIds.length === 0 || !note.trim() || pending} onClick={() => void submit()}>{pending ? copy.saving : copy.confirmCriterion}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function TaskRow({ task, copy, goalId }: { task: GoalTaskData; copy: GoalCopy; goalId: string }) {
  const locale = useLocale();
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{task.title}</p>
          <Badge variant={task.group === "attention" ? "destructive" : task.group === "completed" ? "secondary" : "outline"}>
            {copy.taskStatus[task.status] ?? task.status}
          </Badge>
          {task.attention ? <Badge variant="destructive">{task.attention}</Badge> : null}
        </div>
        {task.description ? (
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{task.description}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(task.updatedAt, locale)}</p>
      </div>
      <Button asChild size="sm" variant={task.group === "attention" ? "default" : "outline"}>
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
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>
      {open ? <div className="space-y-2">{tasks.map((task) => <TaskRow key={task.id} task={task} copy={copy} goalId={goalId} />)}</div> : null}
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
  const [selectedContext, setSelectedContext] = useState(() => new Set(goal.workbench.workingSet.map((item) => `${item.subjectType}:${item.subjectId}`)));
  const [title, setTitle] = useState(kind === "review" ? copy.reviewTaskTitle : "");
  const [description, setDescription] = useState(kind === "review" ? copy.reviewTaskDescription : "");
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
        contextSelections: goal.workbench.workingSet
          .filter((item) => selectedContext.has(`${item.subjectType}:${item.subjectId}`))
          .map((item) => ({ subjectType: item.subjectType, subjectId: item.subjectId })),
        autoPlanGeneration: false,
      });
      await revalidator.revalidate();
      onOpenChange(false);
      void navigate(localizeHref(locale, `/goals/${goal.id}/workbench/tasks/${result.taskId}`));
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
          <DialogTitle>{kind === "review" ? copy.startReview : copy.addTaskTitle}</DialogTitle>
          <DialogDescription>{kind === "review" ? copy.reviewTaskDescription : copy.workspaceDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor={`goal-${kind}-title`}>{copy.taskTitleLabel}</FieldLabel>
            <Input
              id={`goal-${kind}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy.taskTitlePlaceholder}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`goal-${kind}-description`}>{copy.taskDescriptionLabel}</FieldLabel>
            <Textarea
              id={`goal-${kind}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={copy.taskDescriptionPlaceholder}
              rows={5}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`goal-${kind}-outcome`}>{copy.expectedOutcome}</FieldLabel>
            <Input id={`goal-${kind}-outcome`} value={expectedOutcome} onChange={(event) => setExpectedOutcome(event.target.value)} placeholder={copy.expectedOutcomePlaceholder} />
          </Field>
          {goal.workbench.workingSet.length ? (
            <Field>
              <FieldLabel>{copy.selectedContext}</FieldLabel>
              <div className="space-y-2">{goal.workbench.workingSet.map((item) => {
                const key = `${item.subjectType}:${item.subjectId}`;
                return <label key={item.id} className="flex items-start gap-3 rounded-xl border p-3 text-sm"><Checkbox checked={selectedContext.has(key)} onCheckedChange={(checked) => setSelectedContext((current) => { const next = new Set(current); if (checked) next.add(key); else next.delete(key); return next; })} /><span>{item.label}</span></label>;
              })}</div>
            </Field>
          ) : null}
          <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{copy.actionPreview}</p><p className="mt-2 text-sm leading-6">{copy.createBoundedTaskPreview}</p></div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          <Button type="button" disabled={!title.trim() || pending} onClick={() => void submit()}>
            {pending ? copy.creatingTask : copy.createTask}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewApplyDialog({ goal, copy, open, onOpenChange }: { goal: GoalData; copy: GoalCopy; open: boolean; onOpenChange: (open: boolean) => void }) {
  const revalidator = useRevalidator();
  const [summary, setSummary] = useState("");
  const [focus, setFocus] = useState(goal.workbench.brief?.currentFocus ?? "");
  const [taskTitle, setTaskTitle] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!summary.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await applyGoalReview(goal.id, {
        summary: summary.trim(),
        brief: goal.workbench.brief && focus.trim() ? { ...goal.workbench.brief, currentFocus: focus.trim() } : undefined,
        tasks: taskTitle.trim() && expectedOutcome.trim() ? [{ kind: "task", title: taskTitle.trim(), description: summary.trim(), priority: "High", autoPlanGeneration: false, expectedOutcome: expectedOutcome.trim(), contextSelections: goal.workbench.workingSet.map((item) => ({ subjectType: item.subjectType, subjectId: item.subjectId })) }] : [],
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{copy.applyReview}</DialogTitle><DialogDescription>{copy.applyReviewDescription}</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-3"><span>{goal.outcome.criteria.filter((criterion) => criterion.satisfied).length}/{goal.outcome.criteria.length} {copy.successCriteria}</span><span>{goal.workbench.focus.newResults.length} {copy.newResults}</span><span>{goal.assets.length} {copy.assets}</span></div>
          <Field><FieldLabel htmlFor="review-summary">{copy.reviewSummary}</FieldLabel><Textarea id="review-summary" value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="review-focus">{copy.currentFocus}</FieldLabel><Input id="review-focus" value={focus} onChange={(event) => setFocus(event.target.value)} /></Field>
          <div className="space-y-3 rounded-xl border p-4"><p className="font-medium">{copy.reviewTaskSuggestion}</p><Field><FieldLabel htmlFor="review-task-title">{copy.addTaskTitle}</FieldLabel><Input id="review-task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></Field><Field><FieldLabel htmlFor="review-task-outcome">{copy.expectedOutcome}</FieldLabel><Textarea id="review-task-outcome" value={expectedOutcome} onChange={(event) => setExpectedOutcome(event.target.value)} /></Field></div>
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 text-sm"><p className="font-medium">{copy.actionPreview}</p><p className="mt-1 text-muted-foreground">{focus !== goal.workbench.brief?.currentFocus ? copy.operationalBrief : copy.currentFocus} · {taskTitle.trim() ? copy.reviewTaskSuggestion : copy.noTasks}</p></div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button><Button disabled={!summary.trim() || pending} onClick={() => void submit()}>{pending ? copy.saving : copy.applyReview}</Button></DialogFooter>
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
    return goal.assets.flatMap((asset) => [asset.currentArtifact]).filter((artifact) => {
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
          <DialogDescription>{copy.confirmAchievementDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">{copy.successCriteria}</p>
            {goal.outcome.criteria.map((criterion) => (
              <div key={criterion.id} className="flex gap-2 rounded-lg border p-3 text-sm">
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
                <Label key={artifact.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                  <Checkbox
                    checked={evidenceIds.includes(artifact.id)}
                    onCheckedChange={(checked) => {
                      setEvidenceIds((current) => checked
                        ? [...current, artifact.id]
                        : current.filter((id) => id !== artifact.id));
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{artifact.title}</span>
                    {artifact.contentPreview ? <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{artifact.contentPreview}</span> : null}
                  </span>
                </Label>
              ))}
            </div>
            {evidenceIds.length === 0 ? <FieldDescription className="text-destructive">{copy.evidenceRequired}</FieldDescription> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="goal-achievement-confirmation">{copy.confirmationLabel}</FieldLabel>
            <Textarea
              id="goal-achievement-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={copy.confirmationPlaceholder}
              rows={5}
            />
          </Field>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          <Button type="button" disabled={!confirmation.trim() || evidenceIds.length === 0 || pending} onClick={() => void submit()}>
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
        <Button onClick={() => void navigate(localizeHref(locale, `/goals/${goal.id}/workbench/tasks/${goal.primaryAction.taskId}`))}>
          <AlertTriangle className="size-4" />
          {copy.nextAction.resolve_attention}
        </Button>
      );
    }
    if (action === "continue_work" && goal.primaryAction.taskId) {
      return (
        <Button onClick={() => void navigate(localizeHref(locale, `/goals/${goal.id}/workbench/tasks/${goal.primaryAction.taskId}`))}>
          <Play className="size-4" />
          {copy.nextAction.continue_work}
        </Button>
      );
    }
    if (action === "resume") {
      return <Button disabled={pending} onClick={() => void runLifecycle("resume")}><Play className="size-4" />{copy.resume}</Button>;
    }
    if (action === "review_criteria") {
      return <Button onClick={() => void navigate(`${localizeHref(locale, `/goals/${goal.id}`)}?section=criteria`)}><CheckCircle2 className="size-4" />{copy.nextAction.review_criteria}</Button>;
    }
    if (action === "review") {
      return <Button onClick={onStartReview}><RefreshCw className="size-4" />{copy.startReview}</Button>;
    }
    if (action === "confirm_outcome" && goal.outcome.criteria.length > 0 && goal.outcome.criteria.every((criterion) => criterion.satisfied)) {
      return <Button onClick={onAchieve}><CheckCircle2 className="size-4" />{copy.achieve}</Button>;
    }
    return <Button onClick={onAddTask}><Plus className="size-4" />{copy.addTask}</Button>;
  })();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {goal.status !== "Achieved" && goal.status !== "Stopped" ? button : null}
      {goal.status === "Active" ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon" aria-label="Goal actions" />}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onStartReview}><RefreshCw className="size-4" />{copy.startReview}</DropdownMenuItem>
            <DropdownMenuItem onClick={onAddTask}><Plus className="size-4" />{copy.addTask}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void runLifecycle("pause")}><Pause className="size-4" />{copy.pause}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void runLifecycle("stop")}>{copy.stop}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// The workspace composes the four lifecycle sections at the route boundary.
// eslint-disable-next-line max-lines-per-function, complexity
export function GoalWorkspacePage({ goal, copy, assetWorkbench }: { goal: GoalData; copy: GoalCopy; assetWorkbench?: React.ReactNode }) {
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
  const defaultSection = requestedSection === "work" || requestedSection === "workbench" || requestedSection === "criteria" || requestedSection === "history" ? requestedSection : "overview";
  return (
    <PageFrame mode="focused">
      <div className="flex min-w-0 flex-1 flex-col gap-5" data-ui-surface-kind="product-authored">
        <header className="space-y-4">
          <Button asChild variant="ghost" size="sm" className="w-fit -ml-2">
            <LocalizedLink href="/goals"><ArrowLeft className="size-4" />{copy.backToGoals}</LocalizedLink>
          </Button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={goal.status === "Achieved" ? "default" : "secondary"}>
                  {isArchive ? <Archive className="size-3.5" /> : <Target className="size-3.5" />}
                  {copy.status[goal.status]}
                </Badge>
                <Badge variant="outline">{isArchive ? copy.outcomeArchive : copy.ongoingWorkspace}</Badge>
                {goal.projection.attention !== "none" ? <Badge variant="destructive">{copy.attention[goal.projection.attention]}</Badge> : null}
                {goal.workbench.pendingInboxCount > 0 ? (
                  <Button asChild size="sm" variant="outline">
                    <LocalizedLink href={`/goals/${goal.id}?section=workbench&assetView=inbox`}>
                      {copy.pendingInbox.replace("{count}", String(goal.workbench.pendingInboxCount))}
                    </LocalizedLink>
                  </Button>
                ) : null}
              </div>
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{goal.title}</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{goal.description}</p>
            </div>
            <PrimaryAction
              goal={goal}
              copy={copy}
              onStartReview={() => setReviewOpen(true)}
              onAddTask={() => setTaskDialog("task")}
              onAchieve={() => setAchievementOpen(true)}
            />
          </div>
        </header>
        {goal.titleSource === "ai" && !goal.titleRenameNoticeSeenAt ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><p className="font-medium">AI-generated Goal name</p><p className="text-sm text-muted-foreground">Review the suggested name. Renaming removes this attribution notice.</p></div>
              <Input aria-label="Rename AI-generated Goal" value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} className="sm:max-w-sm" />
              <Button disabled={!renameTitle.trim() || renamePending} onClick={() => void renameGoal()}>Rename</Button>
            </CardContent>
          </Card>
        ) : null}

        <Tabs value={defaultSection} onValueChange={(section) => { const next = new URLSearchParams(searchParams); if (section === "overview") next.delete("section"); else next.set("section", section); setSearchParams(next, { replace: true }); }} className="min-w-0">
          <div className="sticky top-0 z-20 -mx-2 bg-background/95 px-2 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <TabsList className="grid h-auto w-full grid-cols-5 rounded-xl p-1">
              <TabsTrigger value="overview" className="min-w-0 px-1 py-2 text-xs sm:px-3 sm:text-sm"><Target className="hidden size-4 sm:block" />{copy.overview}</TabsTrigger>
              <TabsTrigger value="work" className="min-w-0 px-1 py-2 text-xs sm:px-3 sm:text-sm"><ListChecks className="hidden size-4 sm:block" />{copy.tasksSection}</TabsTrigger>
              <TabsTrigger value="workbench" className="min-w-0 px-1 py-2 text-xs sm:px-3 sm:text-sm"><FileCheck2 className="hidden size-4 sm:block" />{copy.workbench}</TabsTrigger>
              <TabsTrigger value="criteria" className="min-w-0 px-1 py-2 text-xs sm:px-3 sm:text-sm"><CheckCircle2 className="hidden size-4 sm:block" />{copy.successCriteria}</TabsTrigger>
              <TabsTrigger value="history" className="min-w-0 px-1 py-2 text-xs sm:px-3 sm:text-sm"><History className="hidden size-4 sm:block" />{copy.history}</TabsTrigger>
            </TabsList>
          </div>

 
          <TabsContent value="overview" className="mt-5">
            {isArchive ? <PrimaryOutcome goal={goal} copy={copy} /> : (
              <div className="space-y-5">
                <section aria-labelledby="goal-control-plane" className="space-y-3">
                  <div><p className="text-xs font-semibold text-primary">{copy.controlPlane}</p><h2 id="goal-control-plane" className="mt-1 text-xl font-semibold">{copy.currentFocus}</h2></div>
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]"><FocusQueue goal={goal} copy={copy} /><OperationalBriefCard goal={goal} copy={copy} /></div>
                </section>
                <ActiveSummary goal={goal} copy={copy} />
                <section aria-labelledby="goal-working-set" className="space-y-3">
                  <div><p className="text-xs font-semibold text-primary">{copy.workbench}</p><h2 id="goal-working-set" className="mt-1 text-xl font-semibold">{copy.workingSet}</h2></div>
                  <WorkingSetCard goal={goal} copy={copy} />
                </section>
              </div>
            )}
          </TabsContent>

          <TabsContent value="work" className="mt-5">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>{copy.boundedTasks}</CardTitle>
                  <CardDescription>{format(copy.taskProgress, { completed: goal.projection.completedTaskCount, total: goal.projection.totalTaskCount })}</CardDescription>
                </div>
                {goal.status === "Active" ? <Button size="sm" onClick={() => setTaskDialog("task")}><Plus className="size-4" />{copy.addTask}</Button> : null}
              </CardHeader>
              <CardContent className="space-y-6">
                {goal.tasks.length === 0 ? <p className="text-sm text-muted-foreground">{copy.noTasks}</p> : null}
                <TaskGroupSection group="attention" tasks={goal.taskGroups.attention} copy={copy} defaultOpen goalId={goal.id} />
                <TaskGroupSection group="active" tasks={goal.taskGroups.active} copy={copy} defaultOpen goalId={goal.id} />
                <TaskGroupSection group="planned" tasks={goal.taskGroups.planned} copy={copy} defaultOpen goalId={goal.id} />
                <TaskGroupSection group="completed" tasks={goal.taskGroups.completed} copy={copy} defaultOpen={!isArchive} goalId={goal.id} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="workbench" className="mt-5">
            {assetWorkbench ?? <Card><CardContent className="pt-6 text-sm text-muted-foreground">{copy.noAssets}</CardContent></Card>}
          </TabsContent>

          <TabsContent value="criteria" className="mt-5">
            <CriteriaCard goal={goal} copy={copy} />
          </TabsContent>

          <TabsContent value="history" className="mt-5">
            <Card>
              <CardHeader>
                <CardTitle>{copy.history}</CardTitle>
                <CardDescription>{isArchive ? copy.archiveDescription : copy.workspaceDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="relative space-y-0 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">
                  {goal.activity.map((item) => (
                    <li key={item.id} className="relative flex gap-4 pb-6 last:pb-0">
                      <span className="relative z-10 mt-1.5 size-[15px] shrink-0 rounded-full border-2 border-background bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">{item.title}</p>
                          <span className="text-xs text-muted-foreground">{formatDate(item.occurredAt, useLocale())}</span>
                        </div>
                        {item.detail ? <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.detail}</p> : null}
                        {item.taskId ? <Button asChild variant="link" size="sm" className="h-auto px-0 pt-1"><LocalizedLink href={`/goals/${goal.id}/workbench/tasks/${item.taskId}`}>{copy.openTask}</LocalizedLink></Button> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <CreateTaskDialog goal={goal} copy={copy} kind="task" open={taskDialog !== null} onOpenChange={(open) => { if (!open) setTaskDialog(null); }} />
        <ReviewApplyDialog goal={goal} copy={copy} open={reviewOpen} onOpenChange={setReviewOpen} />
        <AchievementDialog goal={goal} copy={copy} open={achievementOpen} onOpenChange={setAchievementOpen} />
      </div>
    </PageFrame>
  );
}
