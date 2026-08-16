import { fireEvent, render, screen } from "@testing-library/react";
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
					{
						label: "Previous day",
						href: "/schedule?day=previous",
						kind: "previous",
					},
					{
						label: "Today",
						href: "/schedule?day=today",
						kind: "today",
						current: true,
					},
					{ label: "Next day", href: "/schedule?day=next", kind: "next" },
				]}
				selectedDate={new Date(2026, 6, 11)}
				onSelectDate={vi.fn()}
				primaryAction={{ label: "Schedule task", onClick: vi.fn() }}
				activeView="timeline"
				timelineHref="/schedule?view=timeline"
				listHref="/schedule?view=list"
				timelineLabel="Timeline"
				listLabel="Agenda"
				onNavigate={onNavigate}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Today · Wednesday" }),
		).toBeInTheDocument();
		expect(
			screen.getByText("2h scheduled · 3 tasks waiting · 1 risk needs review"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Previous day" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Next day" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Timeline" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("button", { name: "Agenda" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Schedule task" }),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
		fireEvent.click(screen.getByRole("button", { name: "Today" }));
		fireEvent.click(screen.getByRole("button", { name: "Next day" }));
		fireEvent.click(screen.getByRole("button", { name: "Agenda" }));
		expect(onNavigate.mock.calls.map(([href]) => href)).toEqual([
			"/schedule?day=previous",
			"/schedule?day=today",
			"/schedule?day=next",
			"/schedule?view=list",
		]);
	});

	it("opens a calendar from the date label and selects a date", () => {
		const onSelectDate = vi.fn();

		render(
			<PlanningHeader
				ariaLabel="Schedule"
				title="Schedule"
				activeDayLabel="July 11, 2026"
				summary="No risks"
				dayLinks={[]}
				selectedDate={new Date(2026, 6, 11)}
				onSelectDate={onSelectDate}
				primaryAction={{ label: "Schedule task", onClick: vi.fn() }}
				activeView="timeline"
				timelineHref="/schedule?view=timeline"
				listHref="/schedule?view=list"
				timelineLabel="Timeline"
				listLabel="Agenda"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "July 11, 2026" }));
		const dayButton = screen
			.getAllByRole("button")
			.find((button) => button.textContent === "15");
		expect(dayButton).toBeDefined();
		fireEvent.click(dayButton!);

		expect(onSelectDate).toHaveBeenCalledWith(expect.any(Date));
		expect(onSelectDate.mock.calls[0]?.[0].getDate()).toBe(15);
	});
});
