import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: any) => <section {...props}>{children}</section>,
}));

import { ScheduleMiniCalendar } from "./schedule-mini-calendar";

afterEach(() => cleanup());

describe("ScheduleMiniCalendar", () => {
  it("renders a shadcn calendar grid with selectable days", () => {
    render(
      <ScheduleMiniCalendar
        selectedDate={new Date(2026, 3, 1)}
        days={[
          {
            key: "2026-03-30",
            label: "Mon, Mar 30",
            shortLabel: "Mon",
            dateNumber: "30",
            href: "/schedule?day=2026-03-30",
            isCurrentMonth: false,
            isToday: false,
            isSelected: false,
            scheduledCount: 0,
            riskCount: 0,
          },
          {
            key: "2026-04-01",
            label: "Wed, Apr 1",
            shortLabel: "Wed",
            dateNumber: "1",
            href: "/schedule?day=2026-04-01",
            isCurrentMonth: true,
            isToday: true,
            isSelected: true,
            scheduledCount: 2,
            riskCount: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText("April 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /wed, apr 1/i })).toHaveAttribute(
      "href",
      "/en/schedule?day=2026-04-01",
    );
    expect(screen.getAllByText("Mo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("30").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("can navigate to another month", async () => {
    const user = userEvent.setup();

    render(
      <ScheduleMiniCalendar
        selectedDate={new Date(2026, 3, 1)}
        days={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });
});
