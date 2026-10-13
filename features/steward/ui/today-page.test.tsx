import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayPage } from "./today-page";
import { decisionItem, emptyToday, timestamp } from "../model/fixtures";
import { I18nProvider } from "@chrona/i18n/react";
import en from "@chrona/i18n/messages/en.json";
const mocks = vi.hoisted(() => ({ today: vi.fn(), decideAttention: vi.fn() }));
vi.mock("../model/client", () => ({ createStewardClient: () => mocks }));
function show() { render(<I18nProvider locale="en" messages={en}><TodayPage workspaceId="workspace-test" /></I18nProvider>); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(Date, "now").mockReturnValue(Date.parse(timestamp)); mocks.today.mockResolvedValue(emptyToday()); mocks.decideAttention.mockResolvedValue(decisionItem()); });
describe("Today page", () => {
  it("announces loading", () => { mocks.today.mockReturnValue(new Promise(() => {})); show(); expect(screen.getByRole("status")).toHaveTextContent("Loading"); });
  it("shows read errors and reload action", async () => { mocks.today.mockRejectedValue(new Error("offline")); show(); expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.error); expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(); });
  it("shows a healthy empty state", async () => { show(); expect(await screen.findByText(en.steward.allClear)).toBeVisible(); });
  it("renders evidence, status and next action; approves then refreshes", async () => {
    const view = emptyToday(); view.decisions = [decisionItem()]; mocks.today.mockResolvedValueOnce(view).mockResolvedValue(emptyToday()); show();
    expect(await screen.findByRole("heading", { name: "Confirm follow-up" })).toBeVisible();
    expect(screen.getByText("Your response is due sooner")).toBeVisible();
    expect(screen.getByText("Approve the follow-up")).toBeVisible(); expect(screen.getByText("Open")).toBeVisible();
    expect(screen.getByRole("link", { name: "Source message" })).toHaveAttribute("href", "https://example.com/evidence");
    expect(screen.getByText("Please reply tomorrow")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mocks.decideAttention).toHaveBeenCalledWith("attention-1", { decision: "approve" });
    await waitFor(() => expect(mocks.today).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(en.steward.allClear)).toBeVisible();
  });
  it("shows unavailable assessor and pending age without claiming all-clear", async () => {
    const view = emptyToday(); view.health.assessor.available = false; view.health.pendingEvents = 3; view.health.oldestPendingAt = timestamp; mocks.today.mockResolvedValue(view); show();
    expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.assessor);
    expect(screen.getByText(timestamp)).toBeVisible(); expect(screen.queryByText(en.steward.allClear)).not.toBeInTheDocument();
  });
  it("keeps an unconfirmed decision visible and offers reload", async () => {
    const view = emptyToday(); view.decisions = [decisionItem()]; mocks.today.mockResolvedValue(view); mocks.decideAttention.mockRejectedValue(new Error("offline")); show();
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.decisionError);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByRole("button", { name: "Approve" })).toBeEnabled();
  });
  it.each(["resolved", "snoozed"] as const)("shows %s status without decision buttons", async status => {
    const view = emptyToday(); view.decisions = [{ ...decisionItem(), status }]; mocks.today.mockResolvedValue(view); show();
    expect(await screen.findByText(en.steward.statuses[status])).toBeVisible(); expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
