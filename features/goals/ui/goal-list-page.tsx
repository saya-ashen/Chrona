"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, CircleDot, Plus, Target } from "lucide-react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { useLocale, localizeHref } from "@chrona/i18n";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, PageFrame, Textarea } from "@shared/ui";
import { apiJson } from "@shared/http";
import { createGoalWithFirstTask } from "../browser-api";
import { LocalizedLink } from "./localized-link";
import type { GoalCopy, GoalData } from "../model/goal-types";

function format(copy: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), copy);
}
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
      const workspace = await apiJson<{ id: string }>("/api/workspaces/default");
      const created = await createGoalWithFirstTask({
        workspaceId: workspace.id,
        intendedOutcome: outcome.trim(),
        firstWorkItem: firstWorkItem.trim(),
        description: description.trim() || null,
        priority: "High",
        idempotencyKey: crypto.randomUUID(),
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
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <Button onClick={() => setOpen(true)}><Plus className="size-4" />{copy.createGoal}</Button>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{copy.createGoal}</DialogTitle><DialogDescription>{copy.createGoalDescription}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field><FieldLabel htmlFor="goal-outcome">{copy.outcomeLabel}</FieldLabel><Textarea id="goal-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="goal-first-work">{copy.currentFocus}</FieldLabel><Input id="goal-first-work" value={firstWorkItem} onChange={(event) => setFirstWorkItem(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="goal-description">{copy.goalDescriptionLabel}</FieldLabel><Textarea id="goal-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={copy.goalDescriptionPlaceholder} /></Field>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{copy.cancel}</Button><Button disabled={!outcome.trim() || !firstWorkItem.trim() || pending} onClick={() => void submit()}>{pending ? copy.saving : copy.createGoal}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export function GoalListPage({ goals, copy }: { goals: GoalData[]; copy: GoalCopy }) {
  const groups = useMemo(() => {
    const grouped: Record<GoalListGroup, GoalData[]> = { attention: [], progress: [], stable: [], archive: [] };
    for (const goal of goals) grouped[goalListGroup(goal)].push(goal);
    return grouped;
  }, [goals]);
  const sections: Array<{ key: GoalListGroup; title: string; description: string }> = [
    { key: "attention", title: copy.needsYou, description: copy.focusQueue },
    { key: "progress", title: copy.inProgress, description: copy.workspaceDescription },
    { key: "stable", title: copy.stable, description: copy.stableDescription },
    { key: "archive", title: copy.outcomeArchive, description: copy.archiveDescription },
  ];

  return (
    <PageFrame mode="overview">
      <div className="flex min-w-0 flex-1 flex-col gap-6" data-ui-surface-kind="product-authored">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><Target className="size-6 text-primary" aria-hidden /><h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1></div>
            <p className="max-w-3xl text-sm text-muted-foreground">{copy.subtitle}</p>
          </div>
          <CreateGoalDialog copy={copy} />
        </header>

        {goals.length === 0 ? (
          <Card><CardHeader><CardTitle>{copy.emptyTitle}</CardTitle><CardDescription>{copy.emptyDescription}</CardDescription></CardHeader><CardFooter><CreateGoalDialog copy={copy} /></CardFooter></Card>
        ) : sections.map((section) => groups[section.key].length > 0 ? (
          <section key={section.key} aria-labelledby={`goal-group-${section.key}`} className="space-y-3">
            <div><h2 id={`goal-group-${section.key}`} className="text-lg font-semibold">{section.title}</h2><p className="text-sm text-muted-foreground">{section.description}</p></div>
            <div className="grid gap-4 xl:grid-cols-2">
              {groups[section.key].map((goal) => (
                <Card key={goal.id} className="min-w-0 overflow-hidden">
                  <CardHeader className="gap-3">
                    <div className="flex flex-wrap items-center gap-2"><Badge variant={goal.status === "Achieved" ? "default" : "secondary"}>{goal.status === "Achieved" ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleDot className="size-3.5" aria-hidden />}{copy.status[goal.status]}</Badge>{goal.projection.activity !== "idle" ? <Badge variant="outline">{copy.activity[goal.projection.activity]}</Badge> : null}{goal.projection.attention !== "none" ? <Badge variant="destructive">{copy.attention[goal.projection.attention]}</Badge> : null}</div>
                    <CardTitle className="text-xl">{goal.title}</CardTitle><CardDescription className="line-clamp-3">{goal.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.successCriteria}</p><p className="mt-1 font-medium">{format(copy.criteriaProgress, { completed: goal.projection.criteriaSatisfiedCount, total: goal.projection.criteriaTotalCount })}</p></div>
                    <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.boundedTasks}</p><p className="mt-1 font-medium">{format(copy.taskProgress, { completed: goal.projection.completedTaskCount, total: goal.projection.totalTaskCount })}</p></div>
                  </CardContent>
                  <CardFooter className="justify-between gap-3 border-t bg-muted/20 py-3"><span className="truncate text-xs text-muted-foreground">{copy.nextAction[goal.projection.nextAction]}</span><Button asChild size="sm"><LocalizedLink href={`/goals/${goal.id}`}>{copy.openGoal}<ArrowRight className="size-4" aria-hidden /></LocalizedLink></Button></CardFooter>
                </Card>
              ))}
            </div>
          </section>
        ) : null)}
      </div>
    </PageFrame>
  );
}
