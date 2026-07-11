import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanningHeader } from "./panels/planning-header";

describe("PlanningHeader", () => {
  it("centers the selected day and exposes one scheduling action", () => {
    const onNavigate = vi.fn();

    render(
      <PlanningHeader
        ariaLabel="Schedule"
        title="Schedule"
        activeDayLabel="Today · Wednesday"
        summary="2h scheduled · 3 tasks waiting · 1 risk needs review"
        dayLinks={[
          { label: "Previous day", href: "/schedule?day=previous", kind: "previous" },
          { label: "Today", href: "/schedule?day=today", kind: "today", current: true },
          { label: "Next day", href: "/schedule?day=next", kind: "next" },
        ]}
        primaryAction={{ label: "Schedule task", onClick: vi.fn() }}
        activeView="timeline"
        timelineHref="/schedule?view=timeline"
        listHref="/schedule?view=list"
        timelineLabel="Timeline"
        listLabel="Agenda"
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole("heading", { name: "Today · Wednesday" })).toBeInTheDocument();
    expect(screen.getByText("2h scheduled · 3 tasks waiting · 1 risk needs review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeline" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule task" })).toBeInTheDocument();
  });
});
