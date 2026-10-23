import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { apiJson } from "@shared/http";
import { approvalFixture, emptyToday, todayFixture } from "../model/fixtures";
import { TodayPage } from "./today-page";
import { StewardSession } from "../hooks/use-steward-session";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
function show() {
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><TodayPage /></StewardSession></I18nProvider></MemoryRouter>);
}
function mockView(view: ReturnType<typeof emptyToday>) {
  vi.mocked(apiJson).mockImplementation(async url => String(url).includes("/provider/runs?") ? { items: [] } : String(url).includes("/resolve?") ? approvalFixture() : view);
}
beforeEach(() => { mockView(todayFixture()); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("shows decisions before upcoming, updates, apps and sessions", async () => {
  const view = todayFixture();
  view.upcoming.push({ ...view.upcoming[0]!, scheduleId: "work", mode: "wake", label: "Prepare comparison" });
  view.upcoming.push({ ...view.upcoming[0]!, scheduleId: "reminder", mode: "module", label: "Drink water" });
  mockView(view); show();
  await screen.findByRole("heading", { name: approvalFixture().title });
  const headings = screen.getAllByRole("heading").map(h => h.textContent);
  expect(headings.indexOf(en.steward.foundation.decisions)).toBeLessThan(headings.indexOf(en.steward.foundation.upcoming));
  expect(screen.getByText("Prepare comparison")).toBeVisible();
  expect(screen.getByText("Drink water")).toBeVisible();
  expect(screen.getByRole("link", { name: /^camera二手/ })).toHaveAttribute("href", "/en/apps/camera");
  expect(screen.getByRole("link", { name: "相机选购 · web" })).toHaveAttribute("href", "/en/chat?sessionId=session-1");
  expect(screen.getByText(en.steward.workspace.healthy)).toBeVisible();
});
it("shows the empty summary", async () => {
  mockView(emptyToday()); show();
  expect(await screen.findByText(en.steward.foundation.clear)).toBeVisible();
});
it.each(["once", "always", "deny"] as const)("resolves %s with explicit scope", async action => {
  show(); await screen.findByRole("heading", { name: en.steward.foundation.decisions });
  await userEvent.click(screen.getByText(en.steward.workspace.preview));
  expect(screen.getByText(approvalFixture().preview)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: en.steward.workspace[action] }));
  await waitFor(() => expect(apiJson).toHaveBeenCalledWith("/api/steward/approvals/email/resolve?workspaceId=ws", expect.objectContaining({ body: JSON.stringify({ decision: action === "deny" ? "deny" : "approve", scope: action === "always" ? "always" : "once" }) })));
});
it("shows loading while Today is unavailable", () => {
  vi.mocked(apiJson).mockImplementation(() => new Promise(() => {}));
  show(); expect(screen.getByRole("status", { name: en.steward.foundation.loading })).toBeVisible();
});
it("shows retry when Today fails", async () => {
  vi.mocked(apiJson).mockRejectedValue(new Error("offline"));
  show(); expect(await screen.findByRole("button", { name: en.steward.foundation.retry })).toBeVisible();
});
it("says why apps cannot run when the module sandbox is missing", async () => {
  const view = todayFixture();
  view.health.moduleSandbox = false;
  mockView(view); show();
  expect(await screen.findByRole("alert")).toHaveTextContent(en.steward.workspace.noSandbox);
  expect(screen.getByText(en.steward.workspace.unhealthy)).toBeVisible();
});
