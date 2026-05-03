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
};

export function ScheduleAiSettingsPanel({
  title = "Schedule AI automation",
  description = "Control which AI actions may run automatically in the schedule workflow.",
}: ScheduleAiSettingsPanelProps) {
  const storedPreferences = useScheduleAiPreferences();
  const [savingKey, setSavingKey] = useState<keyof ScheduleAiPreferences | null>(null);

  const updatePreference = (key: keyof ScheduleAiPreferences, value: boolean) => {
    setSavingKey(key);
    writeScheduleAiPreferences({ ...storedPreferences, [key]: value });
    window.setTimeout(() => setSavingKey((current) => (current === key ? null : current)), 250);
  };

  return (
    <section className="rounded-xl border bg-muted/30 p-4" aria-labelledby="schedule-ai-settings-title">
      <div className="space-y-1">
        <h2 id="schedule-ai-settings-title" className="text-sm font-medium text-foreground">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <PreferenceToggle
          label="Auto suggestions"
          description="Suggest task titles/details while typing. Off by default to avoid unsolicited AI calls."
          checked={storedPreferences.autoSuggestionsEnabled}
          defaultChecked={DEFAULT_SCHEDULE_AI_PREFERENCES.autoSuggestionsEnabled}
          saving={savingKey === "autoSuggestionsEnabled"}
          onChange={(checked) => updatePreference("autoSuggestionsEnabled", checked)}
        />
        <PreferenceToggle
          label="Auto-generate plan after saving"
          description="Start task plan generation after saving a task. On by default; disable to require manual Regenerate."
          checked={storedPreferences.autoPlanGenerationEnabled}
          defaultChecked={DEFAULT_SCHEDULE_AI_PREFERENCES.autoPlanGenerationEnabled}
          saving={savingKey === "autoPlanGenerationEnabled"}
          onChange={(checked) => updatePreference("autoPlanGenerationEnabled", checked)}
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
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  defaultChecked: boolean;
  saving: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-muted/40">
      <span className="min-w-0 space-y-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {label}
          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
            Default {defaultChecked ? "on" : "off"}
          </span>
          {saving ? <span className="text-[11px] text-muted-foreground">Saved</span> : null}
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
