import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { apiJson } from "@shared/http";
import { appFixture, emptyToday, fileFixture, fixtureTime } from "../model/fixtures";
import { StewardSession } from "../hooks/use-steward-session";
import { AppDetailPage } from "./app-detail-page";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function show(content = true) {
  vi.mocked(apiJson).mockImplementation(async (url) => {
    const path = String(url).split("?")[0]!;
    if (path.endsWith("/today")) return emptyToday();
    if (path.endsWith("/apps")) return { items: [{ ...appFixture(), content }] };
    if (path.endsWith("/tree")) return { items: ["README.md", "notes/day.md"].map(path => ({ path, kind: "file", size: 20, updatedAt: fixtureTime })) };
    if (path.endsWith("/file")) return fileFixture();
    return { ok: true };
  });
  render(<MemoryRouter initialEntries={["/en/apps/camera"]}><I18nProvider locale="en" messages={en}><StewardSession workspaceId="ws"><Routes><Route path="/:lang/apps/:appId" element={<AppDetailPage />} /></Routes></StewardSession></I18nProvider></MemoryRouter>);
}
it("opens the entry Markdown and exposes the content tree, upload and raw editing", async () => {
  show();
  expect(await screen.findByRole("heading", { name: "相机" })).toBeVisible();
  expect(screen.getByRole("link", { name: "README" })).toHaveAttribute("aria-current", "page");
  await userEvent.click(screen.getByText("notes", { selector: "summary" }));
  expect(screen.getByRole("link", { name: "day" })).toHaveAttribute("href", "/en/apps/camera?path=notes%2Fday.md");
  expect(screen.getByLabelText(en.steward.appActions.upload)).toHaveAttribute("type", "file");
  await userEvent.click(screen.getByRole("button", { name: en.steward.appFile.edit }));
  expect(screen.getByRole("textbox", { name: en.steward.appFile.editor })).toHaveValue(fileFixture().content);
  expect(apiJson).toHaveBeenCalledWith("/api/steward/apps/camera/file?workspaceId=ws&path=README.md", expect.anything());
});
it("explains apps without a content area", async () => {
  show(false);
  expect(await screen.findByText(en.steward.apps.noContent)).toBeVisible();
  expect(screen.queryByLabelText(en.steward.appActions.upload)).not.toBeInTheDocument();
});
