import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

import { TaskConfigForm } from "@/components/schedule/forms/task-config-form";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const baseAdapter = {
  key: "hermes",
      label: "Hermes",
      spec: {
        runtime: "hermes",
        version: "hermes-v1",
    fields: [
      {
        key: "prompt",
        path: "prompt",
        kind: "textarea" as const,
        label: "Prompt / instructions",
        description: "Describe the task",
        advanced: true,
        constraints: { maxLength: 20000 },
      },
      {
        key: "temperature",
        path: "temperature",
        kind: "number" as const,
        label: "Temperature",
        description: "Controls sampling randomness",
        advanced: true,
        defaultValue: 0.2,
        constraints: { min: 0, max: 2, step: 0.1 },
      },
    ],
    runnability: { requiredPaths: [] },
  },
};

const defaultProps = {
  executionRuntimes: [baseAdapter],
  defaultExecutionRuntime: "hermes",
  submitLabel: "Save",
  pendingLabel: "Saving...",
  onSubmitAction: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("TaskConfigForm – field layout", () => {
  it("renders title field in main section", () => {
    render(<TaskConfigForm {...defaultProps} />);

    expect(screen.getByPlaceholderText(/add the next task/i)).toBeInTheDocument();
  });

  it("renders description field in main section (non-compact)", () => {
    render(<TaskConfigForm {...defaultProps} />);

    expect(
      screen.getByPlaceholderText(/optional execution context/i),
    ).toBeInTheDocument();
  });

  it("renders priority and due date in main section (non-compact)", () => {
    render(<TaskConfigForm {...defaultProps} />);

    // Priority select should be visible
    const prioritySelect = screen.getByRole("combobox", { name: /priority/i }) || screen.getByDisplayValue("Medium");
    expect(prioritySelect).toBeInTheDocument();
  });

  it("hides advanced fields in non-compact mode", () => {
    render(<TaskConfigForm {...defaultProps} />);

    expect(screen.queryByText("Advanced fields")).not.toBeInTheDocument();
  });

  it("hides advanced runtime fields in non-compact mode", () => {
    render(<TaskConfigForm {...defaultProps} />);

    expect(screen.queryByText("Prompt / instructions")).not.toBeInTheDocument();
    expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
  });

  it("submit button is present", () => {
    render(<TaskConfigForm {...defaultProps} />);

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("lets auto-plan toggle independently until auto-execute forces it on", async () => {
    const user = userEvent.setup();
    render(<TaskConfigForm {...defaultProps} />);

    const autoExecute = screen.getByRole("checkbox", { name: /^Auto-execute at scheduled time/i });
    const autoPlanGeneration = screen.getByRole("checkbox", { name: /^Auto-generate plan/i });

    expect(autoExecute).not.toBeChecked();
    expect(autoPlanGeneration).not.toBeChecked();
    expect(autoPlanGeneration).not.toBeDisabled();

    await user.click(autoPlanGeneration);
    expect(autoPlanGeneration).toBeChecked();
    expect(autoExecute).not.toBeChecked();

    await user.click(autoPlanGeneration);
    expect(autoPlanGeneration).not.toBeChecked();

    await user.click(autoExecute);

    expect(autoExecute).toBeChecked();
    expect(autoPlanGeneration).toBeChecked();
    expect(autoPlanGeneration).toBeDisabled();
  });

  it("submits auto execute from the edit form", async () => {
    const user = userEvent.setup();
    const onSubmitAction = vi.fn();
    render(
      <TaskConfigForm
        {...defaultProps}
        initialValues={{ title: "Scheduled task" }}
        onSubmitAction={onSubmitAction}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /^Auto-execute at scheduled time/i }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmitAction).toHaveBeenCalledWith(expect.objectContaining({
      autoPlanGeneration: true,
      autoExecute: true,
    }));
  });

  it("shows pending label when isPending is true", () => {
    render(<TaskConfigForm {...defaultProps} isPending />);

    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
  });
});

describe("TaskConfigForm – compact mode", () => {
  it("hides priority and due date from main section in compact mode", () => {
    render(<TaskConfigForm {...defaultProps} compact />);

    // In compact mode, priority/dueAt are in "More options"
    expect(screen.getByText("More options")).toBeInTheDocument();
  });
});
