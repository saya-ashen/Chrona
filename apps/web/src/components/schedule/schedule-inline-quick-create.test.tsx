import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {} }),
}));

import { ScheduleInlineQuickCreate } from "@/components/schedule/schedule-inline-quick-create";

afterEach(() => {
  cleanup();
});

describe("ScheduleInlineQuickCreate", () => {
  it("submits a scheduled quick-create draft with edited time, duration, and priority", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ScheduleInlineQuickCreate
        mode="scheduled"
        selectedDay="2026-04-15"
        initialStartAt={new Date(2026, 3, 15, 9, 0, 0, 0)}
        initialDurationMinutes={60}
        isPending={false}
        submitLabel="Create and schedule"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByPlaceholderText(/add title and time/i), "Write summary");
    fireEvent.change(screen.getByLabelText(/custom time/i), { target: { value: "14:30" } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: "90" } });
    await user.click(screen.getByRole("button", { name: /^high$/i }));
    await user.click(screen.getByRole("button", { name: /create and schedule/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Write summary",
        priority: "High",
        durationMinutes: 90,
        scheduledStartAt: new Date("2026-04-15T14:30:00"),
        scheduledEndAt: new Date("2026-04-15T16:00:00"),
      }),
    );
  });

  it("renders a compact queue launcher that expands into the composer on demand", async () => {
    const user = userEvent.setup();

    render(
      <ScheduleInlineQuickCreate
        mode="queue"
        selectedDay="2026-04-15"
        isPending={false}
        submitLabel="Add to queue"
        hint="Queue tasks can be placed later."
        compact
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole("button", { name: /quick create/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /quick create/i }));

    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/custom time/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^urgent$/i })).toBeInTheDocument();
  });

  it("calls onCancel when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ScheduleInlineQuickCreate
        mode="queue"
        selectedDay="2026-04-15"
        isPending={false}
        submitLabel="Add to queue"
        onCancel={onCancel}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByPlaceholderText(/add a task to the queue/i));
    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
