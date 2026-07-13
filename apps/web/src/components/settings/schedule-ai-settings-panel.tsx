"use client";

import { useState } from "react";
import {
  DEFAULT_SCHEDULE_AI_PREFERENCES,
  type ScheduleAiPreferences,
  useScheduleAiPreferences,
  writeScheduleAiPreferences,
} from "@features/schedule";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Switch,
} from "@shared/ui";

type ScheduleAiSettingsPanelProps = {
  title?: string;
  description?: string;
  copy?: {
    autoPlanGeneration: string;
    autoPlanGenerationDescription: string;
    defaultAutoExecute: string;
    defaultAutoExecuteDescription: string;
    defaultOn: string;
    defaultOff: string;
    saved: string;
    currentOn: string;
    currentOff: string;
  };
};

const fallbackCopy = {
  autoPlanGeneration: "Auto-generate plan after saving",
  autoPlanGenerationDescription: "Start task plan generation after saving a task. On by default; disable to require manual Regenerate.",
  defaultAutoExecute: "Default task auto-execution",
  defaultAutoExecuteDescription: "Preselect auto-execute when creating scheduled tasks. Off by default so tasks only run automatically after opt-in.",
  defaultOn: "Default on",
  defaultOff: "Default off",
  currentOn: "On",
  currentOff: "Off",
  saved: "Saved",
};

export function ScheduleAiSettingsPanel({
  title = "Schedule AI automation",
  description = "Control which AI actions may run automatically in the schedule workflow.",
  copy = fallbackCopy,
}: ScheduleAiSettingsPanelProps) {
  const storedPreferences = useScheduleAiPreferences();
  const [savingKey, setSavingKey] = useState<keyof ScheduleAiPreferences | null>(null);

  const updatePreference = (key: keyof ScheduleAiPreferences, value: boolean) => {
    setSavingKey(key);
    writeScheduleAiPreferences({ ...storedPreferences, [key]: value });
    window.setTimeout(() => setSavingKey((current) => (current === key ? null : current)), 250);
  };

  return (
    <Card aria-labelledby="schedule-ai-settings-title">
      <CardHeader>
        <CardTitle id="schedule-ai-settings-title">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-3">
        <PreferenceToggle
          label={copy.autoPlanGeneration}
          description={copy.autoPlanGenerationDescription}
          checked={storedPreferences.autoPlanGenerationEnabled}
          defaultChecked={DEFAULT_SCHEDULE_AI_PREFERENCES.autoPlanGenerationEnabled}
          saving={savingKey === "autoPlanGenerationEnabled"}
          copy={copy}
          onChange={(checked) => updatePreference("autoPlanGenerationEnabled", checked)}
        />
        <PreferenceToggle
          label={copy.defaultAutoExecute}
          description={copy.defaultAutoExecuteDescription}
          checked={storedPreferences.defaultAutoExecuteEnabled}
          defaultChecked={DEFAULT_SCHEDULE_AI_PREFERENCES.defaultAutoExecuteEnabled}
          saving={savingKey === "defaultAutoExecuteEnabled"}
          copy={copy}
          onChange={(checked) => updatePreference("defaultAutoExecuteEnabled", checked)}
        />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

function PreferenceToggle({
  label,
  description,
  checked,
  defaultChecked,
  saving,
  copy,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  defaultChecked: boolean;
  saving: boolean;
  copy: NonNullable<ScheduleAiSettingsPanelProps["copy"]>;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="rounded-lg border bg-card p-4 shadow-xs">
      <FieldContent>
        <FieldLabel className="flex-wrap items-center">
          {label}
          <Badge variant="outline">{defaultChecked ? copy.defaultOn : copy.defaultOff}</Badge>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
            {checked ? copy.currentOn : copy.currentOff}
          </span>
          {saving ? <span className="text-xs font-normal text-muted-foreground">{copy.saved}</span> : null}
        </FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
        className="shrink-0"
      />
    </Field>
  );
}
