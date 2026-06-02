import { z } from "zod";

/**
 * Presets that control WHEN a task automation (auto plan generation or
 * auto execution) fires, relative to the task's scheduled start.
 *
 * - `immediate`: run as soon as the task is saved (legacy behavior).
 * - `at_start`: run when the scheduled start time is reached (default).
 * - `before_*`: run the given amount of time BEFORE the scheduled start.
 */
export const AUTOMATION_TIMING_PRESETS = [
  "immediate",
  "at_start",
  "before_30m",
  "before_1h",
  "before_2h",
  "before_1d",
] as const;

export type AutomationTimingPreset = (typeof AUTOMATION_TIMING_PRESETS)[number];

export const DEFAULT_AUTOMATION_TIMING: AutomationTimingPreset = "at_start";

/** Minutes BEFORE scheduled start that each preset should fire. */
const AUTOMATION_TIMING_OFFSET_MINUTES: Record<AutomationTimingPreset, number> = {
  immediate: 0,
  at_start: 0,
  before_30m: 30,
  before_1h: 60,
  before_2h: 120,
  before_1d: 1440,
};

export function automationTimingOffsetMs(preset: AutomationTimingPreset): number {
  return AUTOMATION_TIMING_OFFSET_MINUTES[preset] * 60_000;
}

export const automationTimingSchema = z.enum(AUTOMATION_TIMING_PRESETS);

export function normalizeAutomationTiming(
  value: string | null | undefined,
): AutomationTimingPreset {
  const parsed = automationTimingSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AUTOMATION_TIMING;
}

/**
 * Resolve the absolute time an automation should fire.
 *
 * - `immediate` always returns `"immediate"` (fire now, ignore schedule).
 * - For schedule-anchored presets, returns the Date `scheduledStartAt - offset`.
 * - Returns `null` when there is no scheduled start to anchor to, signalling
 *   callers to apply their no-schedule fallback policy.
 */
export function resolveAutomationTriggerAt(
  preset: AutomationTimingPreset,
  scheduledStartAt: Date | null | undefined,
): Date | "immediate" | null {
  if (preset === "immediate") {
    return "immediate";
  }
  if (!scheduledStartAt) {
    return null;
  }
  return new Date(scheduledStartAt.getTime() - automationTimingOffsetMs(preset));
}
