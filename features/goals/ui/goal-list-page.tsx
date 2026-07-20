"use client";

import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { ArrowRight, CheckCircle2, CircleDot, Plus, Target, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, PageFrame, Textarea } from "@shared/ui";
import { LocalizedLink } from "./localized-link";
import { createGoal } from "../browser-api";
import type { GoalCopy, GoalData } from "../model/goal-types";
import { localizeHref, useLocale } from "@chrona/i18n";

function format(copy: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), copy);
}

function CreateGoalDialog({ copy }: { copy: GoalCopy }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState([""]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const locale = useLocale();

  async function submit() {
    const normalizedCriteria = criteria.map((criterion) => criterion.trim()).filter(Boolean);
    if (!title.trim() || normalizedCriteria.length === 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      const goal = await createGoal({
        workspaceId: "ws_default",
        title: title.trim(),
        description: description.trim() || null,
        successCriteria: normalizedCriteria.map((criterion, index) => ({
          id: `criterion-${index + 1}`,
          kind: "user_confirmed",
          description: criterion,
          satisfied: false,
          confirmedAt: null,
        })),
      });
      await revalidator.revalidate();
      void navigate(localizeHref(locale, `/goals/${goal.id}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)}><Plus className="size-4" />{copy.createGoal}</Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.createGoal}</DialogTitle>
          <DialogDescription>{copy.createGoalDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field><FieldLabel htmlFor="goal-title">{copy.goalTitleLabel}</FieldLabel><Input id="goal-title" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="goal-description">{copy.goalDescriptionLabel}</FieldLabel><Textarea id="goal-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></Field>
          <Field>
            <FieldLabel>{copy.successCriteria}</FieldLabel>
            <div className="space-y-2">
              {criteria.map((criterion, index) => (
                <div key={index} className="flex gap-2">
                  <Input aria-label={`${copy.criterionLabel} ${index + 1}`} value={criterion} onChange={(event) => setCriteria((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder={copy.criterionPlaceholder} />
                  {criteria.length > 1 ? <Button type="button" size="icon" variant="outline" aria-label={copy.removeCriterion} onClick={() => setCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></Button> : null}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setCriteria((current) => [...current, ""])}><Plus className="size-4" />{copy.addCriterion}</Button>
            </div>
          </Field>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{copy.cancel}</Button><Button type="button" disabled={!title.trim() || criteria.every((criterion) => !criterion.trim()) || pending} onClick={() => void submit()}>{pending ? copy.creatingGoal : copy.createGoal}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GoalListPage({ goals, copy }: { goals: GoalData[]; copy: GoalCopy }) {
  return (
    <PageFrame mode="overview">
      <div className="flex min-w-0 flex-1 flex-col gap-5" data-ui-surface-kind="product-authored">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Target className="size-6 text-primary" aria-hidden />
              <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{copy.subtitle}</p>
          </div>
          <CreateGoalDialog copy={copy} />
        </header>

        {goals.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{copy.emptyTitle}</CardTitle>
              <CardDescription>{copy.emptyDescription}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {goals.map((goal) => (
              <Card key={goal.id} className="min-w-0 overflow-hidden">
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={goal.status === "Achieved" ? "default" : "secondary"}>
                      {goal.status === "Achieved" ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleDot className="size-3.5" aria-hidden />}
                      {copy.status[goal.status]}
                    </Badge>
                    {goal.projection.activity !== "idle" ? (
                      <Badge variant="outline">{copy.activity[goal.projection.activity]}</Badge>
                    ) : null}
                    {goal.projection.attention !== "none" ? (
                      <Badge variant="destructive">{copy.attention[goal.projection.attention]}</Badge>
                    ) : null}
                  </div>
                  <CardTitle className="text-xl">{goal.title}</CardTitle>
                  <CardDescription className="line-clamp-3">{goal.description}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.successCriteria}</p>
                    <p className="mt-1 font-medium">
                      {format(copy.criteriaProgress, {
                        completed: goal.projection.criteriaSatisfiedCount,
                        total: goal.projection.criteriaTotalCount,
                      })}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.boundedTasks}</p>
                    <p className="mt-1 font-medium">
                      {format(copy.taskProgress, {
                        completed: goal.projection.completedTaskCount,
                        total: goal.projection.totalTaskCount,
                      })}
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="justify-between gap-3 border-t bg-muted/20 py-3">
                  <span className="truncate text-xs text-muted-foreground">
                    {copy.nextAction[goal.projection.nextAction]}
                  </span>
                  <Button asChild size="sm">
                    <LocalizedLink href={`/goals/${goal.id}`}>
                      {copy.openGoal}
                      <ArrowRight className="size-4" aria-hidden />
                    </LocalizedLink>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageFrame>
  );
}
