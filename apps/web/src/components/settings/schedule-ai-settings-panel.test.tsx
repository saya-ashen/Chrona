import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScheduleAiSettingsPanel } from "@/components/settings/schedule-ai-settings-panel";
import { SCHEDULE_AI_PREFERENCES_STORAGE_KEY } from "@/lib/schedule-ai-preferences";

describe("ScheduleAiSettingsPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders schedule AI automation toggles with required defaults", () => {
    render(<ScheduleAiSettingsPanel />);

    expect(screen.getByText("Schedule AI automation")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /auto suggestions/i })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /auto-generate plan after saving/i })).toBeChecked();
    expect(screen.getByRole("switch", { name: /default task auto-execution/i })).not.toBeChecked();
  });

  it("persists updated preferences to localStorage", () => {
    render(<ScheduleAiSettingsPanel />);

    fireEvent.click(screen.getByRole("switch", { name: /auto-generate plan after saving/i }));
    fireEvent.click(screen.getByRole("switch", { name: /default task auto-execution/i }));

    expect(JSON.parse(window.localStorage.getItem(SCHEDULE_AI_PREFERENCES_STORAGE_KEY) ?? "{}")).toEqual({
      autoSuggestionsEnabled: false,
      autoPlanGenerationEnabled: false,
      defaultAutoExecuteEnabled: true,
    });
  });
});
