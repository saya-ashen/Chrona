import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ScheduleConflict, ScheduleSuggestion } from "../schedule-page-types";
import { ConflictCard } from "../conflict-card";

vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children, tone }: any) => <span data-tone={tone}>{children}</span>,
}));

function makeConflict(overrides: Partial<ScheduleConflict> = {}): ScheduleConflict {
  return {
    id: "c1",
    type: "time_overlap",
    severity: "high",
    taskIds: ["t1", "t2"],
    description: "Two tasks overlap in time",
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<ScheduleSuggestion> = {}): ScheduleSuggestion {
  return {
    id: "s1",
    conflictId: "c1",
    type: "reschedule",
    description: "Move task to afternoon",
    reason: "Frees up morning slot",
    affectedTaskIds: ["t1"],
    changes: [],
    estimatedImpact: { resolvedConflicts: 1, movedTasks: 1, timeShiftMinutes: 60 },
    ...overrides,
  };
}

afterEach(cleanup);

describe("ConflictCard", () => {
  it("renders conflict severity badge and type label", () => {
    render(<ConflictCard conflict={makeConflict()} suggestions={[]} />);
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("HIGH").closest("[data-tone]")).toHaveAttribute("data-tone", "critical");
    expect(screen.getByText("Time Overlap")).toBeInTheDocument();
  });

  it("maps medium severity to warning tone", () => {
    render(<ConflictCard conflict={makeConflict({ severity: "medium" })} suggestions={[]} />);
    expect(screen.getByText("MEDIUM").closest("[data-tone]")).toHaveAttribute("data-tone", "warning");
  });

  it("maps low severity to neutral tone", () => {
    render(<ConflictCard conflict={makeConflict({ severity: "low" })} suggestions={[]} />);
    expect(screen.getByText("LOW").closest("[data-tone]")).toHaveAttribute("data-tone", "neutral");
  });

  it("shows description text", () => {
    render(<ConflictCard conflict={makeConflict()} suggestions={[]} />);
    expect(screen.getByText("Two tasks overlap in time")).toBeInTheDocument();
  });

  it("shows time range when provided", () => {
    const conflict = makeConflict({
      timeRange: {
        start: new Date("2025-01-01T09:00:00"),
        end: new Date("2025-01-01T11:00:00"),
      },
    });
    render(<ConflictCard conflict={conflict} suggestions={[]} />);
    expect(screen.getByText(/Time range/)).toBeInTheDocument();
  });

  it("does not show time range when not provided", () => {
    render(<ConflictCard conflict={makeConflict()} suggestions={[]} />);
    expect(screen.queryByText(/Time range/)).not.toBeInTheDocument();
  });

  it("shows suggestion buttons when suggestions match conflictId", () => {
    const handler = vi.fn();
    render(
      <ConflictCard
        conflict={makeConflict()}
        suggestions={[makeSuggestion()]}
        onApplySuggestion={handler}
      />,
    );
    expect(screen.getByText("Reschedule")).toBeInTheDocument();
    expect(screen.getByText("Move task to afternoon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply Suggestion" })).toBeInTheDocument();
  });

  it("calls onApplySuggestion when suggestion button clicked", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    const suggestion = makeSuggestion();
    render(
      <ConflictCard
        conflict={makeConflict()}
        suggestions={[suggestion]}
        onApplySuggestion={handler}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Apply Suggestion" }));
    expect(handler).toHaveBeenCalledWith(suggestion);
  });

  it("disables suggestion buttons when isPending", () => {
    render(
      <ConflictCard
        conflict={makeConflict()}
        suggestions={[makeSuggestion()]}
        onApplySuggestion={vi.fn()}
        isPending
      />,
    );
    const btn = screen.getByRole("button", { name: "Applying..." });
    expect(btn).toBeDisabled();
  });

  it("does not render suggestions section when no matching suggestions", () => {
    render(
      <ConflictCard
        conflict={makeConflict()}
        suggestions={[makeSuggestion({ conflictId: "other" })]}
        onApplySuggestion={vi.fn()}
      />,
    );
    expect(screen.queryByText("Suggested solutions")).not.toBeInTheDocument();
    expect(screen.queryByText("Apply Suggestion")).not.toBeInTheDocument();
  });
});
