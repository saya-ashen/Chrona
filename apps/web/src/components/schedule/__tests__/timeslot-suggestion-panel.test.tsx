import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TimeslotSuggestionPanel } from "../timeslot-suggestion-panel";
import { suggestTimeslots } from "@chrona/runtime/modules/ai/timeslot-suggester";

const makeSuggestions = () => [
  {
    startAt: new Date(2026, 3, 15, 9, 0),
    endAt: new Date(2026, 3, 15, 10, 0),
    score: 90,
    reasons: ["Free slot", "Morning focus"],
    conflicts: [],
  },
  {
    startAt: new Date(2026, 3, 15, 14, 0),
    endAt: new Date(2026, 3, 15, 15, 0),
    score: 70,
    reasons: ["After lunch"],
    conflicts: [],
  },
];

vi.mock("@chrona/runtime/modules/ai/timeslot-suggester", () => ({
  suggestTimeslots: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

const mockedSuggest = vi.mocked(suggestTimeslots);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  const suggestions = makeSuggestions();
  mockedSuggest.mockReturnValue({
    suggestions,
    bestMatch: suggestions[0],
  });
});

const baseProps = {
  taskId: "task-1",
  title: "Test Task",
  priority: "high",
  estimatedMinutes: 60,
  dueAt: new Date(2026, 3, 16),
  currentSchedule: [],
};

describe("TimeslotSuggestionPanel", () => {
  it("renders suggestion rows with time ranges", () => {
    render(<TimeslotSuggestionPanel {...baseProps} />);

    expect(screen.getByText("Suggested Time Slots")).toBeDefined();
    const scheduleButtons = screen.getAllByRole("button");
    expect(scheduleButtons.length).toBe(2);
  });

  it("shows score for each suggestion", () => {
    render(<TimeslotSuggestionPanel {...baseProps} />);

    expect(screen.getByText("90")).toBeDefined();
    expect(screen.getByText("70")).toBeDefined();
  });

  it("best suggestion is highlighted with Best badge", () => {
    render(<TimeslotSuggestionPanel {...baseProps} />);

    expect(screen.getByText("Best")).toBeDefined();
  });

  it("clicking Schedule button calls onSchedule with start/end dates", () => {
    const onSchedule = vi.fn();
    render(<TimeslotSuggestionPanel {...baseProps} onSchedule={onSchedule} />);

    const scheduleButtons = screen.getAllByRole("button");
    fireEvent.click(scheduleButtons[0]);

    expect(onSchedule).toHaveBeenCalledOnce();
    const [startArg, endArg] = onSchedule.mock.calls[0];
    expect(startArg.getTime()).toBe(new Date(2026, 3, 15, 9, 0).getTime());
    expect(endArg.getTime()).toBe(new Date(2026, 3, 15, 10, 0).getTime());
  });

  it("shows reasons for each suggestion", () => {
    render(<TimeslotSuggestionPanel {...baseProps} />);

    expect(screen.getByText("Free slot")).toBeDefined();
    expect(screen.getByText("Morning focus")).toBeDefined();
    expect(screen.getByText("After lunch")).toBeDefined();
  });

  it("shows conflict text when conflicts present", () => {
    const suggestions = [
      {
        startAt: new Date(2026, 3, 15, 9, 0),
        endAt: new Date(2026, 3, 15, 10, 0),
        score: 50,
        reasons: [],
        conflicts: ["Overlaps with meeting"],
      },
    ];
    mockedSuggest.mockReturnValue({
      suggestions,
      bestMatch: suggestions[0],
    });

    render(<TimeslotSuggestionPanel {...baseProps} />);

    expect(screen.getByText("Overlaps with meeting")).toBeDefined();
  });

  it("renders empty state when no suggestions", () => {
    mockedSuggest.mockReturnValue({
      suggestions: [],
      bestMatch: null,
    });

    render(<TimeslotSuggestionPanel {...baseProps} />);

    expect(
      screen.getByText(
        "No suitable time slots found for this task. Try adjusting the estimated duration or schedule.",
      ),
    ).toBeDefined();
  });
});
