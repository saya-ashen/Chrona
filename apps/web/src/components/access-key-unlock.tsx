import { Controller, useForm } from "react-hook-form";
import { LockKeyhole } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";

import { Button, Checkbox, Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, Input } from "@shared/ui";

type AccessKeyUnlockProps = {
  onUnlock: (key: string, remember: boolean) => void;
};

type AccessKeyUnlockFormValues = {
  accessKey: string;
  remember: boolean;
};

export function AccessKeyUnlock({ onUnlock }: AccessKeyUnlockProps) {
  const { t } = useI18n();
  const form = useForm<AccessKeyUnlockFormValues>({
    defaultValues: {
      accessKey: "",
      remember: false,
    },
    mode: "onChange",
  });
  const key = form.watch("accessKey");

  function handleSubmit(values: AccessKeyUnlockFormValues) {
    onUnlock(values.accessKey.trim(), values.remember);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--primary-soft)_70%,var(--background))_0%,var(--canvas)_45%,var(--background)_100%)] px-4 py-10 text-foreground">
      <section className="w-full max-w-md rounded-[2rem] border border-border/60 bg-card/90 p-7 shadow-2xl shadow-primary/10 backdrop-blur sm:p-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LockKeyhole className="size-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{t("components.accessKeyUnlock.eyebrow")}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{t("components.accessKeyUnlock.title")}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("components.accessKeyUnlock.description")}</p>
          </div>
        </div>

        <form className="flex flex-col gap-4" onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}>
          <FieldGroup className="gap-4">
            <Controller
              name="accessKey"
              control={form.control}
              rules={{ required: t("components.accessKeyUnlock.keyLabel") }}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="gap-2">
                  <FieldLabel htmlFor={field.name}>{t("components.accessKeyUnlock.keyLabel")}</FieldLabel>
                  <Input
                    {...field}
                    autoFocus
                    aria-invalid={fieldState.invalid}
                    className="h-12 rounded-2xl bg-background text-base"
                    id={field.name}
                    placeholder={t("components.accessKeyUnlock.keyPlaceholder")}
                    type="password"
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />

            <Controller
              name="remember"
              control={form.control}
              render={({ field }) => (
                <Field orientation="horizontal" className="rounded-2xl border border-border/70 bg-muted/50 p-3 text-sm text-muted-foreground">
                  <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                  <FieldContent>
                    <FieldLabel className="font-medium text-foreground">{t("components.accessKeyUnlock.rememberLabel")}</FieldLabel>
                    <FieldDescription>{t("components.accessKeyUnlock.rememberHint")}</FieldDescription>
                  </FieldContent>
                </Field>
              )}
            />
          </FieldGroup>

          <Button
            className="h-12 rounded-2xl text-base"
            disabled={!key.trim()}
            type="submit"
          >
            {t("components.accessKeyUnlock.submit")}
          </Button>
        </form>
      </section>
    </main>
  );
}
