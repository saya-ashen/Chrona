import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import { apiJson } from "@shared/http";
import en from "../../../packages/i18n/src/messages/en.json";
import { affairFixture, emptyToday } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { AffairsPage } from "./affairs-page";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function show() {
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><AffairsPage /></StewardSession></I18nProvider></MemoryRouter>);
}
it("renders decisions first, plain summaries, next label and collapsed ended affairs", async () => {
  const affair = affairFixture();
  vi.mocked(apiJson).mockImplementation(async url => String(url).includes("/affairs?") ? { items: [
    { ...affair, summary: "Read [the comparison](day-01.md) with **results**", nextSchedule: { at: affair.createdAt, mode: "wake", label: "Compare lenses" } },
    { ...affair, id: "active", title: "Active affair", openApprovals: 0, work: { state: "running", since: affair.createdAt, label: null } },
    { ...affair, id: "paused", title: "Paused affair", status: "paused", openApprovals: 0 },
    { ...affair, id: "done", title: "Ended affair", status: "done", openApprovals: 0 },
  ] } : emptyToday());
  show();
  expect(await screen.findByRole("heading", { name: "In progress" })).toBeVisible();
  expect(screen.getAllByRole("heading").map(h => h.textContent)).toEqual(["Affairs", "Waiting for you", "In progress", "Paused"]);
  expect(screen.getByText(en.steward.affairCenter.runningPill)).toBeVisible();
  expect(screen.getByText("Read the comparison with results")).toBeVisible();
  expect(screen.queryByText(/day-01.md/)).not.toBeInTheDocument();
  expect(screen.getByText(/Next: Compare lenses/)).toBeVisible();
  expect(screen.getByText("Ended affair")).not.toBeVisible();
  await userEvent.click(screen.getByText("Ended · 1"));
  expect(screen.getByRole("link", { name: "Ended affair" })).toBeVisible();
});
it("shows an empty list", async () => {
  vi.mocked(apiJson).mockImplementation(async url => String(url).includes("/affairs?") ? { items: [] } : emptyToday());
  show(); expect(await screen.findByText(en.steward.affairs.empty)).toBeVisible();
});
it("shows loading", () => {
  vi.mocked(apiJson).mockImplementation(() => new Promise(() => {}));
  show(); expect(screen.getByRole("status", { name: en.steward.foundation.loading })).toBeVisible();
});
it("shows a retry action after failure", async () => {
  vi.mocked(apiJson).mockRejectedValue(new Error("offline"));
  show(); expect(await screen.findByRole("button", { name: en.steward.foundation.retry })).toBeVisible();
});
