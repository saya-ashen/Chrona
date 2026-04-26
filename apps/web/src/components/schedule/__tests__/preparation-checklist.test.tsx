import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreparationChecklist, type PreparationStep } from "../preparation-checklist";

vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));
vi.mock("@/lib/utils", () => ({ cn: (...args: any[]) => args.filter(Boolean).join(" ") }));
vi.mock("lucide-react", () => ({
  CheckCircle2: (props: any) => <span data-testid="check-icon" {...props} />,
  Circle: (props: any) => <span data-testid="circle-icon" {...props} />,
  FileText: (props: any) => <span data-testid="file-icon" {...props} />,
}));

const steps: PreparationStep[] = [
  { id: "1", text: "Prepare documents" },
  { id: "2", text: "Review notes" },
  { id: "3", text: "Send invites", completed: true },
];

afterEach(cleanup);

describe("PreparationChecklist", () => {
  it("shows empty message when no steps", () => {
    render(<PreparationChecklist steps={[]} />);
    expect(screen.getByText("No preparation steps identified.")).toBeInTheDocument();
  });

  it("shows custom empty message", () => {
    render(<PreparationChecklist steps={[]} emptyMessage="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders all steps with text", () => {
    render(<PreparationChecklist steps={steps} />);
    expect(screen.getByText("Prepare documents")).toBeInTheDocument();
    expect(screen.getByText("Review notes")).toBeInTheDocument();
    expect(screen.getByText("Send invites")).toBeInTheDocument();
  });

  it("toggles step completion on click", async () => {
    const user = userEvent.setup();
    render(<PreparationChecklist steps={steps} />);
    // Initially step 1 is not completed
    await user.click(screen.getByText("Prepare documents"));
    // After click, completed count should change from 1/3 to 2/3
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("shows progress bar percentage", () => {
    const { container } = render(<PreparationChecklist steps={steps} />);
    // 1 out of 3 completed = 33%
    const progressBar = container.querySelector("[style]");
    expect(progressBar).toHaveStyle({ width: "33%" });
  });

  it("calls onToggle callback when step toggled", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(<PreparationChecklist steps={steps} onToggle={handler} />);
    await user.click(screen.getByText("Prepare documents"));
    expect(handler).toHaveBeenCalledWith("1", true);
  });

  it("shows completed count", () => {
    render(<PreparationChecklist steps={steps} />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });
});
