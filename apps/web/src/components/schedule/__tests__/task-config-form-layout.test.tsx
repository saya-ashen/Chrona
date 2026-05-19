import { cleanup, render, screen } from "@testing-library/react";
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
  key: "openclaw",
      label: "OpenClaw",
      spec: {
        runtime: "openclaw",
        version: "openclaw-v1",
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
  defaultExecutionRuntime: "openclaw",
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
