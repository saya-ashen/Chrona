"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { textareaClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type {
  WorkbenchComposer,
  WorkbenchCopy,
  WorkPageData,
} from "./work-page-types";

type WorkbenchComposerCardProps = {
  className?: string;
  composer: WorkbenchComposer | null;
  currentIntervention?: WorkPageData["currentIntervention"] | null;
  currentStepTitle?: string | null;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: (value: string) => Promise<boolean | void> | boolean | void;
  quickPrompts: string[];
  errorMessage: string | null;
  isPending: boolean;
  passiveDescription: string;
  passiveActions: string;
  copy: WorkbenchCopy;
  composerResetKey: number;
  runId?: string | null;
};

function shouldSubmitFromEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey) {
    return false;
  }

  const nativeEvent =
    event.nativeEvent as KeyboardEvent<HTMLTextAreaElement>["nativeEvent"] & {
      isComposing?: boolean;
      keyCode?: number;
    };

  if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
    return false;
  }

  event.preventDefault();
  return true;
}

function renderActionWorkspace(
  currentIntervention: WorkPageData["currentIntervention"],
  currentStepTitle: string | null,
  copy: WorkbenchCopy,
) {
  if (!currentIntervention) {
    return null;
  }

  const evidence = currentIntervention.evidence ?? [];

  const shell = (title: string, body: ReactNode) => (
    <div className="rounded-[18px] border border-border/70 bg-background/75 px-3.5 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info">{copy.actionCurrentAction}</StatusBadge>
        {currentStepTitle ? <StatusBadge tone="warning">{currentStepTitle}</StatusBadge> : null}
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">{currentIntervention.actionLabel}</p>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
          <div className="mt-2">{body}</div>
        </div>
      </div>
    </div>
  );

  switch (currentIntervention.kind) {
    case "input":
      return shell(
        copy.actionInputTitle,
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{currentIntervention.description}</p>
          {evidence.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {evidence.map((item) => (
                <div
                  key={`${item.label}-${item.value}`}
                  className="rounded-full border border-border/70 bg-muted/[0.24] px-3 py-1.5 text-xs text-foreground"
                >
                  <span className="font-medium">{item.label}：</span>
                  <span>{item.value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>,
      );
    case "approval":
      return shell(
        copy.actionApprovalTitle,
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{currentIntervention.description}</p>
          {(currentIntervention.approvals?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {currentIntervention.approvals?.map((approval) => (
                <div
                  key={approval.id}
                  className="rounded-2xl border border-border/70 bg-muted/[0.24] px-3 py-2"
                >
                  <p className="font-medium text-foreground">{approval.title}</p>
                  {approval.summary ? <p className="mt-1 text-sm text-muted-foreground">{approval.summary}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p>{currentIntervention.whyNow}</p>
          )}
        </div>,
      );
    case "retry":
      return shell(
        copy.actionRetryTitle,
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{currentIntervention.whyNow}</p>
          {evidence.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5">
              {evidence.map((item) => (
                <li key={`${item.label}-${item.value}`}>{item.label}：{item.value}</li>
              ))}
            </ul>
          ) : null}
        </div>,
      );
    case "review":
      return shell(
        copy.actionReviewTitle,
        <p className="text-sm text-muted-foreground">{currentIntervention.whyNow}</p>,
      );
    case "observe":
      return shell(
        copy.actionObserveTitle,
        <p className="text-sm text-muted-foreground">{currentIntervention.description}</p>,
      );
    default:
      return shell(
        copy.actionDefaultTitle,
        <p className="text-sm text-muted-foreground">{currentIntervention.description}</p>,
      );
  }
}

export function WorkbenchComposerCard({
  className,
  composer,
  currentIntervention = null,
  currentStepTitle = null,
  composerValue,
  onComposerChange,
  onSubmit,
  quickPrompts,
  errorMessage,
  isPending,
  passiveDescription,
  passiveActions,
  copy,
  composerResetKey,
  runId,
}: WorkbenchComposerCardProps) {
  async function handleSubmit() {
    const inputText = composerValue.trim();
    const didSucceed = await onSubmit(inputText);

    if (didSucceed) {
      onComposerChange("");
    }
  }

  if (!composer) {
    return (
      <section
        className={cn(
          "rounded-[24px] border border-border/70 bg-card p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xl font-semibold text-foreground">需要人工输入</h3>
          <StatusBadge tone="success">已同步</StatusBadge>
        </div>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          <p>{passiveDescription}</p>
          <p className="text-xs text-muted-foreground/80">{passiveActions}</p>
        </div>
      </section>
    );
  }

  return (
    <form
      aria-label={copy.inputArea}
      key={`workbench-${composerResetKey}-${runId ?? "none"}-${composer.mode}`}
      className={cn(
        "min-w-0 max-h-[min(34vh,360px)] overflow-y-auto rounded-[24px] border border-border/70 bg-card p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold text-foreground">需要人工输入</h3>
            <StatusBadge tone="warning">阻塞中</StatusBadge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{composer.statusHint}</p>
        </div>
        <span className="text-xs text-muted-foreground">{copy.keyboardHint}</span>
      </div>

      <div className="mt-4">{renderActionWorkspace(currentIntervention, currentStepTitle, copy)}</div>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-red-300/70 bg-red-500/10 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <textarea
        aria-label={composer.inputLabel}
        name="message"
        rows={2}
        required
        value={composerValue}
        placeholder={composer.placeholder}
        onChange={(event) => onComposerChange(event.target.value)}
        onKeyDown={(event) => {
          if (shouldSubmitFromEnter(event)) {
            void handleSubmit();
          }
        }}
        className={cn(
          textareaClassName,
          "mt-4 min-h-28 w-full min-w-0 resize-none rounded-[18px] border-border/80 bg-background px-4 py-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/70",
        )}
      />

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{composerValue.length}/2000</span>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {quickPrompts.length > 0 ? (
            <span className="flex items-center pr-1 text-xs text-muted-foreground">
              {copy.quickPrompts}
            </span>
          ) : null}
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className:
                  "rounded-full border-border/70 bg-muted/[0.2] text-foreground hover:bg-muted/50",
              })}
              onClick={() =>
                onComposerChange(
                  composerValue.trim()
                    ? `${composerValue.trim()}\n${prompt}`
                    : prompt,
                )
              }
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              void handleSubmit();
            }}
            className={buttonVariants({
              variant: composer.submitVariant ?? "default",
              size: "sm",
              className: cn(
                "h-11 rounded-xl disabled:opacity-60",
                composer.submitVariant === "outline"
                  ? "border-border/70 bg-background text-foreground hover:bg-muted/40"
                  : "bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.25)]",
              ),
            })}
          >
            {composer.submitLabel}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => onComposerChange("")}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "h-11 rounded-xl border-border/70 bg-background text-foreground hover:bg-muted/40",
            })}
          >
            清空
          </button>
        </div>
      </div>
    </form>
  );
}
