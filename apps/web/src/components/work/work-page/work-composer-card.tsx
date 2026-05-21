"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  WorkComposer,
  WorkCopy,
  WorkPageData,
} from "./work-page-types";

type WorkComposerCardProps = {
  className?: string;
  composer: WorkComposer | null;
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
  copy: WorkCopy;
  composerResetKey: number;
  runId?: string | null;
};

type WorkComposerFormValues = {
  message: string;
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

function renderActionPanel(
  currentIntervention: WorkPageData["currentIntervention"],
  currentStepTitle: string | null,
  copy: WorkCopy,
) {
  if (!currentIntervention) {
    return null;
  }

  const evidence = currentIntervention.evidence ?? [];

  const shell = (title: string, body: ReactNode) => (
    <div className="rounded-[18px] border border-border/70 bg-background/75 px-3.5 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{copy.actionCurrentAction}</Badge>
        {currentStepTitle ? <Badge variant="secondary">{currentStepTitle}</Badge> : null}
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

export function WorkComposerCard({
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
}: WorkComposerCardProps) {
  const form = useForm<WorkComposerFormValues>({
    defaultValues: {
      message: composerValue,
    },
    mode: "onChange",
    values: {
      message: composerValue,
    },
  });

  async function handleSubmit(values: WorkComposerFormValues) {
    const inputText = values.message.trim();
    const didSucceed = await onSubmit(inputText);

    if (didSucceed) {
      onComposerChange("");
      form.reset({ message: "" });
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
          <Badge variant="secondary">已同步</Badge>
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
      key={`work-${composerResetKey}-${runId ?? "none"}-${composer.mode}`}
      onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      className={cn(
        "min-w-0 max-h-[min(34vh,360px)] overflow-y-auto rounded-[24px] border border-border/70 bg-card p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold text-foreground">需要人工输入</h3>
            <Badge variant="secondary">阻塞中</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{composer.statusHint}</p>
        </div>
        <span className="text-xs text-muted-foreground">{copy.keyboardHint}</span>
      </div>

      <div className="mt-4">{renderActionPanel(currentIntervention, currentStepTitle, copy)}</div>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-red-300/70 bg-red-500/10 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <FieldGroup className="mt-4 gap-0">
        <Controller
          name="message"
          control={form.control}
          rules={{ required: true }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={field.name}>{composer.inputLabel}</FieldLabel>
              <Textarea
                {...field}
                aria-invalid={fieldState.invalid}
                id={field.name}
                rows={2}
                placeholder={composer.placeholder}
                onChange={(event) => {
                  field.onChange(event);
                  onComposerChange(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (shouldSubmitFromEnter(event)) {
                    void form.handleSubmit(handleSubmit)();
                  }
                }}
                className="min-h-28 w-full min-w-0 resize-none rounded-[18px] border-border/80 bg-background px-4 py-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/70"
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </FieldGroup>

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
            <Button
              key={prompt}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() =>
                onComposerChange(
                  composerValue.trim()
                    ? `${composerValue.trim()}\n${prompt}`
                    : prompt,
                )
              }
            >
              {prompt}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="submit"
            disabled={isPending}
            variant={composer.submitVariant ?? "default"}
            size="default"
            className="h-11 rounded-xl"
          >
            {composer.submitLabel}
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() => onComposerChange("")}
            variant="outline"
            size="default"
            className="h-11 rounded-xl"
          >
            清空
          </Button>
        </div>
      </div>
    </form>
  );
}
