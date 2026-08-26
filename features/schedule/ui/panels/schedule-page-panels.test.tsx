import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueueCard } from "./schedule-page-panels";

vi.mock("@chrona/i18n/react", () => ({
  useLocale: () => "en",
  useI18n: () => ({
    messages: {
      components: {
        schedulePage: {},
      },
    },
  }),
}));

describe("QueueCard", () => {
  it("opens details from the row while the schedule action stays independent", () => {
    const onOpenTaskDetails = vi.fn();
    const onScheduleTask = vi.fn();

    render(
      <QueueCard
        item={{
          taskId: "task-1",
          title: "Prepare customer review",
          priority: "High",
          dueAt: null,
        } as never}
        isDragging={false}
        isPending={false}
        onScheduleTask={onScheduleTask}
        onOpenTaskDetails={onOpenTaskDetails}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    const detailsButton = screen.getByRole("button", { name: "Prepare customer review" });
    fireEvent.click(detailsButton);
    expect(onOpenTaskDetails).toHaveBeenCalledWith("task-1");

    const scheduleButton = screen.getAllByRole("button").find((button) => button.textContent?.trim() === "Schedule");
    expect(scheduleButton).toBeDefined();
    expect(detailsButton.contains(scheduleButton!)).toBe(false);
    fireEvent.click(scheduleButton!);
    expect(onScheduleTask).toHaveBeenCalledWith("task-1");
    expect(onOpenTaskDetails).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
