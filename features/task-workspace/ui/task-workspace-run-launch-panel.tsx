"use client";

import { useI18n } from "@chrona/i18n";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@shared/ui";
import type { TaskWorkspaceDisplayState } from "../model/task-workspace-interaction";

function formatLaunchTime(value: string | null, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function RunLaunchPanel({
  launch,
  onStart,
  onEditTask,
}: {
  launch: NonNullable<TaskWorkspaceDisplayState["runPreview"]>;
  onStart: () => void;
  onEditTask?: () => void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const scheduledStart = formatLaunchTime(launch.scheduledStartAt, locale);
  const scheduledEnd = formatLaunchTime(launch.scheduledEndAt, locale);
  const isBlocked = launch.readiness === "blocked";
  const isScheduled = launch.readiness === "scheduled";
  const title = isBlocked
    ? copy.launchBlockedTitle
    : isScheduled
      ? copy.launchScheduledTitle
      : copy.launchReadyTitle;
  const description = isBlocked
    ? copy.launchBlockedDescription
    : isScheduled
      ? copy.launchScheduledDescription
      : launch.startMode === "automatic"
        ? copy.launchAutomaticDescription
        : copy.launchManualDescription;

  return (
    <aside
      className="space-y-3 xl:sticky xl:top-3 xl:self-start"
      aria-label={copy.launchPanelAria}
      data-ui-surface-kind="runtime-control"
    >
      <Card
        className={
          isBlocked
            ? "gap-3 border-destructive/35 bg-destructive/5 py-4 shadow-sm"
            : "gap-3 border-primary/30 bg-primary/5 py-4 shadow-sm"
        }
      >
        <CardHeader className="gap-2 px-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              {copy.launchEyebrow}
            </p>
            <Badge
              variant={
                isBlocked
                  ? "destructive"
                  : isScheduled
                    ? "secondary"
                    : "default"
              }
            >
              {title}
            </Badge>
          </div>
          <CardTitle className="font-heading text-xl tracking-[-0.025em]">
            {title}
          </CardTitle>
          <p className="text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 px-4">
          {isBlocked && launch.blockerSummary ? (
            <div
              className="rounded-xl border border-destructive/25 bg-background/80 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {launch.blockerSummary}
            </div>
          ) : null}

          <dl className="divide-y divide-border/65 border-y border-border/65 text-sm">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-muted-foreground">
                {copy.launchStartsLabel}
              </dt>
              <dd className="font-medium text-foreground">
                {isScheduled && scheduledStart
                  ? `${scheduledStart}${scheduledEnd ? ` – ${scheduledEnd}` : ""}`
                  : copy.launchImmediateValue}
              </dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-muted-foreground">
                {copy.launchRunsWithLabel}
              </dt>
              <dd className="font-medium text-foreground">
                {launch.providerLabel} · {launch.runtimeLabel}
              </dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-muted-foreground">
                {copy.launchFirstStepLabel}
              </dt>
              <dd className="font-medium text-foreground">
                {launch.firstStepLabel}
              </dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-muted-foreground">
                {copy.launchResultLabel}
              </dt>
              <dd className="font-medium text-foreground">
                {copy.launchResultValue}
              </dd>
            </div>
          </dl>

          <section aria-labelledby="launch-stops-title" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3
                id="launch-stops-title"
                className="text-sm font-semibold text-foreground"
              >
                {copy.launchStopsTitle}
              </h3>
              <Badge variant="outline">{launch.expectedStops.length}</Badge>
            </div>
            {launch.expectedStops.length > 0 ? (
              <ul className="space-y-2">
                {launch.expectedStops.map((stop) => (
                  <li key={stop.id} className="flex items-start gap-2 text-sm">
                    <Badge variant="secondary" className="mt-0.5 shrink-0">
                      {stop.kind === "approval"
                        ? copy.launchApprovalStop
                        : copy.launchInputStop}
                    </Badge>
                    <span className="leading-5 text-foreground">
                      {stop.label}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {copy.launchNoStops}
              </p>
            )}
          </section>

          {isBlocked ? (
            launch.recoveryAction === "connect_provider" ? (
              <Button
                type="button"
                className="w-full"
                onClick={onEditTask}
                disabled={!onEditTask}
              >
                {copy.launchConnectProvider}
              </Button>
            ) : (
              <Button
                type="button"
                className="w-full"
                onClick={onEditTask}
                disabled={!onEditTask}
              >
                {copy.launchEditTask}
              </Button>
            )
          ) : (
            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={onStart}
              disabled={!launch.canStartManually}
            >
              {isScheduled ? copy.launchStartNow : copy.launchStartRun}
            </Button>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            {isBlocked
              ? copy.launchBlockedBoundary
              : isScheduled
                ? copy.launchScheduledBoundary
                : copy.launchManualBoundary}
          </p>
        </CardContent>
      </Card>
    </aside>
  );
}

export { RunLaunchPanel };
