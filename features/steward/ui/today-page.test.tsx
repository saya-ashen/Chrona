import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { apiJson } from "@shared/http";
import { approvalFixture, chatFixture, emptyToday, fixtureTime, todayFixture } from "../model/fixtures";
import { TodayPage } from "./today-page";
import { Composer } from "./composer";
import { StewardSession, useStewardSession } from "../hooks/use-steward-session";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
function TestPage() {
  const session = useStewardSession();
  return <><Composer client={session.today.client} lang="en" refresh={session.refresh} onPendingChange={session.setChatPending} /><TodayPage /></>;
}
function show() {
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><TestPage /></StewardSession></I18nProvider></MemoryRouter>);
}
beforeEach(() => { vi.mocked(apiJson).mockResolvedValue(todayFixture()); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("renders approvals first, progress messages instead of files, and safe upcoming labels", async () => {
  const view = todayFixture();
  view.progress[0]!.updates.push({ title: "Older update", body: "Earlier comparison", at: fixtureTime });
  view.upcoming.push({ ...view.upcoming[0]!, scheduleId: "work", mode: "wake", label: "Prepare comparison" });
  vi.mocked(apiJson).mockResolvedValue(view);
  show();
  await screen.findByRole("heading", { name: en.steward.foundation.decisions });
  expect(screen.getAllByRole("heading").map(h => h.textContent)).toEqual(["Today", en.steward.foundation.decisions, approvalFixture().title, en.steward.overview.progress, en.steward.foundation.upcoming]);
  expect(screen.getByText("比较已备好")).toBeVisible();
  expect(screen.getByText("加入富士比较")).toBeVisible();
  expect(screen.queryByText(/README.md/)).not.toBeInTheDocument();
  expect(screen.getByText(/Prepare comparison/)).toBeVisible();
  expect(screen.getByText("Older update")).not.toBeVisible();
  await userEvent.click(screen.getByText(en.steward.overview.earlier));
  expect(screen.getByText("Older update")).toBeVisible();
  expect(screen.getByText(en.steward.workspace.healthy)).toBeVisible();
});
it("shows the empty summary without obsolete sections", async () => {
  vi.mocked(apiJson).mockResolvedValue(emptyToday()); show();
  expect(await screen.findByText(en.steward.foundation.clear)).toBeVisible();
  expect(screen.queryByRole("heading", { name: en.steward.foundation.decisions })).not.toBeInTheDocument();
});
it.each(["once", "always", "deny"] as const)("resolves %s with explicit scope", async action => {
  show(); await screen.findByRole("heading", { name: en.steward.foundation.decisions });
  await userEvent.click(screen.getByText(en.steward.workspace.preview));
  expect(screen.getByText(approvalFixture().preview)).toBeVisible();
  vi.mocked(apiJson).mockResolvedValueOnce(approvalFixture()).mockResolvedValue(todayFixture());
  await userEvent.click(screen.getByRole("button", { name: en.steward.workspace[action] }));
  await waitFor(() => expect(apiJson).toHaveBeenCalledWith("/api/steward/approvals/email/resolve?workspaceId=ws", expect.objectContaining({ body: JSON.stringify({ decision: action === "deny" ? "deny" : "approve", scope: action === "always" ? "affair" : "once" }) })));
});
it("links to the optional today page without loading Markdown", async () => {
  vi.mocked(apiJson).mockResolvedValue({ ...emptyToday(), todayPage: { affairId: "camera", path: "README.md" } });
  show(); expect(await screen.findByRole("link", { name: en.steward.overview.todayPage })).toHaveAttribute("href", "/en/affairs/camera?path=README.md");
});
it("shows loading while Today is unavailable", () => {
  vi.mocked(apiJson).mockImplementation(() => new Promise(() => {}));
  show(); expect(screen.getByRole("status", { name: en.steward.foundation.loading })).toBeVisible();
});
it("shows retry when Today fails", async () => {
  vi.mocked(apiJson).mockRejectedValue(new Error("offline"));
  show(); expect(await screen.findByRole("button", { name: en.steward.foundation.retry })).toBeVisible();
});
it("shows plain summary fallback, current work and generic upcoming work", async () => {
  const view = todayFixture();
  view.approvals = [];
  view.progress[0]!.updates = [];
  view.progress[0]!.changedPages = 0;
  view.progress[0]!.affair.summary = "Read [the result](day-01.md)";
  view.progress[0]!.affair.work = { state: "queued", since: fixtureTime, label: "Compare" };
  view.upcoming[0]!.mode = "wake";
  view.upcoming[0]!.label = null;
  vi.mocked(apiJson).mockResolvedValue(view);
  show();
  expect(await screen.findByText("Read the result")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(en.steward.affairCenter.queued.replace("{label}", "Compare"));
  expect(screen.getByText(new RegExp(en.steward.affairCenter.followUp))).toBeVisible();
  expect(screen.queryByText(/Updated 0 pages/)).not.toBeInTheDocument();
});
it("composer waits then displays the latest reply and page attachment", async () => {
  show(); await screen.findByRole("heading", { name: en.steward.foundation.decisions });
  let resolve!: (value: unknown) => void;
  vi.mocked(apiJson).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await userEvent.type(screen.getByRole("textbox", { name: en.steward.foundation.composer }), "Budget 6000{Enter}");
  expect(screen.getByRole("status")).toHaveTextContent(en.steward.foundation.pending);
  resolve(chatFixture);
  expect(await screen.findByText(chatFixture.messages[0]!.text)).toBeVisible();
  expect(screen.getByRole("link", { name: "相机比较" })).toHaveAttribute("href", "/en/affairs/camera?path=README.md");
  expect(screen.getByText(/You · Budget 6000/)).toBeVisible();
});
