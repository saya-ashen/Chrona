"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, ChevronUp, ListPlus, MessageCircle } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "@shared/ui";
import { TaskResultFollowUpPanel } from "./task-result-follow-up-panel";
import type { TaskData } from "../model/task-workspace-types";
import type { TaskWorkspaceDisplayState } from "../model/task-workspace-interaction";

function formatResultReviewCopy(
  template: string | undefined,
  values: Record<string, number>,
  fallback: string,
) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template ?? fallback,
  );
}

// Result review states and their mutually exclusive actions form one runtime-control surface.
// eslint-disable-next-line max-lines-per-function, complexity
function ResultLifecyclePanel({
  taskId,
  review,
  copy,
  onAcceptResult,
  onRequestChanges,
  isAcceptingResult = false,
  acceptResultError,
  createGoalAction,
  goalKnowledge,
}: {
  taskId: string;
  review: NonNullable<TaskWorkspaceDisplayState["resultReview"]>;
  copy: Record<string, string | undefined>;
  onAcceptResult?: () => Promise<void> | void;
  onRequestChanges: () => void;
  isAcceptingResult?: boolean;
  acceptResultError?: string | null;
  createGoalAction?: ReactNode;
  goalKnowledge?: TaskData["goalKnowledge"];
}) {
  const isAccepted = review.phase === "accepted";
  const [isAcceptedExpanded, setIsAcceptedExpanded] = useState(false);
  const [acceptedFollowUpMode, setAcceptedFollowUpMode] = useState<
    "ask" | "create_task"
  >("ask");
  const completion = review.completion;
  const acceptDisabled =
    isAcceptingResult || !review.decision.canAccept || !onAcceptResult;
  const disabledReason =
    !review.decision.canAccept || !onAcceptResult
      ? (copy.acceptResultUnavailable ??
        "A completed result is required before it can be accepted.")
      : null;


  const openAcceptedFollowUp = (mode: "ask" | "create_task") => {
    setAcceptedFollowUpMode(mode);
    setIsAcceptedExpanded(true);
  };

  return (
    <header
      id="result-follow-up-composer"
      className={`sticky top-0 z-20 scroll-mt-24 rounded-2xl border border-primary/25 bg-card px-4 shadow-sm sm:px-5 ${isAccepted && !isAcceptedExpanded ? "py-3" : "py-4"}`}
      data-ui-surface-kind="runtime-control"
      data-testid="result-lifecycle-panel"
      data-state={
        isAccepted
          ? "accepted"
          : isAcceptingResult
            ? "loading"
            : acceptResultError
              ? "error"
              : "default"
      }
    >
      <div className={isAccepted && !isAcceptedExpanded ? "flex flex-col gap-2" : "flex flex-col gap-4"}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div>
              <h2 className="flex items-center gap-2 font-heading text-xl font-semibold tracking-[-0.025em] text-foreground">
                {isAccepted ? (
                  <CheckCircle2 className="size-5 text-success" aria-hidden />
                ) : null}
                {isAccepted
                  ? (copy.resultAcceptedTitle ?? "Result accepted")
                  : (copy.resultReadyTitle ?? "Result ready")}
              </h2>
              {!isAccepted || isAcceptedExpanded ? (
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {isAccepted
                    ? (copy.resultAcceptedDescription ??
                      "Task closed. Ask about this result or create the next task without losing context.")
                    : (copy.resultReadyDescription ??
                      "Execution completed. Review the final result, then accept it or request changes.")}
                </p>
              ) : null}
            </div>
            {goalKnowledge && goalKnowledge.read.length > 0 ? (
              <div className="rounded-lg border bg-muted/25 p-3 text-sm">
                <p className="font-medium">
                  {copy.goalKnowledgeUsed ?? "Goal knowledge used"}
                </p>
                <ul className="mt-2 space-y-1.5 text-muted-foreground">
                  {goalKnowledge.read.map((asset) => (
                    <li key={asset.ref}>
                      <span className="text-foreground/90">{asset.title}</span>{" "}
                      <span className="font-mono text-xs">
                        {(copy.goalKnowledgeVersion ?? "{ref} · captured v{version}")
                          .replace("{ref}", asset.ref)
                          .replace("{version}", String(asset.version))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!isAccepted || isAcceptedExpanded ? (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
              aria-label={
                copy.resultCompletionSummaryLabel ?? "Result completion summary"
              }
            >
              {completion.stepCount > 0 ? (
                <span>
                  {formatResultReviewCopy(
                    copy.resultCompletionSteps,
                    {
                      completed: completion.completedSteps,
                      total: completion.stepCount,
                    },
                    `${completion.completedSteps}/${completion.stepCount} steps completed`,
                  )}
                </span>
              ) : null}
              <span>
                {formatResultReviewCopy(
                  copy.resultCompletionArtifacts,
                  { count: completion.artifactCount },
                  `${completion.artifactCount} deliverables`,
                )}
              </span>
              <span
                className={
                  completion.hasDiagnostics
                    ? "font-medium text-warning-foreground"
                    : undefined
                }
              >
                {completion.hasDiagnostics
                  ? (copy.resultCompletionHasDiagnostics ??
                    "Diagnostics need review")
                  : (copy.resultCompletionNoDiagnostics ?? "No warnings")}
              </span>
            </div>
            ) : null}
            {acceptResultError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {acceptResultError}
              </p>
            ) : null}
            {disabledReason && !isAccepted ? (
              <p
                id="accept-result-disabled-reason"
                className="text-xs text-muted-foreground"
              >
                {disabledReason}
              </p>
            ) : null}
          </div>
          {isAccepted ? (
            <div
              className="flex shrink-0 flex-wrap items-center gap-1.5"
              role="group"
              aria-label={
                copy.acceptedResultActionsLabel ?? "Accepted result actions"
              }
            >
              <Button
                type="button"
                variant="default"
                size="sm"
                className="shadow-sm"
                onClick={() => openAcceptedFollowUp("ask")}
              >
                <MessageCircle className="size-4" aria-hidden />
                {copy.followUpAskOnly ?? "Ask a follow-up"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="border border-primary/20 bg-primary/10 text-primary shadow-sm hover:bg-primary/15"
                onClick={() => openAcceptedFollowUp("create_task")}
              >
                <ListPlus className="size-4" aria-hidden />
                {copy.followUpCreateTask ?? "Create next task"}
              </Button>
              {createGoalAction}
              {isAcceptedExpanded ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded="true"
                  aria-controls="accepted-result-follow-up"
                  onClick={() => setIsAcceptedExpanded(false)}
                >
                  <ChevronUp className="size-4" aria-hidden />
                  {copy.collapseAcceptedResult ?? "Collapse"}
                </Button>
              ) : null}
            </div>
          ) : (
            <div
              className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row"
              aria-label={
                copy.resultReviewActionsLabel ?? "Result review actions"
              }
            >
              <Button
                type="button"
                variant="outline"
                onClick={onRequestChanges}
                disabled={!review.decision.canRequestChanges}
              >
                {copy.requestResultChanges ?? "Request changes"}
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={() => void onAcceptResult?.()}
                disabled={acceptDisabled}
                aria-describedby={
                  disabledReason ? "accept-result-disabled-reason" : undefined
                }
              >
                {isAcceptingResult
                  ? (copy.acceptingResult ?? "Accepting result...")
                  : (copy.acceptResult ?? "Accept result")}
              </Button>
            </div>
          )}
        </div>

        {isAccepted && isAcceptedExpanded ? (
          <div id="accepted-result-follow-up">
            <TaskResultFollowUpPanel
              taskId={taskId}
              copy={copy}
              initialMode={acceptedFollowUpMode}
            />
          </div>
        ) : null}
      </div>
    </header>
  );
}

function RequestResultChangesCard({
  copy,
  instruction,
  onInstructionChange,
  onCancel,
  onSubmit,
  isSubmitting,
  error,
}: {
  copy: Record<string, string | undefined>;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  return (
    <Card
      className="border-warning/35 bg-warning/10 py-4"
      role="region"
      aria-label={copy.requestChangesTitle ?? "Request changes"}
      data-ui-surface-kind="runtime-control"
    >
      <CardHeader className="px-4 pb-1">
        <CardTitle className="font-heading text-lg">
          {copy.requestChangesTitle ?? "Request changes"}
        </CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          {copy.requestChangesDescription ??
            "Describe what is incorrect or missing. Chrona will rerun the final completed step with your feedback."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <label
          htmlFor="result-change-instruction"
          className="text-sm font-medium text-foreground"
        >
          {copy.requestChangesLabel ?? "What needs to change?"}
        </label>
        <Textarea
          id="result-change-instruction"
          autoFocus
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value)}
          placeholder={
            copy.requestChangesPlaceholder ??
            "Describe the corrections or missing information required in the final result."
          }
          className="min-h-28 bg-background"
        />
        {error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {copy.requestChangesCancel ?? "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || !instruction.trim()}
          >
            {isSubmitting
              ? (copy.requestChangesSubmitting ?? "Starting rerun...")
              : (copy.requestChangesSubmit ?? "Rerun final step")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export { ResultLifecyclePanel, RequestResultChangesCard };
