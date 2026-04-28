import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: any) => <a href={`/en${href}`} {...props}>{children}</a>,
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, ...props }: any) => <section {...props}>{children}</section>,
}));

import { ScheduleMiniCalendar } from "@/components/schedule/schedule-mini-calendar";

describe("ScheduleMiniCalendar", () => {
  it("renders a month-style calendar grid with selectable days", () => {
    render(
      <ScheduleMiniCalendar
        monthLabel="April 2026"
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
    expect(screen.getAllByText("Mon").length).toBeGreaterThan(0);
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
