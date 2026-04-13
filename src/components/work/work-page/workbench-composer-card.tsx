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
  onSubmit: (value: string) => Promise<void> | void;
  quickPrompts: string[];
  errorMessage: string | null;
  isPending: boolean;
  passiveDescription: string;
  passiveActions: string;
  copy: WorkbenchCopy;
  composerResetKey: number;
  runId?: string | null;
};

function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  const nativeEvent =
    event.nativeEvent as KeyboardEvent<HTMLTextAreaElement>["nativeEvent"] & {
      isComposing?: boolean;
      keyCode?: number;
    };

  if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
    return;
  }

  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
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
  if (!composer) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-foreground/65">
          {copy.inputArea}
        </p>
        <p className="text-sm leading-7 text-primary-foreground/78">
          {passiveDescription}
        </p>
        <p className="text-xs text-primary-foreground/60">{passiveActions}</p>
      </div>
    );
  }

  return (
    <form
      key={`workbench-${composerResetKey}-${runId ?? "none"}-${composer.mode}`}
      action={async () => {
        const inputText = composerValue.trim();

        if (!inputText) {
          return;
        }

        await onSubmit(inputText);
      }}
      className="min-w-0 space-y-4"
    >
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-foreground/65">
          {copy.inputArea}
        </p>
        <p className="text-sm text-primary-foreground/78">
          {composer.description || copy.workbenchDescription}
        </p>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-md border border-red-300/60 bg-red-500/10 px-3 py-2 text-sm text-red-100"
        >
          {errorMessage}
        </p>
      ) : null}

      <p className="text-xs text-primary-foreground/60">
        {copy.taskArrangementHint}
      </p>

      <textarea
        aria-label={composer.inputLabel}
        name="message"
        rows={6}
        required
        value={composerValue}
        placeholder={composer.placeholder}
        onChange={(event) => onComposerChange(event.target.value)}
        onKeyDown={handleComposerKeyDown}
        className={cn(
          textareaClassName,
          "min-h-32 w-full min-w-0 resize-y border-white/12 bg-black/20 text-primary-foreground placeholder:text-primary-foreground/35",
        )}
      />

      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap gap-2">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className:
                  "border-white/12 bg-white/[0.04] text-primary-foreground hover:bg-white/[0.08]",
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-primary-foreground/60">
            {composer.statusHint} · {copy.keyboardHint}
          </p>

          <button
            type="submit"
            disabled={isPending}
            className={buttonVariants({
              variant: composer.submitVariant ?? "default",
              size: "lg",
              className: cn(
                "disabled:opacity-60",
                composer.submitVariant === "outline"
                  ? "border-white/12 bg-white/[0.04] text-primary-foreground hover:bg-white/[0.08]"
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
