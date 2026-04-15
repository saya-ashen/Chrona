import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanningHeader } from "@/components/schedule/planning-header";

describe("PlanningHeader", () => {
  it("renders cockpit summary metrics and action affordances", () => {
    render(
      <PlanningHeader
        ariaLabel="Schedule"
        title="Schedule"
        activeDayLabel="Today · Wednesday"
        summary="2h scheduled · 3 tasks waiting · 1 risk needs review"
        dateSwitcherLabel="Date"
        dayLinks={[
          { label: "Today", href: "/schedule?day=today", current: true },
          { label: "Tomorrow", href: "/schedule?day=tomorrow" },
        ]}
        metrics={[
          { label: "Today load", value: "2h", hint: "Committed work on the active day." },
          { label: "Queue", value: "3", hint: "Tasks waiting to be placed.", tone: "info" },
          { label: "Risks", value: "1", hint: "Items that need attention.", tone: "critical" },
          { label: "AI suggestions", value: "2", hint: "Suggested next moves." },
        ]}
        actions={[
          { label: "Quick add", href: "#schedule-capture-bar", description: "Jump to quick create." },
          { label: "Review suggestions", href: "#schedule-cockpit-sidebar", description: "Open the cockpit sidebar." },
          { label: "Auto arrange", description: "Coming soon", disabled: true },
        ]}
        activeView="timeline"
        timelineHref="/schedule?view=timeline"
        listHref="/schedule?view=list"
        timelineLabel="Timeline"
        listLabel="List"
      />,
    );

    expect(
      screen.getByText("2h scheduled · 3 tasks waiting · 1 risk needs review"),
    ).toBeInTheDocument();
    expect(screen.getByText("Today load")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /quick add/i })).toHaveAttribute(
      "href",
      "#schedule-capture-bar",
    );
    expect(screen.getByRole("button", { name: /auto arrange/i })).toBeDisabled();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });
});
