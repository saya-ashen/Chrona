import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PlanningBusyBlock } from "@chrona/domain";
import { ExternalCalendarEventBlock } from "../ui/external-calendar-event-block";

function event(overrides: Partial<PlanningBusyBlock> = {}): PlanningBusyBlock {
  return {
    id: "event-1",
    calendarSourceId: "source-1",
    sourceName: "Team Calendar",
    sourceColor: "#0f766e",
    title: "Design review",
    startsAt: new Date(2026, 3, 15, 9, 30, 0, 0),
    endsAt: new Date(2026, 3, 15, 10, 0, 0, 0),
    isAllDay: false,
    readOnly: true,
    overlapsScheduledTask: false,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("external calendar event block", () => {
  it("renders imported event title, source label, color marker, and read-only marker", () => {
    render(<ExternalCalendarEventBlock event={event()} timeRange="9:30 AM - 10:00 AM" />);

    expect(screen.getByText("Design review")).toBeInTheDocument();
    expect(screen.getByText("Team Calendar")).toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(document.querySelector('[style*="rgb(15, 118, 110)"]')).toBeTruthy();
  });

  it("distinguishes imported events that overlap scheduled task blocks", () => {
    render(<ExternalCalendarEventBlock event={event({ overlapsScheduledTask: true })} timeRange="9:30 AM - 10:00 AM" />);

    expect(screen.getByText("Overlaps task")).toBeInTheDocument();
  });
});
