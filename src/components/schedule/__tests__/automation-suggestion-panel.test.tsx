import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AutomationSuggestion } from "@/modules/ai/types";
import { AutomationSuggestionPanel } from "../automation-suggestion-panel";

vi.mock("@/lib/utils", () => ({ cn: (...args: any[]) => args.filter(Boolean).join(" ") }));
vi.mock("lucide-react", () => ({
  Bot: (props: any) => <span data-testid="bot-icon" {...props} />,
  Clock: (props: any) => <span data-testid="clock-icon" {...props} />,
  FileText: (props: any) => <span data-testid="file-icon" {...props} />,
  Lightbulb: (props: any) => <span data-testid="lightbulb-icon" {...props} />,
  Zap: (props: any) => <span data-testid="zap-icon" {...props} />,
}));

function makeSuggestion(overrides: Partial<AutomationSuggestion> = {}): AutomationSuggestion {
  return {
    executionMode: "immediate",
    confidence: "high",
    reminderStrategy: { advanceMinutes: 15, frequency: "once", channels: ["push"] },
    preparationSteps: ["Step A", "Step B"],
    contextSources: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("AutomationSuggestionPanel", () => {
  it("returns null when no suggestion and not loading", () => {
    const { container } = render(<AutomationSuggestionPanel suggestion={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows loading state with 'AI is analyzing' text", () => {
    render(<AutomationSuggestionPanel suggestion={null} isLoading />);
    expect(screen.getByText(/AI is analyzing/)).toBeInTheDocument();
  });

  it("renders execution mode info when suggestion provided", () => {
    render(<AutomationSuggestionPanel suggestion={makeSuggestion()} />);
    expect(screen.getByText("Immediate")).toBeInTheDocument();
    expect(screen.getByText("Run as soon as the task is created")).toBeInTheDocument();
  });

  it("shows confidence badge", () => {
    render(<AutomationSuggestionPanel suggestion={makeSuggestion({ confidence: "medium" })} />);
    expect(screen.getByText("medium confidence")).toBeInTheDocument();
  });

  it("shows reasoning via preparation steps", () => {
    render(<AutomationSuggestionPanel suggestion={makeSuggestion()} />);
    expect(screen.getByText("Step A")).toBeInTheDocument();
    expect(screen.getByText("Step B")).toBeInTheDocument();
  });

  it("calls onApplyExecutionMode when execution mode button clicked", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(
      <AutomationSuggestionPanel
        suggestion={makeSuggestion({ executionMode: "scheduled" })}
        onApplyExecutionMode={handler}
      />,
    );
    await user.click(screen.getByText("Scheduled"));
    expect(handler).toHaveBeenCalledWith("scheduled");
  });

  it("shows reminder suggestion and calls onApplyReminder when clicked", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(
      <AutomationSuggestionPanel
        suggestion={makeSuggestion()}
        onApplyReminder={handler}
      />,
    );
    expect(screen.getByText(/15min before/)).toBeInTheDocument();
    await user.click(screen.getByText(/15min before/));
    expect(handler).toHaveBeenCalledWith(15);
  });
});
