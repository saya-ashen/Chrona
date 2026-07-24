"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  ListChecks,
  Pause,
  Plus,
  Target,
} from "lucide-react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { useLocale, localizeHref } from "@chrona/i18n";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  PageFrame,
  PageHeader,
  Separator,
  Textarea,
} from "@shared/ui";
import { apiJson } from "@shared/http";
import { createGoalWithFirstTask } from "../browser-api";
import { LocalizedLink } from "./localized-link";
import type { GoalCopy, GoalData } from "../model/goal-types";

type GoalListGroup = "attention" | "progress" | "stable" | "archive";

function goalListGroup(goal: GoalData): GoalListGroup {
  if (goal.mode === "archive") return "archive";
  if (goal.projection.attention !== "none") return "attention";
  if (goal.projection.activity !== "idle") return "progress";
  return "stable";
}

function CreateGoalDialog({ copy }: { copy: GoalCopy }) {
  const locale = useLocale();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [firstWorkItem, setFirstWorkItem] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!outcome.trim() || !firstWorkItem.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const workspace = await apiJson<{ id: string }>(
        "/api/workspaces/default",
      );
      const created = await createGoalWithFirstTask({
        workspaceId: workspace.id,
        intendedOutcome: outcome.trim(),
        firstWorkItem: firstWorkItem.trim(),
        description: description.trim() || null,
        priority: "High",
        idempotencyKey: uuidv4(),
      });
      await revalidator.revalidate();
      void navigate(localizeHref(locale, `/goals/${created.goal.id}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {copy.createGoal}
      </Button>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.createGoal}</DialogTitle>
          <DialogDescription>{copy.createGoalDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <section className="space-y-4" aria-labelledby="goal-outcome-group">
            <div>
              <p id="goal-outcome-group" className="text-sm font-semibold">
                {copy.defineOutcome}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.defineOutcomeDescription}
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor="goal-outcome">
                {copy.outcomeLabel}
              </FieldLabel>
              <Textarea
                id="goal-outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                placeholder={copy.goalOutcomePlaceholder}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="goal-description">
                {copy.goalDescriptionLabel}
              </FieldLabel>
              <Textarea
                id="goal-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={copy.goalDescriptionPlaceholder}
              />
              <FieldDescription>{copy.goalDescriptionHelp}</FieldDescription>
            </Field>
          </section>
          <Separator />
          <section
            className="space-y-4"
            aria-labelledby="goal-first-task-group"
          >
            <div>
              <p id="goal-first-task-group" className="text-sm font-semibold">
                {copy.startFirstTask}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.startFirstTaskDescription}
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor="goal-first-work">
                {copy.firstTaskLabel}
              </FieldLabel>
              <Input
                id="goal-first-work"
                value={firstWorkItem}
                onChange={(event) => setFirstWorkItem(event.target.value)}
                placeholder={copy.firstTaskPlaceholder}
              />
            </Field>
          </section>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {copy.cancel}
          </Button>
          <Button
            disabled={!outcome.trim() || !firstWorkItem.trim() || pending}
            onClick={() => void submit()}
          >
            {pending ? copy.saving : copy.createGoal}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GoalListPage({
  goals,
  copy,
}: {
  goals: GoalData[];
  copy: GoalCopy;
}) {
  const groups = useMemo(() => {
    const grouped: Record<GoalListGroup, GoalData[]> = {
      attention: [],
      progress: [],
      stable: [],
      archive: [],
    };
    for (const goal of goals) grouped[goalListGroup(goal)].push(goal);
    return grouped;
  }, [goals]);
  const sections: Array<{
    key: GoalListGroup;
    title: string;
    description: string;
  }> = [
    {
      key: "attention",
      title: copy.needsYou,
      description: copy.attentionGoalsDescription,
    },
    {
      key: "progress",
      title: copy.inProgress,
      description: copy.progressGoalsDescription,
    },
    {
      key: "stable",
      title: copy.quietGoals,
      description: copy.stableDescription,
    },
    {
      key: "archive",
      title: copy.outcomeArchive,
      description: copy.archiveDescription,
    },
  ];
  return (
    <PageFrame mode="focused" data-domain="goals" className="p-1 sm:p-2">
      <div
        className="flex min-w-0 flex-1 flex-col gap-8"
        data-ui-surface-kind="product-authored"
      >
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Target className="size-4" aria-hidden />
              {copy.title}
            </span>
          }
          title={copy.goalPortfolio}
          description={copy.subtitle}
          actions={<CreateGoalDialog copy={copy} />}
        />
        {goals.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-14 text-center">
            <Target className="mx-auto size-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">{copy.emptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {copy.emptyDescription}
            </p>
          </div>
        ) : null}
        {sections.map((section) =>
          groups[section.key].length ? (
            <section
              key={section.key}
              aria-labelledby={`goal-group-${section.key}`}
              className="space-y-4"
            >
              <div className="flex items-end justify-between gap-4 border-b pb-3">
                <div>
                  <h2
                    id={`goal-group-${section.key}`}
                    className="text-xl font-semibold tracking-tight"
                  >
                    {section.title}
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    {section.description}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {groups[section.key].length}
                </span>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {groups[section.key].map((goal) => {
                  const isArchive = goal.mode === "archive";
                  const needsAttention = goal.projection.attention !== "none";
                  const description =
                    goal.description?.trim() === goal.title.trim()
                      ? null
                      : goal.description;
                  const StatusIcon = isArchive
                    ? CheckCircle2
                    : goal.status === "Paused"
                      ? Pause
                      : needsAttention
                        ? AlertTriangle
                        : CircleDot;
                  return (
                    <Card
                      key={goal.id}
                      className={`group min-w-0 overflow-hidden border-l-[3px] shadow-none transition-colors hover:bg-card ${isArchive ? "border-l-success/70 bg-success/[0.025]" : needsAttention ? "border-l-warning bg-warning/[0.035]" : "border-l-info/70"}`}
                    >
                      <CardContent className="p-0">
                        <div className="flex flex-col gap-5 p-5 sm:p-6">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span
                              className={`inline-flex items-center gap-1.5 font-medium ${isArchive ? "text-success" : needsAttention ? "text-warning" : "text-info"}`}
                            >
                              <StatusIcon className="size-4" aria-hidden />
                              {copy.status[goal.status]}
                            </span>
                            {goal.projection.activity !== "idle" ? (
                              <Badge variant="outline">
                                {copy.activity[goal.projection.activity]}
                              </Badge>
                            ) : null}
                            {needsAttention ? (
                              <Badge variant="destructive">
                                {copy.attention[goal.projection.attention]}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
                              {goal.title}
                            </h3>
                            {description ? (
                              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                                {description}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border/70 py-3 text-sm">
                            <span className="inline-flex items-center gap-2">
                              <CheckCircle2
                                className={`size-4 ${isArchive ? "text-success" : "text-muted-foreground"}`}
                                aria-hidden
                              />
                              <span className="font-medium tabular-nums">
                                {goal.projection.criteriaSatisfiedCount}/
                                {goal.projection.criteriaTotalCount}
                              </span>
                              <span className="text-muted-foreground">
                                {copy.successCriteria}
                              </span>
                            </span>
                            <span className="inline-flex items-center gap-2">
                              <ListChecks
                                className="size-4 text-muted-foreground"
                                aria-hidden
                              />
                              <span className="font-medium tabular-nums">
                                {goal.projection.completedTaskCount}/
                                {goal.projection.totalTaskCount}
                              </span>
                              <span className="text-muted-foreground">
                                {copy.boundedTasks}
                              </span>
                            </span>
                            {isArchive && goal.achievedAt ? (
                              <span className="inline-flex items-center gap-2 text-muted-foreground">
                                <Clock3 className="size-4" aria-hidden />
                                {copy.achievedAt}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p
                              className={`text-sm ${needsAttention ? "font-medium text-warning" : "text-muted-foreground"}`}
                            >
                              {isArchive
                                ? copy.archiveCardSummary
                                : copy.nextAction[goal.projection.nextAction]}
                            </p>
                            <Button
                              asChild
                              size="sm"
                              variant={needsAttention ? "default" : "outline"}
                              className="shrink-0 self-start sm:self-auto"
                            >
                              <LocalizedLink href={`/goals/${goal.id}`}>
                                {isArchive ? copy.viewOutcome : copy.openGoal}
                                <ArrowRight className="size-4" aria-hidden />
                              </LocalizedLink>
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </PageFrame>
  );
}
