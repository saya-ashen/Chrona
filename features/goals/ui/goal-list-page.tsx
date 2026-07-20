"use client";

import { ArrowRight, CheckCircle2, CircleDot, Target } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, PageFrame } from "@shared/ui";
import { LocalizedLink } from "@/components/i18n/localized-link";
import type { GoalCopy, GoalData } from "../model/goal-types";

function format(copy: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), copy);
}

export function GoalListPage({ goals, copy }: { goals: GoalData[]; copy: GoalCopy }) {
  return (
    <PageFrame mode="overview">
      <div className="flex min-w-0 flex-1 flex-col gap-5" data-ui-surface-kind="product-authored">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Target className="size-6 text-primary" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{copy.subtitle}</p>
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
