"use client";

import { useEffect, useState } from "react";

export type ScheduleAiPreferences = {
  autoSuggestionsEnabled: boolean;
  autoPlanGenerationEnabled: boolean;
};

export const SCHEDULE_AI_PREFERENCES_STORAGE_KEY = "chrona.schedule.ai-preferences.v1";

export const DEFAULT_SCHEDULE_AI_PREFERENCES: ScheduleAiPreferences = {
  autoSuggestionsEnabled: false,
  autoPlanGenerationEnabled: true,
};

export function parseScheduleAiPreferences(value: string | null): ScheduleAiPreferences {
  if (!value) return DEFAULT_SCHEDULE_AI_PREFERENCES;

  try {
    const parsed = JSON.parse(value) as Partial<ScheduleAiPreferences> | null;
    return {
      autoSuggestionsEnabled:
        typeof parsed?.autoSuggestionsEnabled === "boolean"
          ? parsed.autoSuggestionsEnabled
          : DEFAULT_SCHEDULE_AI_PREFERENCES.autoSuggestionsEnabled,
      autoPlanGenerationEnabled:
        typeof parsed?.autoPlanGenerationEnabled === "boolean"
          ? parsed.autoPlanGenerationEnabled
          : DEFAULT_SCHEDULE_AI_PREFERENCES.autoPlanGenerationEnabled,
    };
  } catch {
    return DEFAULT_SCHEDULE_AI_PREFERENCES;
  }
}

export function readScheduleAiPreferences(): ScheduleAiPreferences {
  if (typeof window === "undefined") return DEFAULT_SCHEDULE_AI_PREFERENCES;
  return parseScheduleAiPreferences(window.localStorage.getItem(SCHEDULE_AI_PREFERENCES_STORAGE_KEY));
}

export function writeScheduleAiPreferences(preferences: ScheduleAiPreferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SCHEDULE_AI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent("schedule-ai-preferences-change", { detail: preferences }));
}

export function useScheduleAiPreferences() {
  const [preferences, setPreferences] = useState<ScheduleAiPreferences>(DEFAULT_SCHEDULE_AI_PREFERENCES);

  useEffect(() => {
    setPreferences(readScheduleAiPreferences());

    const handleStorage = (event: StorageEvent) => {
      if (event.key === SCHEDULE_AI_PREFERENCES_STORAGE_KEY) {
        setPreferences(parseScheduleAiPreferences(event.newValue));
      }
    };
    const handleLocalChange = (event: Event) => {
      setPreferences((event as CustomEvent<ScheduleAiPreferences>).detail ?? readScheduleAiPreferences());
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("schedule-ai-preferences-change", handleLocalChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("schedule-ai-preferences-change", handleLocalChange);
    };
  }, []);

  return preferences;
}
