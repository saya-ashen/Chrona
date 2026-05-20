"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SCHEDULE_AI_PREFERENCES,
  type ScheduleAiPreferences,
  useScheduleAiPreferences,
  writeScheduleAiPreferences,
} from "@/lib/schedule-ai-preferences";

type ScheduleAiSettingsPanelProps = {
  title?: string;
  description?: string;
  copy?: {
    autoSuggestions: string;
    autoSuggestionsDescription: string;
    autoPlanGeneration: string;
    autoPlanGenerationDescription: string;
    defaultAutoExecute: string;
    defaultAutoExecuteDescription: string;
    defaultOn: string;
    defaultOff: string;
    saved: string;
  };
};

const fallbackCopy = {
  autoSuggestions: "Auto suggestions",
  autoSuggestionsDescription: "Suggest task titles/details while typing. Off by default to avoid unsolicited AI calls.",
  autoPlanGeneration: "Auto-generate plan after saving",
  autoPlanGenerationDescription: "Start task plan generation after saving a task. On by default; disable to require manual Regenerate.",
  defaultAutoExecute: "Default task auto-execution",
  defaultAutoExecuteDescription: "Preselect auto-execute when creating scheduled tasks. Off by default so tasks only run automatically after opt-in.",
  defaultOn: "Default on",
  defaultOff: "Default off",
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
    <section className="rounded-[26px] border border-white/70 bg-white/92 p-5 shadow-sm" aria-labelledby="schedule-ai-settings-title">
      <div className="space-y-1">
        <h2 id="schedule-ai-settings-title" className="text-sm font-medium text-foreground">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <PreferenceToggle
          label={copy.autoSuggestions}
          description={copy.autoSuggestionsDescription}
          checked={storedPreferences.autoSuggestionsEnabled}
          defaultChecked={DEFAULT_SCHEDULE_AI_PREFERENCES.autoSuggestionsEnabled}
          saving={savingKey === "autoSuggestionsEnabled"}
          copy={copy}
          onChange={(checked) => updatePreference("autoSuggestionsEnabled", checked)}
        />
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
      </div>
    </section>
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
    <label className="group flex cursor-pointer items-start justify-between gap-4 rounded-[22px] border border-border/60 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] p-4 shadow-sm transition-colors hover:border-primary/25 hover:bg-muted/40">
      <span className="min-w-0 space-y-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {label}
          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
            {defaultChecked ? copy.defaultOn : copy.defaultOff}
          </span>
          {saving ? <span className="text-[11px] text-muted-foreground">{copy.saved}</span> : null}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      <span
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-primary bg-primary" : "border-border bg-muted",
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
