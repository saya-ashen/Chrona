"use client";

import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { inputClassName } from "@/components/ui/field";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { cn } from "@/lib/utils";

import type { WorkPageData } from "./work-page-types";
import { DEFAULT_WORK_PAGE_COPY } from "./work-page-copy";
import {
  formatDateTime,
  getScheduleStatusLabel,
  getTaskLifecycleLabel,
  isInternalAppHref,
  isSafeExternalHref,
  parseDateInputForSubmission,
} from "./work-page-formatters";

type LatestResultClosureProps = {
  data: WorkPageData;
  copy?: typeof DEFAULT_WORK_PAGE_COPY;
  isPending: boolean;
  errorMessage?: string | null;
  onAcceptResult: () => Promise<void>;
  onRetry: () => Promise<void>;
  onMarkTaskDone: () => Promise<void>;
  onReopenTask: () => Promise<void>;
  onCreateFollowUp: (input: {
    title: string;
    dueAt: Date | null;
  }) => Promise<void>;
};

function getFollowUpDefaultTitle(
  taskTitle: string,
  copy: typeof DEFAULT_WORK_PAGE_COPY,
) {
  return `${taskTitle} - ${copy.followUpDefaultSuffix}`;
}

export function LatestResultClosure({
  data,
  copy = DEFAULT_WORK_PAGE_COPY,
  isPending,
  errorMessage = null,
  onAcceptResult,
  onRetry,
  onMarkTaskDone,
  onReopenTask,
  onCreateFollowUp,
}: LatestResultClosureProps) {
  const hasClosureContent =
    data.closure.resultAccepted ||
    data.closure.isDone ||
    data.closure.canMarkDone ||
    data.closure.canCreateFollowUp ||
    data.closure.canReopen ||
    Boolean(data.closure.latestFollowUp);

  const hasActionContent =
    data.closure.canAcceptResult ||
    data.closure.canRetry ||
    Boolean(data.latestOutput.href);

  async function handleCreateFollowUp(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    const dueAtValue = String(formData.get("dueAt") ?? "").trim();

    if (!title) {
      throw new Error(copy.invalidFollowUpTitle);
    }

    let dueAt: Date | null = null;

    if (dueAtValue) {
      const parsedDueAt = parseDateInputForSubmission(dueAtValue);
      if (!parsedDueAt) {
        throw new Error(copy.invalidFollowUpDate);
      }
      dueAt = parsedDueAt;
    }

    await onCreateFollowUp({ title, dueAt });
  }

  return (
    <div className="space-y-5">
      {errorMessage ? (
        <p
          role="alert"
          className="rounded-md border border-red-300/60 bg-red-500/10 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}

      {hasClosureContent ? (
        <div className="space-y-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {copy.closureStatusTitle}
          </p>

          {data.closure.resultAccepted || data.closure.isDone ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.closure.resultAccepted ? (
                <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 text-sm">
                  <p className="font-medium text-foreground">
                    {copy.resultAccepted}
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    {copy.closureAcceptedAt}:{" "}
                    {formatDateTime(data.closure.acceptedAt)}
                  </p>
                </div>
              ) : null}

              {data.closure.isDone ? (
                <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 text-sm">
                  <p className="font-medium text-foreground">{copy.taskDone}</p>
                  <p className="mt-2 text-muted-foreground">
                    {copy.closureDoneAt}: {formatDateTime(data.closure.doneAt)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {data.closure.latestFollowUp ? (
            <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 text-sm">
              <p className="font-medium text-foreground">
                {copy.latestFollowUp}
              </p>
              <p className="mt-2 text-foreground">
                {data.closure.latestFollowUp.title}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge>
                  {`${copy.latestFollowUpStatus}: ${getTaskLifecycleLabel(
                    data.closure.latestFollowUp.status,
                  )}`}
                </StatusBadge>
                <StatusBadge>
                  {`${copy.latestFollowUpSchedule}: ${getScheduleStatusLabel(
                    data.closure.latestFollowUp.scheduleStatus,
                  )}`}
                </StatusBadge>
              </div>

              {data.closure.latestFollowUp.createdAt ? (
                <p className="mt-3 text-muted-foreground">
                  {copy.latestFollowUpCreatedAt}:{" "}
                  {formatDateTime(data.closure.latestFollowUp.createdAt)}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {data.closure.canMarkDone || data.closure.canReopen ? (
              <div className="space-y-3 rounded-[22px] border border-border/60 bg-background/70 p-4">
                {data.closure.canMarkDone ? (
                  <form
                    action={async () => {
                      await onMarkTaskDone();
                    }}
                  >
                    <button
                      type="submit"
                      disabled={isPending}
                      className={buttonVariants({
                        variant: "outline",
                        className: "disabled:opacity-60",
                      })}
                    >
                      {copy.markTaskDone}
                    </button>
                  </form>
                ) : null}

                {data.closure.canReopen ? (
                  <form
                    action={async () => {
                      await onReopenTask();
                    }}
                  >
                    <button
                      type="submit"
                      disabled={isPending}
                      className={buttonVariants({
                        variant: "outline",
                        className: "disabled:opacity-60",
                      })}
                    >
                      {copy.reopenTask}
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}

            {data.closure.canCreateFollowUp ? (
              <form
                action={handleCreateFollowUp}
                className="space-y-3 rounded-[22px] border border-border/60 bg-background/70 p-4"
              >
                <p className="text-sm font-medium text-foreground">
                  {copy.followUpOptional}
                </p>
                <p className="text-sm text-muted-foreground">
                  {copy.followUpOptionalDescription}
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      htmlFor="follow-up-title"
                      className="text-sm font-medium text-foreground"
                    >
                      {copy.followUpTitle}
                    </label>
                    <input
                      id="follow-up-title"
                      type="text"
                      name="title"
                      required
                      defaultValue={getFollowUpDefaultTitle(
                        data.taskShell.title,
                        copy,
                      )}
                      className={inputClassName}
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="follow-up-due"
                      className="text-sm font-medium text-foreground"
                    >
                      {copy.followUpDue}
                    </label>
                    <input
                      id="follow-up-due"
                      type="date"
                      name="dueAt"
                      className={inputClassName}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isPending}
                  className={buttonVariants({
                    variant: "outline",
                    className: "disabled:opacity-60",
                  })}
                >
                  {copy.createFollowUp}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {hasActionContent ? (
        <div className="space-y-3 border-t border-border/60 pt-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {copy.resultActionsTitle}
          </p>

          <div className="flex flex-wrap gap-2">
            {data.closure.canAcceptResult ? (
              <form
                action={async () => {
                  await onAcceptResult();
                }}
              >
                <button
                  type="submit"
                  disabled={isPending}
                  className={buttonVariants({
                    variant: "default",
                    className: "disabled:opacity-60",
                  })}
                >
                  {copy.acceptResult}
                </button>
              </form>
            ) : null}

            {data.closure.canRetry ? (
              <form
                action={async () => {
                  await onRetry();
                }}
              >
                <button
                  type="submit"
                  disabled={isPending}
                  className={buttonVariants({
                    variant: "outline",
                    className: "disabled:opacity-60",
                  })}
                >
                  {copy.retryRun}
                </button>
              </form>
            ) : null}

            {data.latestOutput.href &&
            isInternalAppHref(data.latestOutput.href) ? (
              <LocalizedLink
                href={data.latestOutput.href}
                className={buttonVariants({ variant: "outline" })}
              >
                {copy.openArtifact}
              </LocalizedLink>
            ) : data.latestOutput.href &&
              isSafeExternalHref(data.latestOutput.href) ? (
              <a
                href={data.latestOutput.href}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                {copy.openArtifact}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
