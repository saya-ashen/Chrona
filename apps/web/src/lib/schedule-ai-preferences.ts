import { useEffect, useState } from "react";

export type ScheduleAiPreferences = {
  autoSuggestionsEnabled: boolean;
  autoPlanGenerationEnabled: boolean;
};

export const SCHEDULE_AI_PREFERENCES_STORAGE_KEY =
  "chrona.schedule-ai-preferences";

const SCHEDULE_AI_PREFERENCES_UPDATED_EVENT =
  "chrona:schedule-ai-preferences-updated";

export const DEFAULT_SCHEDULE_AI_PREFERENCES: ScheduleAiPreferences = {
  autoSuggestionsEnabled: false,
  autoPlanGenerationEnabled: true,
};

function isScheduleAiPreferences(
  value: unknown,
): value is Partial<ScheduleAiPreferences> {
  return typeof value === "object" && value !== null;
}

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function readScheduleAiPreferences(): ScheduleAiPreferences {
  const storage = getStorage();

  if (!storage) {
    return DEFAULT_SCHEDULE_AI_PREFERENCES;
  }

  try {
    const rawValue = storage.getItem(SCHEDULE_AI_PREFERENCES_STORAGE_KEY);

    if (!rawValue) {
      return DEFAULT_SCHEDULE_AI_PREFERENCES;
    }

    const parsed = JSON.parse(rawValue) as unknown;

    if (!isScheduleAiPreferences(parsed)) {
      return DEFAULT_SCHEDULE_AI_PREFERENCES;
    }

    return {
      autoSuggestionsEnabled:
        typeof parsed.autoSuggestionsEnabled === "boolean"
          ? parsed.autoSuggestionsEnabled
          : DEFAULT_SCHEDULE_AI_PREFERENCES.autoSuggestionsEnabled,
      autoPlanGenerationEnabled:
        typeof parsed.autoPlanGenerationEnabled === "boolean"
          ? parsed.autoPlanGenerationEnabled
          : DEFAULT_SCHEDULE_AI_PREFERENCES.autoPlanGenerationEnabled,
    };
  } catch {
    return DEFAULT_SCHEDULE_AI_PREFERENCES;
  }
}

export function writeScheduleAiPreferences(
  preferences: ScheduleAiPreferences,
): ScheduleAiPreferences {
  const nextPreferences: ScheduleAiPreferences = {
    autoSuggestionsEnabled: preferences.autoSuggestionsEnabled,
    autoPlanGenerationEnabled: preferences.autoPlanGenerationEnabled,
  };

  const storage = getStorage();

  if (!storage) {
    return nextPreferences;
  }

  storage.setItem(
    SCHEDULE_AI_PREFERENCES_STORAGE_KEY,
    JSON.stringify(nextPreferences),
  );
  window.dispatchEvent(
    new CustomEvent<ScheduleAiPreferences>(
      SCHEDULE_AI_PREFERENCES_UPDATED_EVENT,
      {
        detail: nextPreferences,
      },
    ),
  );

  return nextPreferences;
}

export function useScheduleAiPreferences(): ScheduleAiPreferences {
  const [preferences, setPreferences] = useState<ScheduleAiPreferences>(
    DEFAULT_SCHEDULE_AI_PREFERENCES,
  );

  useEffect(() => {
    setPreferences(readScheduleAiPreferences());

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== null &&
        event.key !== SCHEDULE_AI_PREFERENCES_STORAGE_KEY
      ) {
        return;
      }

      setPreferences(readScheduleAiPreferences());
    };

    const handlePreferencesUpdated = (
      event: Event,
    ) => {
      const nextPreferences = (
        event as CustomEvent<ScheduleAiPreferences>
      ).detail;

      setPreferences(nextPreferences ?? readScheduleAiPreferences());
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      SCHEDULE_AI_PREFERENCES_UPDATED_EVENT,
      handlePreferencesUpdated,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        SCHEDULE_AI_PREFERENCES_UPDATED_EVENT,
        handlePreferencesUpdated,
      );
    };
  }, []);

  return preferences;
}
