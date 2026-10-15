import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import en from "../../../packages/i18n/src/messages/en.json";
import { apiJson } from "@shared/http";
import { approvalFixture, chatFixture, emptyToday, fileFixture, todayFixture } from "../model/fixtures";
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
it("renders approvals, agenda, page links and quiet health", async () => {
  show();
  for (const key of ["approvals", "agenda", "changes"] as const) expect(await screen.findByRole("heading", { name: en.steward.workspace[key] })).toBeVisible();
  expect(screen.getByRole("link", { name: /README.md/ })).toHaveAttribute("href", "/en/affairs/camera?path=README.md");
  expect(screen.getByText(en.steward.workspace.healthy)).toBeVisible();
});
it("shows an empty agenda without obsolete sections", async () => {
  vi.mocked(apiJson).mockResolvedValue(emptyToday()); show();
  expect(await screen.findByText(en.steward.workspace.empty)).toBeVisible();
  expect(screen.queryByRole("heading", { name: en.steward.workspace.approvals })).not.toBeInTheDocument();
});
it.each(["once", "always", "deny"] as const)("resolves %s with explicit scope", async action => {
  show(); await screen.findByRole("heading", { name: en.steward.workspace.approvals });
  await userEvent.click(screen.getByText(en.steward.workspace.preview));
  expect(screen.getByText(approvalFixture().preview)).toBeVisible();
  vi.mocked(apiJson).mockResolvedValueOnce(approvalFixture()).mockResolvedValue(todayFixture());
  await userEvent.click(screen.getByRole("button", { name: en.steward.workspace[action] }));
  await waitFor(() => expect(apiJson).toHaveBeenCalledWith("/api/steward/approvals/email/resolve?workspaceId=ws", expect.objectContaining({ body: JSON.stringify({ decision: action === "deny" ? "deny" : "approve", scope: action === "always" ? "affair" : "once" }) })));
});
it("loads the optional today markdown page", async () => {
  vi.mocked(apiJson).mockImplementation(async url => String(url).includes("/file?") ? fileFixture() : { ...emptyToday(), todayPage: { affairId: "camera", path: "README.md" } });
  show(); expect(await screen.findByRole("heading", { name: "相机" })).toBeVisible();
});
it("composer waits then displays the latest reply and page attachment", async () => {
  show(); await screen.findByRole("heading", { name: en.steward.workspace.approvals });
  let resolve!: (value: unknown) => void;
  vi.mocked(apiJson).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await userEvent.type(screen.getByRole("textbox", { name: en.steward.foundation.composer }), "Budget 6000{Enter}");
  expect(screen.getByRole("status")).toHaveTextContent(en.steward.foundation.pending);
  resolve(chatFixture);
  expect(await screen.findByText(chatFixture.messages[0]!.text)).toBeVisible();
  expect(screen.getByRole("link", { name: "相机比较" })).toHaveAttribute("href", "/en/affairs/camera?path=README.md");
  expect(screen.getByText(/You · Budget 6000/)).toBeVisible();
});
