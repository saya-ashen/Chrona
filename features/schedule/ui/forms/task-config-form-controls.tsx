import type { ReactNode } from "react";
import { useState } from "react";
import {
  Button,
  Calendar,
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  cn,
} from "@shared/ui";
import { normalizeAutomationTiming, AUTOMATION_TIMING_PRESETS } from "@chrona/contracts";
import type { AutomationTimingPreset } from "@chrona/contracts";
import { CalendarIcon, Info } from "lucide-react";
import { formatLocalDateInput, formatLocalDateLabel, parseLocalDateInput } from "./task-config-form-conversions";

type TaskConfigSelectOption = { value: string; label: string };
const EMPTY_SELECT_OPTION_VALUE = "__chrona_empty_select_value__";

export function TaskConfigField({
  label,
  hint,
  tooltip,
  titleClassName,
  hideTitle,
  htmlFor,
  invalid,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  tooltip?: string;
  titleClassName?: string;
  hideTitle?: boolean;
  htmlFor?: string;
  invalid?: boolean;
  error?: { message?: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={invalid} className={className}>
      <div className={cn("flex items-center gap-1.5", titleClassName, hideTitle && "sr-only")}>
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {tooltip ? <InfoPopover label={label} content={tooltip} /> : null}
      </div>
      {children}
      {invalid ? <FieldError errors={[error]} /> : null}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

export function InfoPopover({ label, content }: { label: string; content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} info`}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="!z-[1000] w-64 border-border/70 bg-popover text-left text-xs leading-5 shadow-xl"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

export function TaskConfigSection({
  title,
  info,
  actions,
  compact = false,
  children,
}: {
  title: string;
  info?: string;
  actions?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-[1.2rem] border border-border/60 bg-background/80 p-3 text-sm text-foreground shadow-sm", compact && "rounded-xl")}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <span className="truncate">{title}</span>
          {info ? <InfoPopover label={title} content={info} /> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function TaskConfigSelect({
  name,
  id,
  value,
  placeholder = "-",
  options,
  disabled,
  onValueChange,
}: {
  name: string;
  id?: string;
  value: string;
  placeholder?: string;
  options: TaskConfigSelectOption[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const triggerId = id ?? `task-config-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const selectValue = value === "" ? EMPTY_SELECT_OPTION_VALUE : value;

  return (
    <>
      <Input type="hidden" name={name} value={value} />
      <Select
        open={isOpen}
        value={selectValue}
        onOpenChange={(nextOpen) => setIsOpen(disabled ? false : nextOpen)}
        onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_SELECT_OPTION_VALUE ? "" : nextValue)}
        disabled={disabled}
      >
        <SelectTrigger id={triggerId} className="w-full" disabled={disabled}>
          <span data-slot="select-value" className={selectedOption ? undefined : "text-muted-foreground"}>
            {selectedOption?.label ?? placeholder}
          </span>
        </SelectTrigger>
        {isOpen ? (
          <SelectContent position="popper" className="z-[160] max-h-72">
            <SelectGroup>
              {options.map((option) => {
                const itemValue = option.value === "" ? EMPTY_SELECT_OPTION_VALUE : option.value;

                return (
                  <SelectItem key={itemValue} value={itemValue}>
                    {option.label}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        ) : null}
      </Select>
    </>
  );
}

export function TaskConfigDatePicker({
  name,
  value,
  placeholder,
  disabled,
  onValueChange,
}: {
  name: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const selectedDate = parseLocalDateInput(value);

  return (
    <>
      <Input type="hidden" name={name} value={value} />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-start px-3 text-left font-normal"
          >
            <CalendarIcon data-icon="inline-start" />
            {selectedDate ? formatLocalDateLabel(selectedDate) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="z-[160] w-auto p-0">
          <Calendar
            mode="single"
            selected={selectedDate ?? undefined}
            onSelect={(date) => onValueChange(formatLocalDateInput(date ?? null))}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

function TaskAutomationOption({
  label,
  description,
  checked,
  disabled,
  name,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  name: string;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <label className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-border/70 bg-background/90 px-3 py-2.5 text-sm text-foreground shadow-sm transition-colors has-[[data-state=checked]]:border-primary/35 has-[[data-state=checked]]:bg-primary/5">
      <Checkbox
        name={name}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange ? (nextChecked) => onCheckedChange(nextChecked === true) : undefined}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block font-medium leading-5">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export function TaskAutomationSection({
  copy,
  autoPlanGeneration,
  autoExecute,
  autoPlanGenerationTiming,
  autoExecuteTiming,
  onAutoPlanGenerationChange,
  onAutoExecuteChange,
  onAutoPlanGenerationTimingChange,
  onAutoExecuteTimingChange,
  compact = false,
}: {
  copy: {
    automation: string;
    autoExecute: string;
    autoExecuteDescription: string;
    autoPlanGeneration: string;
    autoPlanGenerationDescription: string;
    automationTimingLabel: string;
    automationTiming: Record<AutomationTimingPreset, string>;
  };
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  autoPlanGenerationTiming: AutomationTimingPreset;
  autoExecuteTiming: AutomationTimingPreset;
  onAutoPlanGenerationChange: (checked: boolean) => void;
  onAutoExecuteChange: (checked: boolean) => void;
  onAutoPlanGenerationTimingChange: (value: AutomationTimingPreset) => void;
  onAutoExecuteTimingChange: (value: AutomationTimingPreset) => void;
  compact?: boolean;
}) {
  const effectiveAutoPlanGeneration = autoExecute || autoPlanGeneration;
  const timingOptions = AUTOMATION_TIMING_PRESETS.map((preset) => ({
    value: preset,
    label: copy.automationTiming[preset],
  }));

  return (
    <TaskConfigSection
      title={copy.automation}
      compact={compact}
      actions={effectiveAutoPlanGeneration ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">On</span> : null}
    >
      <div className="grid gap-2">
        <div className="grid gap-2">
          <TaskAutomationOption
            name="autoPlanGeneration"
            checked={effectiveAutoPlanGeneration}
            disabled={autoExecute}
            label={copy.autoPlanGeneration}
            description={copy.autoPlanGenerationDescription}
            onCheckedChange={onAutoPlanGenerationChange}
          />
          {effectiveAutoPlanGeneration ? (
            <TaskAutomationTimingSelect
              name="autoPlanGenerationTiming"
              label={copy.automationTimingLabel}
              value={autoPlanGenerationTiming}
              options={timingOptions}
              onValueChange={onAutoPlanGenerationTimingChange}
            />
          ) : null}
        </div>
        <div className="grid gap-2">
          <TaskAutomationOption
            name="autoExecute"
            checked={autoExecute}
            label={copy.autoExecute}
            description={copy.autoExecuteDescription}
            onCheckedChange={onAutoExecuteChange}
          />
          {autoExecute ? (
            <TaskAutomationTimingSelect
              name="autoExecuteTiming"
              label={copy.automationTimingLabel}
              value={autoExecuteTiming}
              options={timingOptions}
              onValueChange={onAutoExecuteTimingChange}
            />
          ) : null}
        </div>
      </div>
    </TaskConfigSection>
  );
}

function TaskAutomationTimingSelect({
  name,
  label,
  value,
  options,
  onValueChange,
}: {
  name: string;
  label: string;
  value: AutomationTimingPreset;
  options: { value: AutomationTimingPreset; label: string }[];
  onValueChange: (value: AutomationTimingPreset) => void;
}) {
  return (
    <div className="ml-9 grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <TaskConfigSelect
        name={name}
        value={value}
        options={options}
        onValueChange={(next) => onValueChange(normalizeAutomationTiming(next))}
      />
    </div>
  );
}
