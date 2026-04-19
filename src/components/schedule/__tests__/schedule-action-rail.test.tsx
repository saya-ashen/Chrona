import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleActionRail } from "../schedule-action-rail";

vi.mock("@/components/ui/button", () => ({ buttonVariants: () => "btn" }));
vi.mock("@/components/ui/surface-card", () => ({
  SurfaceCard: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SurfaceCardDescription: ({ children }: any) => <p>{children}</p>,
  SurfaceCardHeader: ({ children }: any) => <div>{children}</div>,
  SurfaceCardTitle: ({ children }: any) => <h3>{children}</h3>,
}));

const sections = [
  { value: "queue" as const, label: "Queue", title: "Queue Title", description: "Queue desc", body: <span>Queue Body</span> },
  { value: "risks" as const, label: "Risks", title: "Risks Title", body: <span>Risks Body</span> },
  { value: "proposals" as const, label: "Proposals", title: "Proposals Title", body: <span>Proposals Body</span> },
  { value: "conflicts" as const, label: "Conflicts", title: "Conflicts Title", body: <span>Conflicts Body</span> },
];

const defaultProps = {
  ariaLabel: "Action Rail",
  tablistAriaLabel: "Sections",
  activeTab: "queue" as const,
  onTabChange: vi.fn(),
  sections,
};

function renderRail(overrides = {}) {
  const props = { ...defaultProps, onTabChange: vi.fn(), ...overrides };
  const result = render(<ScheduleActionRail {...props} />);
  return { ...result, onTabChange: props.onTabChange };
}

afterEach(cleanup);

describe("ScheduleActionRail", () => {
  it("renders tab buttons for all sections", () => {
    renderRail();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.textContent)).toEqual(["Queue", "Risks", "Proposals", "Conflicts"]);
  });

  it("active tab has aria-selected=true", () => {
    renderRail({ activeTab: "risks" });
    expect(screen.getByRole("tab", { name: "Risks" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Queue" })).toHaveAttribute("aria-selected", "false");
  });

  it("clicking tab calls onTabChange", async () => {
    const { onTabChange } = renderRail();
    await userEvent.click(screen.getByRole("tab", { name: "Risks" }));
    expect(onTabChange).toHaveBeenCalledWith("risks");
  });

  it("shows the body of the active tab panel", () => {
    renderRail({ activeTab: "queue" });
    expect(screen.getByText("Queue Body")).toBeVisible();
    expect(screen.getByText("Risks Body")).not.toBeVisible();
  });

  it("ArrowRight key cycles to next tab", async () => {
    const { onTabChange } = renderRail({ activeTab: "queue" });
    const tab = screen.getByRole("tab", { name: "Queue" });
    tab.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onTabChange).toHaveBeenCalledWith("risks");
  });

  it("ArrowLeft key cycles to previous tab", async () => {
    const { onTabChange } = renderRail({ activeTab: "risks" });
    const tab = screen.getByRole("tab", { name: "Risks" });
    tab.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onTabChange).toHaveBeenCalledWith("queue");
  });

  it("Home key goes to first tab", async () => {
    const { onTabChange } = renderRail({ activeTab: "conflicts" });
    const tab = screen.getByRole("tab", { name: "Conflicts" });
    tab.focus();
    await userEvent.keyboard("{Home}");
    expect(onTabChange).toHaveBeenCalledWith("queue");
  });

  it("End key goes to last tab", async () => {
    const { onTabChange } = renderRail({ activeTab: "queue" });
    const tab = screen.getByRole("tab", { name: "Queue" });
    tab.focus();
    await userEvent.keyboard("{End}");
    expect(onTabChange).toHaveBeenCalledWith("conflicts");
  });

  it("wraps around from last to first on ArrowRight", async () => {
    const { onTabChange } = renderRail({ activeTab: "conflicts" });
    const tab = screen.getByRole("tab", { name: "Conflicts" });
    tab.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onTabChange).toHaveBeenCalledWith("queue");
  });

  it("optional id prop is passed to root element", () => {
    const { container } = renderRail({ id: "my-rail" });
    expect(container.querySelector("#my-rail")).toBeTruthy();
  });
});
