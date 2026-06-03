export const RECURRENCE_PRESETS = ["none", "daily", "weekly", "monthly", "custom"] as const;
export type RecurrencePreset = (typeof RECURRENCE_PRESETS)[number];

export const RECURRENCE_PRESET_RRULE: Record<string, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
};

export function recurrencePresetFromRule(rule: string | null | undefined): RecurrencePreset {
  if (!rule) return "none";
  const preset = Object.entries(RECURRENCE_PRESET_RRULE).find(([, value]) => value === rule)?.[0];
  return (preset as RecurrencePreset | undefined) ?? "custom";
}

export function recurrenceRuleFromState(mode: RecurrencePreset, customRule: string) {
  if (mode === "none") return null;
  if (mode === "custom") return customRule.trim() || null;
  return RECURRENCE_PRESET_RRULE[mode] ?? null;
}
