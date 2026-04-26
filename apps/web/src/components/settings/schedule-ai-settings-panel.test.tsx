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
    expect(screen.getByRole("checkbox", { name: /auto suggestions/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /auto-generate plan after saving/i })).toBeChecked();
  });

  it("persists updated preferences to localStorage", () => {
    render(<ScheduleAiSettingsPanel />);

    fireEvent.click(screen.getByRole("checkbox", { name: /auto suggestions/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /auto-generate plan after saving/i }));

    expect(JSON.parse(window.localStorage.getItem(SCHEDULE_AI_PREFERENCES_STORAGE_KEY) ?? "{}")).toEqual({
      autoSuggestionsEnabled: true,
      autoPlanGenerationEnabled: false,
    });
  });
});
