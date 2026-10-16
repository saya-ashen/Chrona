import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import { apiJson } from "@shared/http";
import en from "../../../packages/i18n/src/messages/en.json";
import { detailFixture, emptyToday } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { AffairDetailPage } from "./affair-detail-page";

vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function page() {
  render(<MemoryRouter initialEntries={["/en/affairs/camera"]}><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><Routes><Route path="/:lang/affairs/:affairId" element={<AffairDetailPage />} /></Routes></StewardSession></I18nProvider></MemoryRouter>);
}
it("shows loading while detail is unavailable", () => {
  vi.mocked(apiJson).mockImplementation(() => new Promise(() => {}));
  page();
  expect(screen.getByRole("status", { name: en.steward.foundation.loading })).toBeVisible();
  expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
});
it("shows request errors and a retry action", async () => {
  vi.mocked(apiJson).mockRejectedValue(new Error("offline"));
  page();
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("button", { name: en.steward.foundation.retry })).toBeVisible();
});
it("shows empty pages, approvals before content, and collapsed secondary sections", async () => {
  const detail = detailFixture(); detail.files = []; detail.schedules = [];
  vi.mocked(apiJson).mockImplementation(async url => {
    const path = String(url);
    if (path.includes("/revisions")) return { items: [], nextCursor: null };
    if (path.includes("/affairs/camera")) return detail;
    return emptyToday();
  });
  page();
  expect(await screen.findByRole("heading", { name: detail.affair.title })).toBeVisible();
  expect(screen.getAllByText(en.steward.affairFile.empty)).toHaveLength(2);
  expect(screen.getByRole("heading", { name: en.steward.foundation.decisions })).toBeVisible();
  const approval = screen.getByRole("heading", { name: en.steward.foundation.decisions });
  const content = screen.getByRole("region", { name: "README.md" });
  expect(approval.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText(/^Technical details:/, { selector: "summary" }).parentElement).not.toHaveAttribute("open");
  expect(screen.getByText("Revision history", { selector: "summary" }).parentElement).not.toHaveAttribute("open");
});
