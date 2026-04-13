"use client";

import type { KeyboardEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { textareaClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { WorkbenchComposer, WorkbenchCopy } from "./work-page-types";

type WorkbenchComposerCardProps = {
  composer: WorkbenchComposer | null;
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

export function WorkbenchComposerCard({
  composer,
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
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{passiveDescription}</p>
        <p className="text-xs text-muted-foreground/80">{passiveActions}</p>
      </div>
    );
  }

  return (
    <form
      aria-label={copy.inputArea}
      key={`workbench-${composerResetKey}-${runId ?? "none"}-${composer.mode}`}
      className="min-w-0 space-y-1.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{composer.statusHint}</span>
        <span>{copy.keyboardHint}</span>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-md border border-red-300/70 bg-red-500/10 px-3 py-2 text-sm text-red-700"
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
          "min-h-16 w-full min-w-0 resize-none border-border/80 bg-background px-3 py-2.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/70",
        )}
      />

      <div className="flex items-start justify-between gap-2">
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
                  "border-border/70 bg-muted/[0.2] text-foreground hover:bg-muted/50",
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

        <div className="shrink-0">
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
                "disabled:opacity-60",
                composer.submitVariant === "outline"
                  ? "border-border/70 bg-background text-foreground hover:bg-muted/40"
                  : "",
              ),
            })}
          >
            {composer.submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
