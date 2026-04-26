import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScheduleEditorForm } from "../schedule-editor-form";
import { applySchedule, clearSchedule } from "@/lib/task-actions-client";

vi.mock("@/lib/task-actions-client", () => ({
  applySchedule: vi.fn().mockResolvedValue({}),
  clearSchedule: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/i18n/client", () => ({ useI18n: () => ({ messages: {} }) }));
vi.mock("@/components/ui/button", () => ({ buttonVariants: () => "btn" }));
vi.mock("@/components/ui/field", () => ({
  Field: ({ children, label }: any) => (
    <div>
      <span data-testid={`label-${label}`}>{label}</span>
      {children}
    </div>
  ),
  inputClassName: "input",
}));

const mockedApply = vi.mocked(applySchedule);
const mockedClear = vi.mocked(clearSchedule);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScheduleEditorForm", () => {
  const baseProps = {
    taskId: "task-1",
  };

  it("renders date/time fields with initial values", () => {
    const due = new Date("2026-04-15T10:00:00Z");
    const start = new Date("2026-04-15T09:00:00Z");
    const end = new Date("2026-04-15T11:00:00Z");

    render(
      <ScheduleEditorForm
        {...baseProps}
        dueAt={due}
        scheduledStartAt={start}
        scheduledEndAt={end}
      />,
    );

    expect(screen.getByTestId("label-Due")).toBeDefined();
    expect(screen.getByTestId("label-Start")).toBeDefined();
    expect(screen.getByTestId("label-End")).toBeDefined();

    const dueInput = screen.getByDisplayValue("2026-04-15T10:00");
    expect(dueInput).toBeDefined();
    expect(dueInput.getAttribute("name")).toBe("dueAt");

    expect(screen.getByDisplayValue("2026-04-15T09:00")).toBeDefined();
    expect(screen.getByDisplayValue("2026-04-15T11:00")).toBeDefined();
  });

  it("submit calls applySchedule with taskId and form data", async () => {
    render(<ScheduleEditorForm {...baseProps} />);

    const dueInput = document.querySelector('input[name="dueAt"]')!;
    fireEvent.change(dueInput, { target: { value: "2026-04-20T14:00" } });

    const submitButton = screen.getByRole("button", { name: "Apply Schedule" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockedApply).toHaveBeenCalledWith({
        taskId: "task-1",
        dueAt: expect.any(Date),
        scheduledStartAt: null,
        scheduledEndAt: null,
        scheduleSource: "human",
      });
    });
  });

  it("shows error message when action fails", async () => {
    mockedApply.mockRejectedValueOnce(new Error("Server error"));

    render(
      <ScheduleEditorForm
        {...baseProps}
        dueAt={new Date("2026-04-15T10:00:00Z")}
      />,
    );

    const submitButton = screen.getByRole("button", { name: "Apply Schedule" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeDefined();
    });
  });

  it("shows validation error when no fields filled", async () => {
    render(<ScheduleEditorForm {...baseProps} />);

    const submitButton = screen.getByRole("button", { name: "Apply Schedule" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText("At least one scheduling field is required."),
      ).toBeDefined();
    });
  });

  it("shows pending state during submission", async () => {
    let resolvePromise: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    mockedApply.mockReturnValueOnce(promise as any);

    render(
      <ScheduleEditorForm
        {...baseProps}
        dueAt={new Date("2026-04-15T10:00:00Z")}
      />,
    );

    const submitButton = screen.getByRole("button", { name: "Apply Schedule" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Saving…")).toBeDefined();
    });

    resolvePromise!();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Apply Schedule" })).toBeDefined();
    });
  });

  it("clear schedule button calls clearSchedule", async () => {
    render(<ScheduleEditorForm {...baseProps} />);

    const clearButton = screen.getByRole("button", { name: "Clear Schedule" });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockedClear).toHaveBeenCalledWith({ taskId: "task-1" });
    });
  });

  it("clear button hidden when allowClear=false", () => {
    render(<ScheduleEditorForm {...baseProps} allowClear={false} />);

    expect(screen.queryByRole("button", { name: "Clear Schedule" })).toBeNull();
  });

  it("calls onMutatedAction after successful submit", async () => {
    const onMutated = vi.fn();

    render(
      <ScheduleEditorForm
        {...baseProps}
        dueAt={new Date("2026-04-15T10:00:00Z")}
        onMutatedAction={onMutated}
      />,
    );

    const submitButton = screen.getByRole("button", { name: "Apply Schedule" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onMutated).toHaveBeenCalledOnce();
    });
  });

  it("calls onMutatedAction after successful clear", async () => {
    const onMutated = vi.fn();

    render(
      <ScheduleEditorForm {...baseProps} onMutatedAction={onMutated} />,
    );

    const clearButton = screen.getByRole("button", { name: "Clear Schedule" });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(onMutated).toHaveBeenCalledOnce();
    });
  });
});
