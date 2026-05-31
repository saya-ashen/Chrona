"use client";

import { useForm } from "react-hook-form";
import type { AiSidebarMessage } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n/react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ConversationFormValues = {
  message: string;
};

export function ConversationThread({ messages, onSubmit }: { messages: AiSidebarMessage[]; onSubmit: (message: string) => void }) {
  const { t } = useI18n();
  const form = useForm<ConversationFormValues>({
    defaultValues: {
      message: "",
    },
    mode: "onChange",
  });
  const draft = form.watch("message");

  function handleSubmit(values: ConversationFormValues) {
    const message = values.message.trim();
    if (!message) return;

    onSubmit(message);
    form.reset();
  }

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm" aria-labelledby="ai-conversation-title">
      <h2 id="ai-conversation-title" className="text-sm font-semibold text-foreground">{t("components.globalAiSidebar.conversation")}</h2>
      <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="rounded-2xl bg-muted/50 px-3 py-3 text-sm text-muted-foreground">{t("components.globalAiSidebar.emptyConversation")}</p>
        ) : messages.map((message) => (
          <article key={message.id} className={cn("rounded-2xl px-3 py-2 text-sm", message.role === "user" ? "bg-primary-soft text-primary" : "bg-muted/50 text-foreground", message.responseKind === "error" && "bg-destructive/10 text-destructive")}>
            {message.content}
          </article>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        <FieldGroup className="min-w-0 flex-1 gap-0">
          <Field data-invalid={Boolean(form.formState.errors.message)}>
            <FieldLabel className="sr-only" htmlFor="global-ai-follow-up">{t("components.globalAiSidebar.followUpPlaceholder")}</FieldLabel>
            <Input
              {...form.register("message", { required: true })}
              aria-invalid={Boolean(form.formState.errors.message)}
              id="global-ai-follow-up"
              placeholder={t("components.globalAiSidebar.followUpPlaceholder")}
              className="rounded-2xl bg-background"
            />
            {form.formState.errors.message ? <FieldError errors={[form.formState.errors.message]} /> : null}
          </Field>
        </FieldGroup>
        <Button type="submit" disabled={!draft.trim()}>{t("components.globalAiSidebar.send")}</Button>
      </form>
    </section>
  );
}
