import { Controller } from "react-hook-form";
import { Button, FieldGroup, Input, Textarea } from "@shared/ui";
import { RECURRENCE_PRESETS, type RecurrencePreset } from "../recurrence-presets";
import { TIME_OPTIONS } from "./task-config-form-conversions";
import { TaskAutomationSection, TaskConfigDatePicker, TaskConfigField, TaskConfigSection, TaskConfigSelect } from "./task-config-form-controls";
import { RuntimeFieldList } from "./task-config-runtime-fields";
import type { TaskConfigCopy, TaskConfigFormInput, TaskConfigFormProps, TaskConfigPreset } from "./task-config-form-types";
import type { TaskConfigFormView } from "./task-config-form-state";

type FormSectionProps = {
  compact: boolean;
  copy: TaskConfigCopy;
  form: TaskConfigFormView;
  isPending: boolean;
  lockedFieldsHint: string | undefined;
  isScheduleLocked: boolean;
  isTitleLocked: boolean;
  sourceDescription: string | null | undefined;
  sourceDescriptionLabel: string | undefined;
};

type FooterProps = Pick<TaskConfigFormProps, "footerActions" | "hideFooter" | "isPending" | "pendingLabel" | "submitLabel">;

function TaskBasicsSection({ compact, copy, form, isPending, isTitleLocked, lockedFieldsHint }: FormSectionProps) {
  return (
    <TaskConfigSection title={copy.basics} info={isTitleLocked ? lockedFieldsHint : undefined}>
      <div className={compact ? "grid gap-3" : "grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]"}>
        <Controller name="title" control={form.control} rules={{ required: copy.title }} render={({ field, fieldState }) => (
          <TaskConfigField label={copy.title} htmlFor={field.name} invalid={fieldState.invalid} error={fieldState.error} className="text-xs text-foreground">
            <Input {...field} aria-invalid={fieldState.invalid} id={field.name} disabled={isPending || isTitleLocked} placeholder={copy.titlePlaceholder} />
          </TaskConfigField>
        )} />
        <TaskConfigField label={copy.priority} htmlFor="task-config-priority" className="text-xs text-foreground">
          <TaskConfigSelect name="priority" id="task-config-priority" value={form.formState.priority} options={(["Low", "Medium", "High", "Urgent"] as const).map((priority) => ({ value: priority, label: copy.priorities[priority] }))} onValueChange={(value) => form.setValue("priority", value as TaskConfigFormInput["priority"], { shouldDirty: true })} />
        </TaskConfigField>
      </div>
    </TaskConfigSection>
  );
}

function TaskDescriptionSection({ compact, copy, form, sourceDescription, sourceDescriptionLabel }: Pick<FormSectionProps, "compact" | "copy" | "form" | "sourceDescription" | "sourceDescriptionLabel">) {
  const sourceDescriptionText = sourceDescription?.trim() ?? "";
  const hasSourceDescription = sourceDescriptionText.length > 0;
  const descriptionPlaceholder = sourceDescription !== undefined ? copy.chronaNotesPlaceholder : copy.descriptionPlaceholder;
  return (
    <Controller name="description" control={form.control} render={({ field, fieldState }) => (
      <TaskConfigSection title={copy.description} compact={compact}>
        {hasSourceDescription ? <div className="mb-3 space-y-1.5"><p className="text-xs font-medium text-muted-foreground">{sourceDescriptionLabel ?? copy.calendarDescription}</p><p className={compact ? "min-h-16 select-text whitespace-pre-wrap rounded-md border border-dashed border-border/70 bg-muted/45 px-3 py-2 text-sm text-muted-foreground shadow-inner cursor-default" : "min-h-20 select-text whitespace-pre-wrap rounded-md border border-dashed border-border/70 bg-muted/45 px-3 py-2 text-sm text-muted-foreground shadow-inner cursor-default"}>{sourceDescriptionText}</p></div> : null}
        <TaskConfigField label={copy.description} htmlFor={!compact ? field.name : undefined} invalid={fieldState.invalid} error={fieldState.error} hideTitle className="gap-2 text-xs text-foreground">
          <Textarea {...field} aria-invalid={fieldState.invalid} id={!compact ? field.name : undefined} rows={compact ? 3 : 5} placeholder={descriptionPlaceholder} className="bg-background" />
        </TaskConfigField>
      </TaskConfigSection>
    )} />
  );
}

function TaskScheduleSection({ copy, form, isScheduleLocked, lockedFieldsHint }: Pick<FormSectionProps, "copy" | "form" | "isScheduleLocked" | "lockedFieldsHint">) {
  const { formState, scheduleDurationLabel, setValue } = form;
  const setScheduleValue = (name: "scheduledDate" | "scheduledStartTime" | "scheduledEndTime", value: string) => {
    if (!isScheduleLocked) setValue(name, value, { shouldDirty: true });
  };
  return (
    <TaskConfigSection title={copy.schedule} info={isScheduleLocked ? lockedFieldsHint : undefined} actions={scheduleDurationLabel ? <span className="rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary">{scheduleDurationLabel}</span> : null}>
      <p className="text-xs text-muted-foreground">{copy.scheduleHint}</p>
      <FieldGroup className="grid gap-2 sm:grid-cols-3">
        <TaskConfigField label={copy.scheduleDate} className="text-xs text-foreground"><TaskConfigDatePicker name="scheduledDate" value={formState.scheduledDate} placeholder={copy.scheduleDate} disabled={isScheduleLocked} onValueChange={(value) => setScheduleValue("scheduledDate", value)} /></TaskConfigField>
        <TaskConfigField label={copy.scheduleStart} className="text-xs text-foreground"><TaskConfigSelect name="scheduledStartTime" value={formState.scheduledStartTime} placeholder="--" options={TIME_OPTIONS.map((time) => ({ value: time, label: time }))} disabled={isScheduleLocked} onValueChange={(value) => setScheduleValue("scheduledStartTime", value)} /></TaskConfigField>
        <TaskConfigField label={copy.scheduleEnd} className="text-xs text-foreground"><TaskConfigSelect name="scheduledEndTime" value={formState.scheduledEndTime} placeholder="--" options={TIME_OPTIONS.map((time) => ({ value: time, label: time }))} disabled={isScheduleLocked} onValueChange={(value) => setScheduleValue("scheduledEndTime", value)} /></TaskConfigField>
      </FieldGroup>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <TaskConfigField label={copy.recurrence} hint={copy.recurrenceDescription} className="text-xs text-foreground"><TaskConfigSelect name="recurrenceMode" value={formState.recurrenceMode} options={RECURRENCE_PRESETS.map((preset) => ({ value: preset, label: copy.recurrencePresets[preset] }))} disabled={isScheduleLocked} onValueChange={(value) => { if (!isScheduleLocked) setValue("recurrenceMode", value as RecurrencePreset, { shouldDirty: true }); }} /></TaskConfigField>
        {formState.recurrenceMode === "custom" ? <TaskConfigField label={copy.recurrenceCustomLabel} className="text-xs text-foreground"><Input name="recurrenceCustomRule" value={formState.recurrenceCustomRule} disabled={isScheduleLocked} placeholder={copy.recurrenceCustomPlaceholder} onChange={(event) => setValue("recurrenceCustomRule", event.target.value, { shouldDirty: true })} /></TaskConfigField> : null}
      </div>
    </TaskConfigSection>
  );
}

function TaskAutomationSectionGroup({ compact = false, copy, form, isPending, availableAiClients = [], disableAiClientSelection = false, aiClientSelectionDisabledHint }: Pick<FormSectionProps, "copy" | "form" | "isPending"> & Pick<TaskConfigFormProps, "availableAiClients" | "disableAiClientSelection" | "aiClientSelectionDisabledHint"> & { compact?: boolean }) {
  const { formState, setValue } = form;
  const aiClientOptions = [{ value: "", label: copy.defaultAiProvider }, ...availableAiClients.map((client) => ({ value: client.id, label: client.enabled ? client.name : `${client.name} (disabled)` }))];
  const automation = <TaskAutomationSection compact={compact} copy={copy} autoPlanGeneration={formState.autoPlanGeneration} autoExecute={formState.autoExecute} autoPlanGenerationTiming={formState.autoPlanGenerationTiming} autoExecuteTiming={formState.autoExecuteTiming} onAutoPlanGenerationChange={(checked) => setValue("autoPlanGeneration", checked, { shouldDirty: true })} onAutoExecuteChange={(checked) => { setValue("autoExecute", checked, { shouldDirty: true }); if (checked) setValue("autoPlanGeneration", true, { shouldDirty: true }); }} onAutoPlanGenerationTimingChange={(value) => setValue("autoPlanGenerationTiming", value, { shouldDirty: true })} onAutoExecuteTimingChange={(value) => setValue("autoExecuteTiming", value, { shouldDirty: true })} />;
  const provider = aiClientOptions.length > 1 ? <TaskConfigField label={copy.aiProvider} hint={aiClientSelectionDisabledHint ?? copy.aiProviderHint} className="text-xs text-foreground"><TaskConfigSelect name="aiClientId" id={!compact ? "task-config-ai-client" : undefined} value={formState.aiClientId} options={aiClientOptions} disabled={isPending || disableAiClientSelection} onValueChange={(value) => setValue("aiClientId", value, { shouldDirty: true })} /></TaskConfigField> : null;
  return { automation, provider };
}

function TaskExecutionModelSection({ form, isPending }: Pick<FormSectionProps, "form" | "isPending">) {
  const { formState, setValue } = form;
  const setConfigValue = (name: "model" | "contextStrategy", value: string | undefined) => setValue("fieldExecutionConfig", { ...formState.fieldExecutionConfig, [name]: value }, { shouldDirty: true });
  return <TaskConfigSection title="Execution model" info="Overrides are applied only when the selected provider advertises support."><TaskConfigField label="Model override" hint="Leave empty to use the provider default." className="text-xs text-foreground"><Input name="executionModel" value={typeof formState.fieldExecutionConfig.model === "string" ? formState.fieldExecutionConfig.model : ""} placeholder="Provider default" disabled={isPending} onChange={(event) => setConfigValue("model", event.target.value || undefined)} /></TaskConfigField><TaskConfigField label="Context strategy" hint="Artifact-backed and bounded strategies require provider support." className="text-xs text-foreground"><TaskConfigSelect name="contextStrategy" value={typeof formState.fieldExecutionConfig.contextStrategy === "string" ? formState.fieldExecutionConfig.contextStrategy : "provider_default"} options={[{ value: "provider_default", label: "Provider default" }, { value: "auto_compact", label: "Automatic compaction" }, { value: "bounded_tool_results", label: "Bounded tool results" }, { value: "artifact_backed", label: "Artifact-backed results" }]} disabled={isPending} onValueChange={(value) => setConfigValue("contextStrategy", value)} /></TaskConfigField></TaskConfigSection>;
}

export function TaskConfigFormSections(props: FormSectionProps & Pick<TaskConfigFormProps, "availableAiClients" | "disableAiClientSelection" | "aiClientSelectionDisabledHint">) {
  const automationAndProvider = TaskAutomationSectionGroup(props);
  return <><TaskBasicsSection {...props} />{!props.compact ? <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start"><div className="flex flex-col gap-3"><TaskDescriptionSection {...props} /><TaskScheduleSection {...props} /></div><div className="flex flex-col gap-3">{automationAndProvider.automation}{automationAndProvider.provider ? <TaskConfigSection title={props.copy.aiProvider} info={props.aiClientSelectionDisabledHint}>{automationAndProvider.provider}</TaskConfigSection> : null}<TaskExecutionModelSection {...props} /></div></div> : null}<RuntimeFieldList fields={props.compact ? props.form.requiredRuntimeFields : props.form.visibleStandardFields} runtimeInput={props.form.formState.fieldExecutionConfig} compact={props.compact} onUpdate={props.form.updateRuntimeField} />{props.compact ? <details className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3"><summary className="cursor-pointer text-sm font-medium text-foreground">{props.copy.moreOptions}</summary><FieldGroup className="mt-3 gap-3"><TaskDescriptionSection {...props} />{automationAndProvider.automation}{automationAndProvider.provider}<RuntimeFieldList fields={props.form.optionalRuntimeFields} runtimeInput={props.form.formState.fieldExecutionConfig} compact onUpdate={props.form.updateRuntimeField} /></FieldGroup></details> : null}</>;
}

export function TaskConfigFormPresets({ compact, isPending, presets, onApply }: { compact: boolean; isPending: boolean; presets: TaskConfigPreset[] | undefined; onApply: (preset: TaskConfigPreset) => void }) {
  if (!presets?.length) return null;
  return <div className={compact ? "flex flex-wrap gap-2" : "rounded-2xl border border-border/60 bg-background/70 p-3"}>{compact ? <p className="sr-only">Starter presets</p> : <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Starter presets</p>}<div className={compact ? "flex flex-wrap gap-2" : "mt-3 grid gap-2 sm:grid-cols-2"}>{presets.map((preset) => <Button key={preset.id} type="button" disabled={isPending} onClick={() => onApply(preset)} className={compact ? "rounded-full border border-border/60 bg-background px-3 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60" : "rounded-2xl border border-border/60 bg-background px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"}><p className="text-sm font-medium text-foreground">{preset.label}</p>{!compact ? <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p> : null}</Button>)}</div></div>;
}

export function TaskConfigFormFooter({ footerActions, hideFooter = false, isPending = false, pendingLabel, submitLabel }: FooterProps) {
  if (!hideFooter) return <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3"><div className="flex flex-wrap items-center gap-2">{footerActions}</div><Button type="submit" disabled={isPending} variant="default" size="default">{isPending ? pendingLabel : submitLabel}</Button></div>;
  return footerActions ? <div className="border-t border-border/60 pt-3">{footerActions}</div> : null;
}
