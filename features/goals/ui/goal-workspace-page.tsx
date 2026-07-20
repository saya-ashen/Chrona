"use client";

import { useState } from "react";
import { useRevalidator } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ExternalLink, FileText, Pause, Play, Square, Target } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageFrame,
  Separator,
} from "@shared/ui";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { runGoalAction } from "../browser-api";
import type { GoalCopy, GoalData } from "../model/goal-types";

function format(copy: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), copy);
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function GoalWorkspacePage({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const revalidator = useRevalidator();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAchieve, setShowAchieve] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  async function act(action: "pause" | "resume" | "stop" | "review" | "achieve") {
    setIsPending(true);
    setError(null);
    try {
      await runGoalAction(goal.id, action, confirmation);
      setShowAchieve(false);
      setConfirmation("");
      await revalidator.revalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setIsPending(false);
    }
  }

  const primaryAction = goal.projection.nextAction;
  const resultTasks = goal.tasks.filter((task) => task.latestAcceptedResult);

  return (
    <PageFrame mode="workspace">
      <div className="flex min-w-0 flex-1 flex-col gap-5" data-ui-surface-kind="product-authored">
        <header className="space-y-4">
          <Button asChild variant="ghost" size="sm" className="w-fit px-2">
            <LocalizedLink href="/goals">
              <ArrowLeft className="size-4" aria-hidden />
              {copy.backToGoals}
            </LocalizedLink>
          </Button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={goal.status === "Achieved" ? "default" : "secondary"}>
                  {goal.status === "Achieved" ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Target className="size-3.5" aria-hidden />}
                  {copy.status[goal.status]}
                </Badge>
                {goal.projection.activity !== "idle" ? <Badge variant="outline">{copy.activity[goal.projection.activity]}</Badge> : null}
                {goal.projection.attention !== "none" ? <Badge variant="destructive">{copy.attention[goal.projection.attention]}</Badge> : null}
              </div>
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{goal.title}</h1>
              {goal.description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{goal.description}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2" data-ui-surface-kind="runtime-control">
              {goal.status === "Active" ? (
                <Button variant="outline" onClick={() => void act("pause")} disabled={isPending}>
                  <Pause className="size-4" aria-hidden />{copy.pause}
                </Button>
              ) : null}
              {goal.status === "Paused" ? (
                <Button onClick={() => void act("resume")} disabled={isPending}>
                  <Play className="size-4" aria-hidden />{copy.resume}
                </Button>
              ) : null}
              {goal.status === "Active" ? (
                <Button onClick={() => setShowAchieve(true)} disabled={isPending}>
                  <Check className="size-4" aria-hidden />{copy.achieve}
                </Button>
              ) : null}
              {goal.status !== "Achieved" && goal.status !== "Stopped" ? (
                <Button variant="ghost" onClick={() => void act("stop")} disabled={isPending}>
                  <Square className="size-4" aria-hidden />{copy.stop}
                </Button>
              ) : null}
            </div>
          </div>
          {error ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="size-4" aria-hidden />{error}</p>
          ) : null}
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{copy.outcome}</CardTitle>
                <CardDescription>{copy.successCriteria}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {goal.successCriteria.map((criterion) => (
                  <div key={criterion.id} className="flex items-start gap-3 rounded-lg border p-3">
                    {criterion.satisfied ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> : <CircleIndicator />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{criterion.description}</p>
                      {criterion.confirmedAt ? <p className="mt-1 text-xs text-muted-foreground">{formatDate(criterion.confirmedAt)}</p> : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{copy.boundedTasks}</CardTitle>
                <CardDescription>{format(copy.taskProgress, { completed: goal.projection.completedTaskCount, total: goal.projection.totalTaskCount })}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {goal.tasks.length === 0 ? <p className="text-sm text-muted-foreground">{copy.noTasks}</p> : goal.tasks.map((task) => (
                  <div key={task.id} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{task.title}</p><Badge variant="outline">{task.status}</Badge></div>
                      {task.description ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p> : null}
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <LocalizedLink href={`/tasks/${task.id}`}>{copy.openTask}<ExternalLink className="size-4" aria-hidden /></LocalizedLink>
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{copy.acceptedResults}</CardTitle>
                <CardDescription>{copy.immutableResult}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {resultTasks.length === 0 ? <p className="text-sm text-muted-foreground">{copy.noAssets}</p> : resultTasks.map((task) => (
                  <div key={task.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{task.title}</p><Badge variant="secondary">{copy.immutableResult}</Badge></div>
                    <div className="mt-3 space-y-2">
                      {task.latestAcceptedResult?.artifacts.map((artifact) => (
                        <div key={artifact.id} className="rounded-md bg-muted/40 p-3" data-ui-surface-kind="ai-authored">
                          <p className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4" aria-hidden />{artifact.title}</p>
                          {artifact.contentPreview ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{artifact.contentPreview}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <aside className="min-w-0 space-y-4">
            <Card className={primaryAction !== "none" ? "border-primary/40" : undefined} data-ui-surface-kind="runtime-control">
              <CardHeader>
                <CardTitle>{copy.progress}</CardTitle>
                <CardDescription>{copy.nextAction[primaryAction]}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{copy.successCriteria}</span><strong>{format(copy.criteriaProgress, { completed: goal.projection.criteriaSatisfiedCount, total: goal.projection.criteriaTotalCount })}</strong></div>
                <Separator />
                <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{copy.nextReview}</span><strong className="text-right">{formatDate(goal.nextReviewAt) ?? copy.noReview}</strong></div>
                {goal.achievedAt ? <><Separator /><div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{copy.achievedAt}</span><strong className="text-right">{formatDate(goal.achievedAt)}</strong></div></> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{copy.assets}</CardTitle><CardDescription>{copy.sourceEvidence}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {goal.assets.length === 0 ? <p className="text-sm text-muted-foreground">{copy.noAssets}</p> : goal.assets.map((asset) => (
                  <div key={asset.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{asset.label}</p><Badge variant="outline">{asset.status}</Badge></div>
                    <p className="mt-2 text-xs text-muted-foreground">{copy.sourceEvidence}: {asset.sourceArtifact.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{copy.currentVersion}: {asset.currentArtifact.title}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <Dialog open={showAchieve} onOpenChange={setShowAchieve}>
        <DialogContent>
          <DialogHeader><DialogTitle>{copy.confirmAchievement}</DialogTitle><DialogDescription>{copy.confirmAchievementDescription}</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label htmlFor="goal-achievement-confirmation">{copy.confirmationLabel}</Label><Input id="goal-achievement-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={copy.confirmationPlaceholder} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setShowAchieve(false)}>{copy.cancel}</Button><Button onClick={() => void act("achieve")} disabled={confirmation.trim().length === 0 || isPending}>{isPending ? copy.confirming : copy.achieve}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}

function CircleIndicator() {
  return <span className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-muted-foreground/40" aria-hidden />;
}
