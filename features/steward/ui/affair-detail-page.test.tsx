import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import { apiJson } from "@shared/http";
import en from "../../../packages/i18n/src/messages/en.json";
import { detailFixture, emptyToday, fileFixture } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { AffairDetailPage } from "./affair-detail-page";

vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function page(query = "") {
  render(<MemoryRouter initialEntries={[`/en/affairs/camera${query}`]}><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><Routes><Route path="/:lang/affairs/:affairId" element={<AffairDetailPage />} /></Routes></StewardSession></I18nProvider></MemoryRouter>);
}
function mockPages(detail: ReturnType<typeof detailFixture>, files: Record<string, string>) {
  vi.mocked(apiJson).mockImplementation(async url => {
    const path = String(url);
    if (path.includes("/provider/runs?")) return { items: [] };
    if (path.includes("/ui-event")) return { ok: true };
    if (path.includes("/file?")) {
      const requested = new URL(path, "http://chrona.test").searchParams.get("path") ?? "README.md";
      return { ...fileFixture(), path: requested, content: files[requested] ?? "" };
    }
    if (path.includes("/revisions")) return { items: [] };
    if (path.includes("/affairs/camera")) return detail;
    return emptyToday();
  });
}
const entrySpec = JSON.stringify({ root: "text", elements: { text: { type: "Text", props: { text: "Your composed page" }, children: [] } } });
it.each([
  ["", "home.ui.json", true],
  ["?path=other.ui.json", "other.ui.json", true],
  ["?path=README.md", "README.md", false],
])("renders entry or explicit page %s", async (query, selected, composed) => {
  const detail = detailFixture();
  detail.entry = "home.ui.json";
  detail.approvals = [];
  const spec = { root: "status", elements: { status: { type: "Text", props: { text: "Your composed page" }, children: [] } } };
  vi.mocked(apiJson).mockImplementation(async url => {
    const path = String(url);
    if (path.includes("/provider/runs?")) return { items: [] };
    if (path.includes("/ui-event")) return { ok: true };
    if (path.includes("/file?")) return { ...fileFixture(), path: selected, content: composed ? JSON.stringify(spec) : "# Markdown plan" };
    if (path.includes("/revisions")) return { items: [] };
    if (path.includes("/affairs/camera")) return detail;
    return emptyToday();
  });
  page(query);
  if (composed) {
    expect(await screen.findByText("Your composed page")).toBeVisible();
    expect(screen.getByText(en.steward.affairCenter.secondLevel, { selector: "summary" }).parentElement).not.toHaveAttribute("open");
    expect(screen.queryByRole("heading", { name: "Markdown plan" })).not.toBeInTheDocument();
  } else {
    expect(await screen.findByRole("heading", { name: "Markdown plan" })).toBeVisible();
    expect(screen.queryByText("Your composed page")).not.toBeInTheDocument();
  }
});
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
    if (path.includes("/provider/runs?")) return { items: [] };
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
it.each(["notes/day.md", "other.ui.json"])("returns from a directly opened secondary page %s without browser history", async path => {
  const detail = detailFixture(); detail.entry = "home.ui.json"; detail.approvals = [];
  detail.files.push({ ...detail.files[0]!, path });
  mockPages(detail, { "home.ui.json": entrySpec, [path]: path.endsWith(".ui.json") ? entrySpec.replace("Your composed page", "Secondary page") : "# Day materials\n\nPractice here." });
  page(`?${new URLSearchParams({ path })}`);
  expect(await screen.findByText(path.endsWith(".ui.json") ? "Secondary page" : "Day materials")).toBeVisible();
  const back = screen.getByRole("link", { name: "Back to home" });
  expect(back).toHaveAttribute("href", "/en/affairs/camera");
  expect(screen.queryByRole("heading", { name: en.steward.affairCenter.now })).not.toBeInTheDocument();
  await userEvent.click(back);
  expect(await screen.findByText("Your composed page")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Back to home" })).not.toBeInTheDocument();
});
it.each(["README.md", "home.ui.json"])("does not lose or duplicate the README paragraph with entry %s", async entry => {
  const detail = detailFixture(); detail.entry = entry; detail.approvals = [];
  detail.affair.summary = "Keep this important context.";
  mockPages(detail, { "README.md": "# Plan\n\nKeep this important context.\n\n- [ ] Practice", "home.ui.json": entrySpec });
  page("?path=README.md");
  expect(await screen.findByRole("checkbox", { name: "Practice" })).toBeVisible();
  expect(screen.getAllByText("Keep this important context.")).toHaveLength(1);
  expect(screen.getByText("Keep this important context.")).toBeVisible();
});
it("keeps authoritative work and next arrangement visible outside the generated entry", async () => {
  const detail = detailFixture(); detail.entry = "home.ui.json"; detail.approvals = [];
  detail.affair.work = { state: "running", label: "Prepare day two", since: detail.affair.createdAt };
  detail.affair.nextSchedule = { mode: "wake", label: "Tomorrow's materials", at: "2026-10-18T01:00:00Z" };
  mockPages(detail, { "home.ui.json": entrySpec });
  page();
  expect(await screen.findByText("Your composed page")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Working on: Prepare day two");
  expect(screen.getByText(/Next: Tomorrow's materials/)).toBeVisible();
});
