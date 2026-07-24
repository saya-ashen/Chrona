"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  CircleOff,
  Clock3,
  ListChecks,
  Pause,
  Plus,
  Target,
} from "lucide-react";
import { useNavigate, useRevalidator, useSearchParams } from "react-router-dom";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@shared/ui";
import { apiJson } from "@shared/http";
import { createGoalWithFirstTask } from "../browser-api";
import { LocalizedLink } from "./localized-link";
import type { GoalCopy, GoalData } from "../model/goal-types";

type GoalListGroup = "attention" | "progress" | "stable";

function goalListGroup(goal: GoalData): GoalListGroup {
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

function GoalCard({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const isArchive = goal.mode === "archive";
  const needsAttention = goal.projection.attention !== "none";
  const description =
    goal.description?.trim() === goal.title.trim() ? null : goal.description;
  const StatusIcon =
    goal.status === "Achieved"
      ? CheckCircle2
      : goal.status === "Stopped"
        ? CircleOff
        : goal.status === "Paused"
          ? Pause
          : needsAttention
            ? AlertTriangle
            : CircleDot;

  return (
    <LocalizedLink
      href={`/goals/${goal.id}`}
      aria-label={`${copy.openGoal}: ${goal.title}`}
      className="group block min-w-0 rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card
        className={`min-w-0 overflow-hidden border-l-[3px] shadow-none transition-colors group-hover:bg-card ${goal.status === "Achieved" ? "border-l-success/70 bg-success/[0.025]" : goal.status === "Stopped" ? "border-l-muted-foreground/40 bg-muted/[0.18]" : needsAttention ? "border-l-warning bg-warning/[0.035]" : "border-l-info/70"}`}
      >
        <CardContent className="p-0">
          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${goal.status === "Achieved" ? "text-success" : goal.status === "Stopped" ? "text-muted-foreground" : needsAttention ? "text-warning" : "text-info"}`}
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
                  className={`size-4 ${goal.status === "Achieved" ? "text-success" : "text-muted-foreground"}`}
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
            <div className="flex items-center justify-between gap-3">
              <p
                className={`text-sm ${needsAttention ? "font-medium text-warning" : "text-muted-foreground"}`}
              >
                {isArchive
                  ? copy.archiveCardSummary
                  : copy.nextAction[goal.projection.nextAction]}
              </p>
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                aria-hidden
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </LocalizedLink>
  );
}

function GoalSection({
  section,
  goals,
  copy,
}: {
  section: { key: GoalListGroup; title: string; description: string };
  goals: GoalData[];
  copy: GoalCopy;
}) {
  if (!goals.length) return null;
  return (
    <section
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
          {goals.length}
        </span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} copy={copy} />
        ))}
      </div>
    </section>
  );
}

function GoalListEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-14 text-center">
      <Target className="mx-auto size-10 text-muted-foreground" />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
export function GoalListPage({
  goals,
  copy,
}: {
  goals: GoalData[];
  copy: GoalCopy;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedGoalView =
    searchParams.get("goalView") === "archived" ? "archived" : "current";
  const [goalView, setGoalView] = useState<"current" | "archived">(
    requestedGoalView,
  );
  const { currentGoals, archivedGoals, groups } = useMemo(() => {
    const current: GoalData[] = [];
    const archived: GoalData[] = [];
    const grouped: Record<GoalListGroup, GoalData[]> = {
      attention: [],
      progress: [],
      stable: [],
    };
    for (const goal of goals) {
      if (goal.mode === "archive") {
        archived.push(goal);
      } else {
        current.push(goal);
        grouped[goalListGroup(goal)].push(goal);
      }
    }
    return { currentGoals: current, archivedGoals: archived, groups: grouped };
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
  ];

  return (
    <PageFrame mode="focused" data-domain="goals" className="p-1 sm:p-2">
      <div
        className="flex min-w-0 flex-1 flex-col gap-6"
        data-ui-surface-kind="product-authored"
      >
        <PageHeader
          title={copy.title}
          description={copy.subtitle}
          actions={<CreateGoalDialog copy={copy} />}
        />
        <Tabs
          value={goalView}
          onValueChange={(value) => {
            const nextView = value === "archived" ? "archived" : "current";
            setGoalView(nextView);
            const next = new URLSearchParams(searchParams);
            if (nextView === "current") next.delete("goalView");
            else next.set("goalView", "archived");
            setSearchParams(next, { replace: true });
          }}
          className="min-w-0"
        >
          <TabsList className="max-w-full bg-muted/60">
            <TabsTrigger value="current" className="min-w-0 sm:min-w-36">
              <Target className="size-4" aria-hidden />
              {copy.currentGoals}
              <Badge variant="secondary">{currentGoals.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="archived" className="min-w-0 sm:min-w-36">
              <Archive className="size-4" aria-hidden />
              {copy.archivedGoals}
              <Badge variant="secondary">{archivedGoals.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="current" className="space-y-8 pt-5">
            {currentGoals.length ? (
              sections.map((section) => (
                <GoalSection
                  key={section.key}
                  section={section}
                  goals={groups[section.key]}
                  copy={copy}
                />
              ))
            ) : (
              <GoalListEmpty
                title={copy.emptyTitle}
                description={copy.emptyDescription}
              />
            )}
          </TabsContent>
          <TabsContent value="archived" className="space-y-4 pt-5">
            {archivedGoals.length ? (
              <>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {copy.archivedGoalsDescription}
                </p>
                <div className="grid gap-3 xl:grid-cols-2">
                  {archivedGoals.map((goal) => (
                    <GoalCard key={goal.id} goal={goal} copy={copy} />
                  ))}
                </div>
              </>
            ) : (
              <GoalListEmpty
                title={copy.archivedGoalsEmpty}
                description={copy.archivedGoalsEmptyDescription}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageFrame>
  );
}
